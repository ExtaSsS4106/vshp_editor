// static/js/library/upload-lock.js
//
// Блокирует интерфейс библиотеки, пока идёт задача загрузки (upload:library:upload),
// и показывает её статус с кнопками «Пауза» и «Остановить» в шапке очереди.
// Требует JobsWS (ws.js) на странице раньше этого модуля.

const JOB_NAME = "upload";
const JOB_TARGET = "library:upload";                 // = Port.LIB_UPLOAD в port.py
const CHANNEL = `job:${JOB_NAME}:${JOB_TARGET}`;
const ACTIVE = new Set(["running", "paused"]);
const PENDING_MS = 4000;                             // сколько ждать появления задачи после клика

// Что блокируем. inert отключает клики и фокус и переживает перерисовку списка
// другими модулями, даже если они сами переключают disabled.
const LOCKED = [
  "#uploader-queue-run",                  // кнопка «Загрузить» в шапке очереди
  "#uploader-queue-delete",               // «Удалить»
  "#uploader-queue-clear",                // «Очистить»
  "#tab-second-content",                  // сам список очереди
  "#uploader-save",                       // «Сохранить в очередь» в модалке
  '#fm-menu [data-act="to-uploader"]',    // «Добавить в загрузчик» в файловом менеджере
];

const $ = sel => document.querySelector(sel);

let job = null;          // запись задачи из реестра или null
let pending = false;     // кнопку запуска нажали, задача ещё не появилась в реестре
let pendingTimer = null;

const style = document.createElement("style");
style.textContent = ".upload-lock { opacity: .5; }";
document.head.appendChild(style);

const isActive = j => !!j && ACTIVE.has(j.state);
const isLocked = () => pending || isActive(job);

export const uploadLock = {
  get locked() { return isLocked(); },
};
window.UploadLock = uploadLock;     // чтобы проверять из любых модулей: if (UploadLock.locked) return;

// ---------------------------------------------------------------- UI
function toast(text) {
  const el = $("#toast"), body = $("#toast-body");
  if (el && body && window.bootstrap) {
    body.textContent = text;
    window.bootstrap.Toast.getOrCreateInstance(el).show();
  } else {
    console.log("[upload-lock]", text);
  }
}

function apply() {
  const on = isLocked();

  LOCKED.forEach(sel => document.querySelectorAll(sel).forEach(el => {
    el.inert = on;
    el.classList.toggle("upload-lock", on);
    if (on) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
  }));

  const box = $("#uploader-job");
  if (!box) return;
  box.classList.toggle("d-none", !on);

  const active = isActive(job);
  const paused = !!job && job.state === "paused";

  $("#uploader-job-text").textContent = !active ? "Запуск…" : paused ? "Пауза" : "Идёт загрузка…";
  $("#uploader-job-state").className =
    "badge d-flex align-items-center text-bg-" + (paused ? "info" : "warning");
  $("#uploader-job-state .spinner-border").classList.toggle("d-none", paused);

  const pause = $("#uploader-job-pause"), cancel = $("#uploader-job-cancel");
  pause.disabled = cancel.disabled = !active;
  pause.innerHTML = paused
    ? '<i class="bi bi-play-fill me-1"></i>Продолжить'
    : '<i class="bi bi-pause-fill me-1"></i>Пауза';
}

function finished(j) {
  document.dispatchEvent(new CustomEvent("library:upload-finished", { detail: j }));
  if (!j) toast("Загрузка остановлена");
  else if (j.state === "error") toast("Загрузка завершилась с ошибкой: " + String(j.error || "").split("\n")[0]);
  else toast("Загрузка завершена");
  $("#uploader-queue-refresh")?.click();      // обновить очередь, она могла измениться
}

// ---------------------------------------------------------------- события
function onJobs(jobs) {
  const prev = job;
  job = jobs[0] || null;                      // канал job: даёт массив из 0 или 1 записи
  if (isActive(job)) {
    pending = false;
    clearTimeout(pendingTimer);
  }
  apply();
  if (isActive(prev) && !isActive(job)) finished(job);   // done, error или отмена
}

function startPending() {
  pending = true;                             // блокируем сразу, не дожидаясь ответа сервера
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { pending = false; apply(); }, PENDING_MS);
  apply();
}

function act(action) {
  if (!isActive(job)) return;
  JobsWS.act(action, job.id).catch(e => toast(e.message));
}

function init() {
  if (!window.JobsWS) {
    console.error("[upload-lock] JobsWS не найден: подключите ws.js до этого модуля");
    return;
  }
  JobsWS.subscribe(CHANNEL, onJobs);

  $("#upload-queue-confirm")?.addEventListener("click", startPending);
  $("#uploader-job-pause")?.addEventListener("click", () =>
    act(job && job.state === "paused" ? "resume" : "pause"));
  $("#uploader-job-cancel")?.addEventListener("click", () => {
    if (confirm("Остановить загрузку библиотеки?")) act("cancel");
  });

  apply();
}

init();