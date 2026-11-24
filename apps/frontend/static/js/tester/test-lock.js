// static/js/tester/test-lock.js
// Требует JobsWS (ws.js) и #grid с карточками .card[data-id].
//
// Статус задачи рисуется на самой карточке: тонкая полоса прогресса по верхней
// кромке и строка со статусом и кнопками в начале .card-body.
// Чтобы поставить строку в конкретное место, добавьте в разметку карточки
// пустой элемент <div data-job-slot></div>, и строка появится в нём.

const TEST_NAMES = new Set(["fill_test", "local_check", "scan_test"]);
const ACTIVE = new Set(["running", "paused"]);
const JOBS = new Map();      // testId -> job
const $ = (s) => document.querySelector(s);

const isActive = (j) => !!j && ACTIVE.has(j.state);

const toast = (t) => {
  const el = $("#toast"), body = $("#toast-body");
  if (el && body && window.bootstrap) {
    body.textContent = t;
    window.bootstrap.Toast.getOrCreateInstance(el).show();
  } else console.log("[test-lock]", t);
};

// Записываем в DOM только при изменении значения: любая лишняя запись
// порождает мутацию, а мутации раньше запускали applyLocks заново.
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const setClass = (el, cls) => { if (el.className !== cls) el.className = cls; };
const setHTML = (el, html) => {
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
};

// ---------------------------------------------------------------- UI
function makeBar(id) {
  const bar = document.createElement("div");
  bar.className = "test-job-bar";
  bar.innerHTML = `
    <div class="test-job-progress progress rounded-0"
         style="position:absolute;top:0;left:0;right:0;height:3px;z-index:1">
      <div class="progress-bar progress-bar-striped w-100"></div>
    </div>
    <div class="d-flex align-items-center gap-2 mb-2 small">
      <span class="badge test-job-state"></span>
      <span class="test-job-text text-body-secondary"></span>
      <div class="ms-auto btn-group btn-group-sm">
        <button type="button" class="btn btn-outline-secondary" data-job-act="pause"></button>
        <button type="button" class="btn btn-outline-danger" data-job-act="cancel" title="Остановить">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>`;

  bar.querySelector('[data-job-act="pause"]').addEventListener("click", () => {
    const j = JOBS.get(id);
    if (!j) return;
    JobsWS.act(j.state === "paused" ? "resume" : "pause", j.id).catch((e) => toast(e.message));
  });
  bar.querySelector('[data-job-act="cancel"]').addEventListener("click", () => {
    const j = JOBS.get(id);
    if (!j) return;
    if (confirm(`Остановить «${j.name}» для теста ${id}?`)) {
      JobsWS.act("cancel", j.id).catch((e) => toast(e.message));
    }
  });
  return bar;
}

function mount(card, bar) {
  const slot = card.querySelector("[data-job-slot]");
  if (slot) { slot.appendChild(bar); return; }
  (card.querySelector(".card-body") || card).prepend(bar);   // в начало, а не в конец
}

function updateBar(bar, job) {
  const paused = job.state === "paused";

  setClass(bar.querySelector(".test-job-state"),
    "badge test-job-state text-bg-" + (paused ? "info" : "warning"));
  setText(bar.querySelector(".test-job-state"), paused ? "Пауза" : job.name);
  setText(bar.querySelector(".test-job-text"), paused ? "Приостановлено" : "Выполняется…");

  setClass(bar.querySelector(".progress-bar"),
    "progress-bar progress-bar-striped w-100 " +
    (paused ? "bg-info" : "progress-bar-animated bg-warning"));

  const pauseBtn = bar.querySelector('[data-job-act="pause"]');
  setHTML(pauseBtn, paused ? '<i class="bi bi-play-fill"></i>' : '<i class="bi bi-pause-fill"></i>');
  const title = paused ? "Продолжить" : "Пауза";
  if (pauseBtn.title !== title) pauseBtn.title = title;
}

function applyLocks() {
  const grid = document.getElementById("grid");
  if (!grid) return;

  grid.querySelectorAll(".card[data-id]").forEach((card) => {
    const id = card.dataset.id;
    const job = JOBS.get(id);
    const locked = isActive(job);

    // кнопки «Запустить / Редактировать / Удалить»
    card.querySelectorAll(
      '[data-action="run"], [data-action="edit"], [data-action="delete"]'
    ).forEach((b) => { if (b.disabled !== locked) b.disabled = locked; });

    let bar = card.querySelector(".test-job-bar");
    if (locked) {
      if (!bar) {
        bar = makeBar(id);
        mount(card, bar);
      }
      updateBar(bar, job);
    } else if (bar) {
      bar.remove();
    }
  });
}

// ---------------------------------------------------------------- WS
function onJobs(list) {
  const prev = new Map(JOBS);
  JOBS.clear();

  for (const j of list) {
    if (!TEST_NAMES.has(j.name)) continue;
    const key = String(j.target);                 // job.target = id теста
    const cur = JOBS.get(key);
    // у одного теста может быть старая завершённая запись и новая активная:
    // активная не должна затираться завершённой
    if (cur && isActive(cur) && !isActive(j)) continue;
    JOBS.set(key, j);
  }
  applyLocks();

  for (const [id, old] of prev) {
    const now = JOBS.get(id);
    if (isActive(old) && !isActive(now)) {
      if (now && now.state === "error") {
        toast(`Тест ${id}: ошибка. ${String(now.error || "").split("\n")[0]}`);
      }
      document.dispatchEvent(new CustomEvent("tester:job-finished", {
        detail: { id, job: now || old, cancelled: !now },
      }));
    }
  }
}

// ---------------------------------------------------------------- init
// Мутации, которые вызваны самой строкой статуса, игнорируем.
const isBar = (n) => n.nodeType === 1 && n.classList.contains("test-job-bar");
function isOwn(r) {
  const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
  if (t && t.closest(".test-job-bar")) return true;
  const nodes = [...r.addedNodes, ...r.removedNodes];
  return nodes.length > 0 && nodes.every(isBar);
}

function init() {
  if (!window.JobsWS) {
    console.error("[test-lock] JobsWS не найден: подключите ws.js (и socket.io) раньше");
    return;
  }
  JobsWS.subscribe("tests", onJobs);

  const grid = document.getElementById("grid");
  if (grid) {
    // переприменять статусы после каждой перерисовки сетки
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; applyLocks(); });
    };
    new MutationObserver((records) => {
      if (records.some((r) => !isOwn(r))) schedule();
    }).observe(grid, { childList: true, subtree: true });
  }

  applyLocks();
}

init();

export const testLock = {
  getJob: (id) => JOBS.get(String(id)),
  isLocked: (id) => isActive(JOBS.get(String(id))),
};
window.TestLock = testLock;