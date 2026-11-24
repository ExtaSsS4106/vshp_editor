 pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ========== Настройки ========== */
const LIST_URL          = `/api/library/get_current_list_dir`;
const UPLOAD_URL        = `/api/library/save`;
const DELETE_URL        = `/api/library/delete_files`;
const RENAME_URL        = `/api/library/rename_file`;
const MOVE_URL          = `/api/library/move_file`;
const ADD_FOLDER_URL    = `/api/library/add_folder`;
const DOWNLOAD_URL      = `/api/library/download`;
const SET_TASKS_URL     = `/api/library/library_set_tasks`;
const GET_TASKS_URL     = `/api/library/library_get_tasks`;
const DELETE_TASKS_URL  = `/api/library/library_delete_tasks`;
const REORDER_TASKS_URL = `/api/library/library_reorder_tasks`;
const RUN_UPLOAD_URL    = `/api/library/upload`;

const ORG_LABELS = {
  1: 'ЧУВО «ВШП»', 2: 'ЧУПО «ВШП»', 3: 'ЧОУ «ВШП»',
  4: 'Sàrl «SIIL»', 5: 'ООО «ВШП»', 6: 'АНО ВО "Синергия"',
};
const LOCALE_LABELS = { 1: 'RU', 2: 'EN', 3: 'FR', 4: 'ZH-CN', 5: 'ES', 6: 'DE' };

/* ========== Состояние ========== */
const state = {
  currentPath: '/',
  items: [],
  history: [],
  selected: new Set(),
  view: 'list',
  query: '',
  sort: 'name',
  asc: true,
};

let libraryRoot = '';

const uploaderQueue = {
  items: [],
  total: 0,
  loading: false,
  error: null,
  query: '',
};

const uploaderSelection = new Set();

/* ========== Утилиты ========== */
const $ = id => document.getElementById(id);
const filesTabActive = () => $('tab-files').classList.contains('active');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parentOf = p => p.split('/').slice(0, -1).join('/') || '/';
const inSubtree = (child, parent) => child === parent || child.startsWith(parent.replace(/\/+$/, '') + '/');

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Ошибка ' + r.status));
  return j;
}
async function getJSON(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Ошибка ' + r.status));
  return j;
}

function toast(msg) {
  $('toast-body').textContent = msg;
  if (window.bootstrap) bootstrap.Toast.getOrCreateInstance($('toast'), { delay: 2500 }).show();
  else console.log(msg);
}
function fmtSize(bytes) {
  const u = ['Б','КБ','МБ','ГБ','ТБ'];
  let i = 0, v = bytes || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i ? v.toFixed(v < 10 ? 1 : 0).replace('.', ',') : v) + ' ' + u[i];
}
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '…';
  if (sec < 60) return Math.ceil(sec) + ' с';
  return Math.floor(sec / 60) + ' мин ' + Math.ceil(sec % 60) + ' с';
}
function iconFor(item) {
  if (item.is_dir) return 'bi-folder-fill fm-folder';
  const ext = item.name.includes('.') ? item.name.split('.').pop().toLowerCase() : '';
  const map = {
    pdf: 'bi-file-earmark-pdf text-danger',
    doc: 'bi-file-earmark-word text-primary', docx: 'bi-file-earmark-word text-primary',
    xls: 'bi-file-earmark-excel text-success', xlsx: 'bi-file-earmark-excel text-success',
    ppt: 'bi-file-earmark-slides text-warning', pptx: 'bi-file-earmark-slides text-warning',
    jpg: 'bi-file-earmark-image text-info', jpeg: 'bi-file-earmark-image text-info',
    png: 'bi-file-earmark-image text-info', gif: 'bi-file-earmark-image text-info',
    zip: 'bi-file-earmark-zip', rar: 'bi-file-earmark-zip',
    txt: 'bi-file-earmark-text', json: 'bi-file-earmark-code', md: 'bi-file-earmark-text',
  };
  return map[ext] || 'bi-file-earmark';
}
function metaOf(item) {
  if (item.is_dir) return '';
  return item.size != null ? fmtSize(item.size) : '';
}

/* ========== Загрузка каталога ========== */
async function loadDir(path = null, { pushHistory = false } = {}) {
  if (path === null) path = state.currentPath;
  if (pushHistory && path !== state.currentPath) state.history.push(state.currentPath);
  try {
    const json = await postJSON(LIST_URL, { current_path: path });
    if (json.library_root) libraryRoot = String(json.library_root);
    state.currentPath = json.current_path || path;
    state.items = json.data || [];
    state.selected.clear();
    state.query = '';
    $('search').value = '';
    render();
  } catch (err) {
    $('fm-area').innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`;
  }
}

function goUp() {
  if (state.currentPath === '/') return;
  loadDir(parentOf(state.currentPath), { pushHistory: true });
}
function goBack() {
  const p = state.history.pop();
  if (p !== undefined) loadDir(p, { pushHistory: false });
}
function openItem(item) {
  if (item.is_dir) loadDir(item.path, { pushHistory: true });
  else openPreview(item);
}

/* ========== Отрисовка ========== */
function renderPathBar() {
  const parts = state.currentPath.split('/').filter(Boolean);
  const crumbs = [{ name: 'Библиотека', path: '/' }];
  let acc = '';
  for (const p of parts) {
    acc += '/' + p;
    crumbs.push({ name: p, path: acc });
  }
  $('pathbar').innerHTML = crumbs.map((c, i) =>
    (i ? '<i class="bi bi-chevron-right small text-secondary"></i>' : '<i class="bi bi-hdd me-1"></i>') +
    `<button class="seg" data-path="${esc(c.path)}">${esc(c.name)}</button>`
  ).join('');
  $('pathbar').querySelectorAll('[data-path]').forEach(b =>
    b.onclick = () => loadDir(b.dataset.path, { pushHistory: true }));
}

function visibleItems() {
  const items = state.items.filter(i => i.name.toLowerCase().includes(state.query.toLowerCase()));
  const dir = state.asc ? 1 : -1;
  const ext = i => i.name.includes('.') ? i.name.split('.').pop().toLowerCase() : '';
  items.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let r = 0;
    if (state.sort === 'type') r = ext(a).localeCompare(ext(b));
    if (state.sort === 'size') r = (a.size || 0) - (b.size || 0);
    if (r === 0) r = a.name.localeCompare(b.name, 'ru');
    return r * dir;
  });
  return items;
}

function render() {
  renderPathBar();
  const items = visibleItems();
  const area = $('fm-area');
  area.className = 'card-body ' + (state.view === 'grid' ? 'fm-grid' : 'fm-list');

  area.innerHTML = items.length
    ? items.map(item => {
        const sel = state.selected.has(item.path) ? ' selected' : '';
        const meta = metaOf(item);
        const attrs = `class="fm-item${sel}" data-path="${esc(item.path)}" data-is-dir="${item.is_dir}"`;
        return state.view === 'grid'
          ? `<div ${attrs}>
               <i class="fm-icon bi ${iconFor(item)}"></i>
               <span class="fm-name">${esc(item.name)}</span>
               ${meta ? `<span class="d-block small text-secondary">${meta}</span>` : ''}
             </div>`
          : `<div ${attrs}>
               <i class="fm-icon bi ${iconFor(item)}"></i>
               <span>${esc(item.name)}</span>
               <span class="fm-meta">${meta}</span>
             </div>`;
      }).join('')
    : `<p class="text-secondary text-center mt-5 w-100" style="grid-column:1/-1">${
        state.query ? 'Ничего не найдено' : 'Папка пуста. Перетащите сюда файлы для загрузки'
      }</p>`;

  $('btn-up').disabled = state.currentPath === '/';
  $('btn-back').disabled = !state.history.length;
  $('view-list').classList.toggle('active', state.view === 'list');
  $('view-grid').classList.toggle('active', state.view === 'grid');
  $('sort-dir').innerHTML = `<i class="bi bi-sort-${state.sort === 'size' ? 'numeric' : 'alpha'}-${state.asc ? 'down' : 'up'}"></i>`;
  $('diskpath').textContent = state.currentPath;
  paintSelection();
}

function paintSelection() {
  $('btn-download').disabled = !state.selected.size;
  document.querySelectorAll('#fm-area .fm-item').forEach(el =>
    el.classList.toggle('selected', state.selected.has(el.dataset.path)));
  $('status').textContent = `Элементов: ${state.items.length}` +
    (state.selected.size ? `, выбрано: ${state.selected.size}` : '');
}

const itemFromEl = el => {
  const p = el?.dataset?.path;
  return p ? state.items.find(i => i.path === p) : null;
};

/* ========== Призрак перетаскивания файлов ========== */
const ghostEl = $('drag-ghost');
let ghost = null;
let itemDrag = null;
let band = null;

function ghostShow(items, mx, my) {
  const primary = items[0];
  ghostEl.innerHTML = `
    <i class="bi ${iconFor(primary)}"></i>
    <span class="text-truncate" style="max-width:180px">${esc(primary.name)}</span>
    ${items.length > 1 ? `<span class="count">+${items.length - 1}</span>` : ''}
  `;
  ghostEl.style.display = 'flex';
  requestAnimationFrame(() => ghostEl.classList.add('show'));

  ghost = { x: mx - 12, y: my - 12, tx: mx - 12, ty: my - 12, t: Math.random() * 10, raf: 0 };
  const tick = () => {
    if (!ghost) return;
    ghost.x += (ghost.tx - ghost.x) * 0.22;
    ghost.y += (ghost.ty - ghost.y) * 0.22;
    ghost.t += 0.16;
    const dx = ghost.tx - ghost.x;
    const lean = Math.max(-14, Math.min(14, dx * 0.7));
    const wob  = Math.sin(ghost.t) * 1.2;
    const bob  = Math.sin(ghost.t * 0.6) * 2;
    const scale = 1 + Math.sin(ghost.t * 0.15) * 0.03;
    ghostEl.style.transform =
      `translate(${ghost.x}px, ${ghost.y + bob}px) rotate(${lean + wob}deg) scale(${scale})`;
    ghost.raf = requestAnimationFrame(tick);
  };
  tick();
}
function ghostMove(mx, my) { if (ghost) { ghost.tx = mx - 12; ghost.ty = my - 12; } }
function ghostHide() {
  ghostEl.classList.remove('show');
  setTimeout(() => {
    if (!ghostEl.classList.contains('show')) ghostEl.style.display = 'none';
  }, 150);
  if (ghost?.raf) cancelAnimationFrame(ghost.raf);
  ghost = null;
}

/* ========== Мышь в файловом менеджере ========== */
$('fm-area').addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  hideMenu();

  const el = e.target.closest('.fm-item');
  const path = el?.dataset?.path;
  const multi = e.ctrlKey || e.metaKey;

  if (!multi) {
    if (path && !state.selected.has(path)) state.selected = new Set([path]);
    else if (!path) state.selected.clear();
    paintSelection();
  }

  if (path) {
    itemDrag = { startX: e.clientX, startY: e.clientY, started: false, target: null, path };
  } else {
    band = { x: e.clientX, y: e.clientY, base: new Set(multi ? state.selected : []) };
  }
});

document.addEventListener('mousemove', e => {
  if (itemDrag) {
    const dist = Math.hypot(e.clientX - itemDrag.startX, e.clientY - itemDrag.startY);
    if (!itemDrag.started) {
      if (dist < 8) return;
      itemDrag.started = true;
      document.body.classList.add('is-dragging-items');
      if (!state.selected.has(itemDrag.path)) {
        state.selected.add(itemDrag.path);
        paintSelection();
      }
      const items = [...state.selected]
        .map(p => state.items.find(i => i.path === p))
        .filter(Boolean);
      if (items.length) ghostShow(items, e.clientX, e.clientY);
    }
    ghostMove(e.clientX, e.clientY);

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const dirEl = under?.closest('.fm-item[data-is-dir="true"]');
    const crumbEl = under?.closest('#pathbar [data-path]');
    const target = dirEl || crumbEl || null;

    if (itemDrag.target && itemDrag.target !== target) itemDrag.target.classList.remove('drop-target');
    itemDrag.target = target;
    if (target) target.classList.add('drop-target');
    return;
  }

  if (!band) return;
  if (Math.hypot(e.clientX - band.x, e.clientY - band.y) < 5) return;

  const l = Math.min(band.x, e.clientX), t = Math.min(band.y, e.clientY);
  const w = Math.abs(e.clientX - band.x), h = Math.abs(e.clientY - band.y);
  Object.assign($('band').style, { display: 'block', left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });

  const sel = new Set(band.base);
  $('fm-area').querySelectorAll('.fm-item').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.left < l + w && r.right > l && r.top < t + h && r.bottom > t) sel.add(el.dataset.path);
  });
  state.selected = sel;
  paintSelection();
});

document.addEventListener('mouseup', async () => {
  $('band').style.display = 'none';

  if (itemDrag) {
    document.body.classList.remove('is-dragging-items');
    ghostHide();
    if (!itemDrag.started) { itemDrag = null; return; }

    const targetEl = itemDrag.target;
    const paths = [...state.selected];
    itemDrag = null;
    if (targetEl) targetEl.classList.remove('drop-target');
    if (!targetEl) return;

    let targetFolder = null;
    if (targetEl.closest('#pathbar')) {
      targetFolder = targetEl.dataset.path;
    } else {
      const tgt = state.items.find(i => i.path === targetEl.dataset.path);
      if (!tgt || !tgt.is_dir) return;
      targetFolder = tgt.path;
    }

    if (paths.some(p => inSubtree(targetFolder, p))) {
      toast('Нельзя переместить папку внутрь себя');
      return;
    }

    try {
      for (const p of paths) {
        if (parentOf(p) === targetFolder) continue;
        await postJSON(MOVE_URL, { file_path: p, target_folder: targetFolder });
      }
      state.selected.clear();
      await loadDir();
      toast('Перемещено');
    } catch (err) {
      toast('Ошибка перемещения: ' + err.message);
    }
    return;
  }
  band = null;
});

$('fm-area').addEventListener('dblclick', e => {
  const item = itemFromEl(e.target.closest('.fm-item'));
  if (item) openItem(item);
});

/* ========== Контекстное меню ========== */
function hideMenu() { $('fm-menu').style.display = 'none'; }

$('fm-area').addEventListener('contextmenu', e => {
  e.preventDefault();
  const item = itemFromEl(e.target.closest('.fm-item'));
  if (item) {
    if (!state.selected.has(item.path)) state.selected = new Set([item.path]);
  } else {
    state.selected.clear();
  }
  paintSelection();

  const menu = $('fm-menu');
  const mode = item ? 'item' : 'area';
  menu.querySelectorAll('li').forEach(li => li.style.display = li.dataset.for === mode ? '' : 'none');
  const single = state.selected.size === 1;
  menu.querySelectorAll('[data-act="open"],[data-act="rename"]').forEach(a => a.classList.toggle('disabled', !single));

  const uploaderLi = menu.querySelector('[data-act="to-uploader"]')?.closest('li');
  if (uploaderLi) {
    const show = mode === 'item' && single && item?.is_dir;
    uploaderLi.style.display = show ? '' : 'none';
  }

  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - menu.offsetHeight - 8) + 'px';
});
$('fm-menu').addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (a && !a.classList.contains('disabled')) doAction(a.dataset.act);
  hideMenu();
});
document.addEventListener('mousedown', e => { if (!e.target.closest('#fm-menu')) hideMenu(); });
addEventListener('blur', hideMenu);

/* ========== Действия ========== */
async function doAction(act) {
  const items = [...state.selected].map(p => state.items.find(i => i.path === p)).filter(Boolean);

  if (act === 'refresh') return loadDir();
  if (act === 'toggleview') { state.view = state.view === 'list' ? 'grid' : 'list'; return render(); }
  if (act === 'selectall') { visibleItems().forEach(i => state.selected.add(i.path)); return paintSelection(); }
  if (act === 'upload') return $('file-input').click();
  if (act === 'newfolder') return bootstrap.Modal.getOrCreateInstance($('new-folder')).show();
  if (!items.length) return;

  if (act === 'open') return openItem(items[0]);
  if (act === 'download') return downloadItems(items);
  if (act === 'to-uploader') {
    const item = items[0];
    if (item?.is_dir) uploaderOpen(item);
    return;
  }

  if (act === 'rename') {
    const item = items[0];
    const name = (prompt('Новое имя:', item.name) || '').trim();
    if (!name || name === item.name) return;
    try {
      await postJSON(RENAME_URL, { path: item.path, new_name: name });
      await loadDir();
      toast('Переименовано');
    } catch (err) { toast('Ошибка переименования: ' + err.message); }
    return;
  }

  if (act === 'delete') {
    if (!confirm(`Удалить выбранное (${items.length})?`)) return;
    try {
      await postJSON(DELETE_URL, { paths: items.map(i => i.path) });
      await loadDir();
      toast('Удалено');
    } catch (err) { toast('Ошибка удаления: ' + err.message); }
  }
}

/* ========== Скачивание ========== */
function triggerDownload(href, name = '') {
  const a = document.createElement('a');
  a.href = href;
  if (name) a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function downloadItems(items) {
  if (!items.length) return toast('Выберите, что скачать');
  const query = items.map(i => 'path=' + encodeURIComponent(i.path)).join('&');
  const url = `${DOWNLOAD_URL}?${query}&download=1`;
  if (url.length > 7000) return toast('Слишком много элементов, выберите меньше');
  const single = items.length === 1;
  const name = single ? (items[0].is_dir ? items[0].name + '.zip' : items[0].name) : 'files.zip';
  triggerDownload(url, name);
  toast(single && !items[0].is_dir ? 'Скачивание: ' + items[0].name : 'Скачивание архива…');
}
$('btn-download').onclick = () => downloadItems(
  [...state.selected].map(p => state.items.find(i => i.path === p)).filter(Boolean));

/* ========== Создание папки ========== */
$('new-folder-create').onclick = async () => {
  const name = $('new-folder-name').value.trim();
  if (!name) return toast('Введите имя папки');
  try {
    await postJSON(ADD_FOLDER_URL, { folder_name: name, path: state.currentPath });
    $('new-folder-name').value = '';
    bootstrap.Modal.getInstance($('new-folder'))?.hide();
    await loadDir();
    toast('Папка создана');
  } catch (err) { toast('Ошибка: ' + err.message); }
};
$('new-folder-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('new-folder-create').click();
});

/* ========== Загрузка файлов ========== */
let upload = null;
function uplShow(on) { $('upl').style.display = on ? 'block' : 'none'; }
function uplSet({ title, file, pct, bytes, speed, striped, cls }) {
  const bar = $('upl-bar');
  if (title != null) $('upl-title').innerHTML = title;
  if (file != null) $('upl-file').textContent = file;
  if (pct != null) { bar.style.width = pct + '%'; bar.textContent = Math.floor(pct) + '%'; }
  if (bytes != null) $('upl-bytes').textContent = bytes;
  if (speed != null) $('upl-speed').textContent = speed;
  bar.className = 'progress-bar'
    + (striped ? ' progress-bar-striped progress-bar-animated' : '')
    + (cls ? ' ' + cls : '');
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  if (upload) return toast('Дождитесь окончания текущей загрузки');

  const folderName = state.currentPath;
  const keepPath = state.currentPath;
  const total = files.reduce((s, f) => s + f.size, 0) || 1;
  const t0 = performance.now();

  const progress = pct => {
    const loaded = pct * total;
    const sec = (performance.now() - t0) / 1000;
    const speed = sec > 0.3 ? loaded / sec : 0;
    let acc = 0, cur = files[files.length - 1];
    for (const f of files) { acc += f.size; if (loaded < acc) { cur = f; break; } }
    uplSet({
      title: '<i class="bi bi-cloud-arrow-up me-1"></i>Загрузка',
      file: (files.length > 1 ? `[${files.indexOf(cur) + 1}/${files.length}] ` : '') + cur.name,
      pct: pct * 100,
      bytes: `${fmtSize(loaded)} из ${fmtSize(total)}`,
      speed: speed ? `${fmtSize(speed)}/с · ${fmtTime((total - loaded) / speed)}` : '',
      striped: false,
    });
  };
  const processing = () => uplSet({
    title: '<i class="bi bi-gear me-1"></i>Обработка на сервере…',
    pct: 100, bytes: `${fmtSize(total)} передано`, speed: '', striped: true,
  });
  const finish = (ok, msg) => {
    upload = null;
    uplSet({
      title: ok ? '<i class="bi bi-check-circle me-1 text-success"></i>Готово'
                : '<i class="bi bi-x-circle me-1 text-danger"></i>Ошибка',
      file: msg, pct: ok ? 100 : null, speed: '', striped: false,
      cls: ok ? 'bg-success' : 'bg-danger',
    });
    setTimeout(() => { if (!upload) uplShow(false); }, ok ? 1800 : 4000);
    if (ok) loadDir(keepPath);
  };

  uplShow(true);
  progress(0);

  const fd = new FormData();
  fd.append('folder', folderName);
  files.forEach(f => fd.append('file', f, f.name));

  const xhr = new XMLHttpRequest();
  xhr.open('POST', UPLOAD_URL);
  xhr.upload.onprogress = e => { if (e.lengthComputable) progress(e.loaded / e.total); };
  xhr.upload.onload = processing;
  xhr.onload = () => {
    let json = {}; try { json = JSON.parse(xhr.responseText); } catch (_) {}
    if (xhr.status >= 200 && xhr.status < 300) finish(true, `Загружено файлов: ${(json.files || []).length}`);
    else finish(false, json.error || ('Ошибка сервера ' + xhr.status));
  };
  xhr.onerror = () => finish(false, 'Ошибка сети');
  xhr.onabort = () => { upload = null; uplShow(false); toast('Загрузка отменена'); };

  upload = { xhr, cancel() { xhr.abort(); } };
  xhr.send(fd);
}

$('upl-cancel').onclick = () => { if (upload) upload.cancel(); else uplShow(false); };
$('btn-upload').onclick = () => $('file-input').click();
$('file-input').onchange = e => { uploadFiles(e.target.files); e.target.value = ''; };

const isFilesFromOS = e => filesTabActive() && e.dataTransfer && [...e.dataTransfer.types].includes('Files') && !itemDrag;
let dragDepth = 0;

document.addEventListener('dragenter', e => {
  if (!isFilesFromOS(e)) return;
  dragDepth++;
  $('fm-area').classList.add('drop');
});
document.addEventListener('dragleave', e => {
  if (!isFilesFromOS(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; $('fm-area').classList.remove('drop'); }
});
document.addEventListener('dragover', e => {
  if (isFilesFromOS(e)) e.preventDefault();
});
document.addEventListener('drop', e => {
  if (!isFilesFromOS(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('fm-area').classList.remove('drop');
  uploadFiles(e.dataTransfer.files);
});

/* ========== Тулбар и клавиатура ========== */
$('btn-back').onclick = goBack;
$('btn-up').onclick = goUp;
$('btn-refresh').onclick = () => loadDir();
$('view-list').onclick = () => { state.view = 'list'; render(); };
$('view-grid').onclick = () => { state.view = 'grid'; render(); };
$('search').oninput = e => { state.query = e.target.value; state.selected.clear(); render(); };
$('sort').onchange = e => { state.sort = e.target.value; render(); };
$('sort-dir').onclick = () => { state.asc = !state.asc; render(); };

document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  if (!filesTabActive()) return;

  if (e.key === 'Escape') {
    if (itemDrag) {
      document.body.classList.remove('is-dragging-items');
      if (itemDrag.target) itemDrag.target.classList.remove('drop-target');
      itemDrag = null;
      ghostHide();
    }
    $('band').style.display = 'none';
    band = null;
    state.selected.clear();
    paintSelection();
    hideMenu();
    return;
  }

  if (e.altKey && e.key === 'ArrowLeft') return goBack();
  if (e.altKey && e.key === 'ArrowUp') return goUp();
  if (e.key === 'Backspace') { e.preventDefault(); goUp(); }
  if (e.key === 'Delete') doAction('delete');
  if (e.key === 'F2' && state.selected.size === 1) doAction('rename');
  if (e.key === 'Enter' && state.selected.size === 1) doAction('open');
  if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doAction('selectall');
  }
});

/* ========== ПРЕДПРОСМОТР ========== */
const previewModalEl = document.getElementById('preview-modal');
const previewModal = new bootstrap.Modal(previewModalEl);

async function openPreview(item) {
  const body = document.getElementById('preview-body');
  const title = document.getElementById('preview-title');
  const fileUrl = `${DOWNLOAD_URL}?path=${encodeURIComponent(item.path)}`;

  body.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';
  title.textContent = item.name;
  $('preview-download').onclick = () => downloadItems([item]);

  const ext = item.name.split('.').pop().toLowerCase();
  previewModal.show();

  try {
    switch (ext) {
      case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'svg':
        body.innerHTML = `<img src="${fileUrl}" class="img-fluid d-block mx-auto" alt="${esc(item.name)}">`;
        break;
      case 'mp4': case 'webm':
        body.innerHTML = `<video src="${fileUrl}" controls autoplay class="w-100"></video>`;
        break;
      case 'mp3': case 'wav': case 'ogg':
        body.innerHTML = `<audio src="${fileUrl}" controls class="w-100 mt-3"></audio>`;
        break;
      case 'pdf':
        await renderPdf(fileUrl, body);
        break;
      case 'docx':
        await renderDocx(fileUrl, body);
        break;
      case 'txt': case 'md': case 'json': case 'js': case 'css': case 'html': case 'xml': case 'csv':
        await renderText(fileUrl, body);
        break;
      case 'pptx': {
        const runRender = () => {
          renderPptx(fileUrl, body).catch(err => {
            body.innerHTML = `<div class="alert alert-danger">Не удалось загрузить файл: ${esc(err.message)}</div>`;
          });
        };
        if (body.clientWidth > 0 && body.clientHeight > 0) runRender();
        else previewModalEl.addEventListener('shown.bs.modal', runRender, { once: true });
        break;
      }
      default:
        body.innerHTML = `<div class="alert alert-info">Предпросмотр для файлов <strong>.${ext}</strong> не поддерживается. <a href="${fileUrl}" class="alert-link" download>Скачать файл</a></div>`;
    }
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">Не удалось загрузить файл: ${esc(err.message)}</div>`;
  }
}

async function renderPdf(url, container) {
  const pdf = await pdfjsLib.getDocument(url).promise;
  container.innerHTML = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.className = 'd-block mx-auto mb-3 shadow-sm';
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    container.appendChild(canvas);
    await page.render({ canvasContext: context, viewport }).promise;
  }
}
async function renderDocx(url, container) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Сервер вернул ' + resp.status);
  const buffer = await resp.arrayBuffer();
  container.innerHTML = '';
  await docx.renderAsync(new Uint8Array(buffer), container);
}
async function renderText(url, container) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Не удалось загрузить текст');
  const text = await resp.text();
  container.innerHTML = `<pre class="p-3 bg-body-tertiary rounded mb-0" style="max-height: 100%; overflow: auto;">${esc(text)}</pre>`;
}

/* ========== PPTX ========== */
let currentPptxCleanup = null;
let pptxToken = 0;

async function getPptxRatio(blob) {
  try {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('ppt/presentation.xml').async('string');
    const tag = xml.match(/<p:sldSz\b[^>]*>/)[0];
    const cx = +tag.match(/\bcx="(\d+)"/)[1];
    const cy = +tag.match(/\bcy="(\d+)"/)[1];
    if (cx > 0 && cy > 0) return cy / cx;
  } catch (_) {}
  return 9 / 16;
}

async function renderPptx(url, container) {
  if (currentPptxCleanup) { try { currentPptxCleanup(); } catch (_) {} currentPptxCleanup = null; }
  const token = ++pptxToken;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Сервер вернул ' + resp.status);
  const blob = await resp.blob();
  if (token !== pptxToken) return;

  container.innerHTML = `
    <canvas id="pptx-canvas" class="d-block mx-auto mb-3 shadow-sm"></canvas>
    <div class="d-flex justify-content-center align-items-center gap-2">
      <button id="pptx-prev" class="btn btn-sm btn-outline-secondary">← Назад</button>
      <span id="pptx-status" class="text-secondary small"></span>
      <button id="pptx-next" class="btn btn-sm btn-outline-secondary">Вперёд →</button>
    </div>`;

  const canvas   = container.querySelector('#pptx-canvas');
  const prevBtn  = container.querySelector('#pptx-prev');
  const nextBtn  = container.querySelector('#pptx-next');
  const statusEl = container.querySelector('#pptx-status');

  let ratio = await getPptxRatio(blob);
  if (!isFinite(ratio) || ratio < 0.3 || ratio > 2) ratio = 9 / 16;

  const boxW = container.clientWidth || Math.round(innerWidth * 0.9);
  const availW = Math.max(320, boxW - 32);
  const availH = Math.max(240, innerHeight - 190);
  const cssW = Math.round(Math.min(1280, availW, availH / ratio));
  const cssH = Math.round(cssW * ratio);
  const scale = Math.max(2, window.devicePixelRatio || 1);

  canvas.width  = Math.round(cssW * scale);
  canvas.height = Math.round(cssH * scale);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.style.maxWidth = 'none';

  const file = new File([blob], 'presentation.pptx',
    { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  const viewer = new window.PptxViewJS.PPTXViewer({ canvas });
  await viewer.loadFile(file);
  if (token !== pptxToken) { try { viewer.destroy?.(); } catch (_) {} return; }
  await viewer.render();

  const update = async () => {
    const cur = await viewer.getCurrentSlideIndex();
    const total = await viewer.getSlideCount();
    statusEl.textContent = `Слайд ${cur + 1} из ${total}`;
    prevBtn.disabled = cur <= 0;
    nextBtn.disabled = cur >= total - 1;
  };
  const go = async fn => { try { await fn(); } finally { update(); } };
  prevBtn.onclick = () => go(() => viewer.previousSlide());
  nextBtn.onclick = () => go(() => viewer.nextSlide());

  const onKey = e => {
    if (e.key === 'ArrowRight') nextBtn.click();
    if (e.key === 'ArrowLeft' && !e.altKey) prevBtn.click();
  };
  document.addEventListener('keydown', onKey);

  await update();
  currentPptxCleanup = () => {
    document.removeEventListener('keydown', onKey);
    try { viewer.destroy?.(); } catch (_) {}
  };
}

previewModalEl.addEventListener('hidden.bs.modal', () => {
  pptxToken++;
  document.getElementById('preview-body').innerHTML = '';
  if (currentPptxCleanup) {
    try { currentPptxCleanup(); } catch (_) {}
    currentPptxCleanup = null;
  }
});

/* ========== ЗАГРУЗЧИК — модалка ========== */
const uploaderModalEl = document.getElementById('uploader-modal');
const uploaderModal = new bootstrap.Modal(uploaderModalEl);
const uploaderForm = $('uploader-form');

let uploaderEditingPath = null;

function uploaderSetMode(editing) {
  uploaderEditingPath = editing ? String(editing) : null;
  $('uploader-modal-title').innerHTML = editing
    ? '<i class="bi bi-pencil me-1"></i>Редактировать задачу'
    : '<i class="bi bi-box-arrow-up me-1"></i>Добавить в загрузчик библиотеки';
  $('uploader-save').innerHTML = editing
    ? '<i class="bi bi-check2-circle me-1"></i>Сохранить изменения'
    : '<i class="bi bi-cloud-upload me-1"></i>Сохранить в очередь';
}

function uploaderPayload() {
  const get = n => uploaderForm.querySelector(`[name="${n}"]`);
  const lectureRaw = get('lecture_count').value.trim();
  const additionalRaw = get('additional_name').value.trim();

  return {
    additional_name: additionalRaw || null,
    author: get('author').value.trim(),
    discipline: get('discipline').value.trim(),
    folder_path: get('folder_path').value,
    lecture_count: lectureRaw ? parseInt(lectureRaw, 10) : null,
    locale: parseInt(get('locale').value, 10),
    organization: parseInt(get('organization').value, 10),
    presentation: get('presentation').checked,
  };
}
function uploaderJson() { return JSON.stringify(uploaderPayload(), null, 2); }
function uploaderMissing() {
  const p = uploaderPayload();
  const missing = [];
  if (!p.discipline) missing.push('Дисциплина');
  if (!p.author) missing.push('Автор');
  if (!p.folder_path) missing.push('Путь к папке');
  return missing;
}
function uploaderRefresh() {
  $('uploader-json').textContent = uploaderJson();
  const missing = uploaderMissing();
  const el = $('uploader-validation');
  if (missing.length) {
    el.textContent = 'Не заполнено: ' + missing.join(', ');
    el.className = 'text-danger small';
  } else {
    el.textContent = 'Готово';
    el.className = 'text-success small';
  }
}

function uploaderOpen(folder) {
  if (!libraryRoot) {
    toast('Корень библиотеки неизвестен — обновите страницу (нужен library_root в ответе get_current_list_dir)');
    return;
  }
  uploaderForm.reset();
  uploaderSetMode(null);
  const cleanRoot = libraryRoot.replace(/\/+$/, '');
  const folderPath = cleanRoot + folder.path;
  uploaderForm.querySelector('[name="folder_path"]').value = folderPath;
  uploaderForm.querySelector('[name="author"]').value = '-';
  uploaderForm.querySelector('[name="organization"]').value = '1';
  uploaderForm.querySelector('[name="locale"]').value = '1';
  uploaderForm.querySelector('[name="presentation"]').checked = false;

  $('uploader-result').hidden = true;
  $('uploader-result').innerHTML = '';

  uploaderRefresh();
  uploaderModal.show();
  setTimeout(() => uploaderForm.querySelector('[name="discipline"]').focus(), 200);
}

function uploaderOpenEdit(task) {
  if (!task) return;
  uploaderForm.reset();
  uploaderSetMode(task.folder_path);

  const get = n => uploaderForm.querySelector(`[name="${n}"]`);
  get('discipline').value     = task.discipline     || '';
  get('organization').value   = String(task.organization ?? 1);
  get('locale').value         = String(task.locale ?? 1);
  get('author').value         = task.author         || '-';
  get('additional_name').value= task.additional_name|| '';
  get('lecture_count').value  = task.lecture_count != null ? String(task.lecture_count) : '';
  get('presentation').checked = !!task.presentation;
  get('folder_path').value    = task.folder_path    || '';

  $('uploader-result').hidden = true;
  $('uploader-result').innerHTML = '';

  uploaderRefresh();
  uploaderModal.show();
  setTimeout(() => get('discipline').focus(), 200);
}

uploaderModalEl.addEventListener('hidden.bs.modal', () => {
  uploaderSetMode(null);
});

uploaderForm.addEventListener('input', uploaderRefresh);
uploaderForm.addEventListener('change', uploaderRefresh);
uploaderForm.addEventListener('submit', e => e.preventDefault());

$('uploader-copy').onclick = async () => {
  const missing = uploaderMissing();
  if (missing.length) return toast('Заполните: ' + missing.join(', '));
  try {
    await navigator.clipboard.writeText(uploaderJson());
    toast('JSON скопирован в буфер обмена');
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = uploaderJson();
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('JSON скопирован'); }
    catch (_) { toast('Не удалось скопировать: ' + err.message); }
    ta.remove();
  }
};

$('uploader-download').onclick = () => {
  const missing = uploaderMissing();
  if (missing.length) return toast('Заполните: ' + missing.join(', '));
  const blob = new Blob([uploaderJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const folderName = (uploaderPayload().folder_path.split('/').pop() || 'upload_task').replace(/[^\w.-]+/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Файл скачан: ' + a.download);
};

$('uploader-save').onclick = async () => {
  const missing = uploaderMissing();
  if (missing.length) return toast('Заполните: ' + missing.join(', '));

  const btn = $('uploader-save');
  const orig = btn.innerHTML;
  const wasEditing = !!uploaderEditingPath;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Отправка…';
  const payload = uploaderPayload();

  try {
    const res = await postJSON(SET_TASKS_URL, { tasks: [payload] });
    uploaderShowResult(res, payload);
    toast(wasEditing ? 'Задача обновлена' : 'Задача сохранена в очередь');
    loadUploaderQueue();
  } catch (err) {
    uploaderShowError(err.message);
    toast('Ошибка сохранения: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

function uploaderShowError(msg) {
  const el = $('uploader-result');
  el.hidden = false;
  el.innerHTML = `
    <div class="alert alert-danger d-flex gap-2 align-items-start mb-0">
      <i class="bi bi-exclamation-triangle-fill fs-5"></i>
      <div class="flex-grow-1">
        <strong>Не удалось сохранить</strong>
        <div class="small mt-1">${esc(msg)}</div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function uploaderShowResult(res, sent) {
  const total    = Number(res?.total) || 0;
  const existing = Array.isArray(res?.existing) ? res.existing : [];
  const mine     = existing.find(t => t.folder_path === sent.folder_path);

  const rows = existing.map(t => {
    const isMine = t.folder_path === sent.folder_path;
    const lec = t.lecture_count ? `Лекция ${t.lecture_count}` : '—';
    const pres = t.presentation ? '<i class="bi bi-easel text-warning" title="Презентация"></i>' : '';
    return `<tr${isMine ? ' class="table-success"' : ''}>
      <td class="text-truncate" style="max-width:160px" title="${esc(t.discipline || '')}">
        ${esc(t.discipline || '—')}
      </td>
      <td class="text-truncate font-monospace" style="max-width:220px" title="${esc(t.folder_path || '')}">
        ${esc((t.folder_path || '').split('/').pop() || '—')}
      </td>
      <td class="text-nowrap">${lec}</td>
      <td>${pres}</td>
    </tr>`;
  }).join('');

  const el = $('uploader-result');
  el.hidden = false;
  el.innerHTML = `
    <div class="alert alert-success d-flex gap-2 align-items-start mb-2">
      <i class="bi bi-check-circle-fill fs-4 text-success"></i>
      <div class="flex-grow-1">
        <strong>${mine ? 'Задача в очереди' : 'Задача отправлена'}</strong>
        <div class="small mt-1">
          Всего задач в очереди: <strong>${total}</strong>
          ${mine ? ' · текущая подсвечена зелёным' : ''}
        </div>
      </div>
    </div>
    <details class="border rounded p-2 bg-body-tertiary">
      <summary class="small text-secondary" style="cursor:pointer">
        Показать очередь (${total})
      </summary>
      <div class="table-responsive mt-2" style="max-height: 220px; overflow: auto;">
        <table class="table table-sm table-hover mb-0 align-middle">
          <thead class="table-light">
            <tr><th>Дисциплина</th><th>Папка</th><th>Лекция</th><th></th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" class="text-secondary text-center">Очередь пуста</td></tr>'}
          </tbody>
        </table>
      </div>
    </details>
  `;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* =====================================================================
   ВКЛАДКА 2 — Очередь загрузчика
   ===================================================================== */
function filteredQueueItems() {
  const q = uploaderQueue.query.trim().toLowerCase();
  if (!q) return uploaderQueue.items;
  return uploaderQueue.items.filter(t =>
    (t.discipline || '').toLowerCase().includes(q) ||
    (t.folder_path || '').toLowerCase().includes(q) ||
    (t.author || '').toLowerCase().includes(q) ||
    (t.additional_name || '').toLowerCase().includes(q));
}

async function loadUploaderQueue() {
  uploaderQueue.loading = true;
  uploaderQueue.error = null;
  renderUploaderQueue();

  try {
    const res = await getJSON(GET_TASKS_URL);
    uploaderQueue.items = Array.isArray(res.existing) ? res.existing : [];
    uploaderQueue.total = Number(res.total) || uploaderQueue.items.length;
  } catch (err) {
    uploaderQueue.items = [];
    uploaderQueue.total = 0;
    uploaderQueue.error = err.message;
  } finally {
    uploaderQueue.loading = false;
    const alive = new Set(uploaderQueue.items.map(t => String(t.folder_path || '')));
    for (const p of [...uploaderSelection]) if (!alive.has(p)) uploaderSelection.delete(p);
    updateQueueCounters();
    renderUploaderQueue();
  }
}

function updateQueueCounters() {
  $('tab-second-badge').textContent = String(uploaderQueue.total);
  $('uploader-queue-total').textContent = String(uploaderQueue.total);

  const delBtn = $('uploader-queue-delete');
  const delCnt = $('uploader-queue-delete-count');
  if (delBtn && delCnt) {
    delBtn.disabled = uploaderSelection.size === 0;
    delCnt.hidden = uploaderSelection.size === 0;
    delCnt.textContent = String(uploaderSelection.size);
  }

  // Кнопка запуска загрузки: активна только если очередь не пуста
  const runBtn = $('uploader-queue-run');
  if (runBtn) runBtn.disabled = uploaderQueue.total === 0;
}

function renderUploaderQueue() {
  const area = $('tab-second-content');
  if (!area) return;

  if (uploaderQueue.loading) {
    area.innerHTML = `
      <div class="text-center py-5 text-secondary">
        <div class="spinner-border spinner-border-sm mb-2"></div>
        <div class="small">Загрузка очереди…</div>
      </div>`;
    updateQueueCounters();
    return;
  }

  if (uploaderQueue.error) {
    area.innerHTML = `
      <div class="p-3">
        <div class="alert alert-danger d-flex gap-2 align-items-start mb-0">
          <i class="bi bi-exclamation-triangle-fill fs-5"></i>
          <div class="flex-grow-1">
            <strong>Не удалось загрузить очередь</strong>
            <div class="small mt-1">${esc(uploaderQueue.error)}</div>
            <button class="btn btn-sm btn-outline-danger mt-2" id="uploader-queue-retry">
              <i class="bi bi-arrow-clockwise me-1"></i>Повторить
            </button>
          </div>
        </div>
      </div>`;
    area.querySelector('#uploader-queue-retry')?.addEventListener('click', loadUploaderQueue);
    updateQueueCounters();
    return;
  }

  const total = uploaderQueue.total;
  if (!total) {
    area.innerHTML = `
      <div class="text-center py-5 text-secondary">
        <i class="bi bi-inbox display-4 d-block mb-2 opacity-50"></i>
        <div>Очередь пуста</div>
        <div class="small mt-2">
          ПКМ на папке в «Файлах» → «Добавить в загрузчик библиотеки»
        </div>
      </div>`;
    updateQueueCounters();
    return;
  }

  const filtered = filteredQueueItems();
  const allChecked = filtered.length > 0 &&
                     filtered.every(t => uploaderSelection.has(String(t.folder_path || '')));

  const rowsHtml = filtered.map((t, i) => {
    const folderPath = String(t.folder_path || '');
    const checked = uploaderSelection.has(folderPath);
    const base = folderPath.split('/').filter(Boolean).pop() || '—';
    const parent = folderPath.replace(/[\\/][^\\/]+$/, '');
    const parentTail = parent.split('/').filter(Boolean).slice(-2).join('/') || '';
    const org = ORG_LABELS[t.organization] || ('#' + t.organization);
    const loc = LOCALE_LABELS[t.locale] || ('#' + t.locale);
    const lec = t.lecture_count
      ? `<span class="badge text-bg-light border">${t.lecture_count}</span>`
      : '<span class="text-secondary">—</span>';
    const pres = t.presentation
      ? '<i class="bi bi-easel text-warning" title="Презентация"></i>'
      : '<span class="text-secondary">—</span>';

    return `<tr data-path="${esc(folderPath)}"${checked ? ' class="row-selected"' : ''}>
      <td class="text-center">
        <input type="checkbox" class="form-check-input row-check"
               data-path="${esc(folderPath)}" ${checked ? 'checked' : ''}>
      </td>
      <td class="text-center text-secondary" style="width:32px">
        <i class="bi bi-grip-vertical"></i>
      </td>
      <td class="text-secondary text-end">${i + 1}</td>
      <td class="cell-disc">
        <div class="text-truncate" title="${esc(t.discipline || '')}">${esc(t.discipline || '—')}</div>
        ${t.additional_name ? `<div class="small text-secondary text-truncate" title="${esc(t.additional_name)}">${esc(t.additional_name)}</div>` : ''}
      </td>
      <td class="cell-path font-monospace small">
        <div class="text-truncate" title="${esc(folderPath)}">${esc(base)}</div>
        ${parentTail ? `<div class="small text-secondary text-truncate" title="${esc(parent)}">…/${esc(parentTail)}</div>` : ''}
      </td>
      <td class="small text-nowrap">${esc(t.author || '—')}</td>
      <td class="small text-nowrap">${esc(loc)}</td>
      <td class="small text-nowrap" title="${esc(org)}">
        <div class="text-truncate" style="max-width:150px">${esc(org)}</div>
      </td>
      <td class="text-center">${lec}</td>
      <td class="text-center">${pres}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-primary btn-row-action" data-edit-path="${esc(folderPath)}" title="Редактировать">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-sm btn-outline-secondary btn-row-action" data-copy-path="${esc(folderPath)}" title="Скопировать путь">
          <i class="bi bi-clipboard"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger btn-row-action" data-del-path="${esc(folderPath)}" title="Удалить">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`;
  }).join('');

  const footer = uploaderQueue.query
    ? `<div class="small text-secondary px-3 py-2 border-top">Показано ${filtered.length} из ${uploaderQueue.items.length}</div>`
    : '';

  area.innerHTML = `
    <table class="table table-sm table-hover align-middle mb-0">
      <thead>
        <tr>
          <th class="text-center" style="width:36px">
            <input type="checkbox" class="form-check-input" id="uploader-queue-check-all"
                   ${allChecked ? 'checked' : ''} title="Выбрать всё">
          </th>
          <th style="width:32px"></th>
          <th class="text-end" style="width:40px">#</th>
          <th>Дисциплина</th>
          <th>Папка</th>
          <th>Автор</th>
          <th>Язык</th>
          <th>Организация</th>
          <th class="text-center">Лекция</th>
          <th class="text-center" title="Презентация"><i class="bi bi-easel"></i></th>
          <th style="width:130px"></th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="11" class="text-center text-secondary py-4">Ничего не найдено по запросу «${esc(uploaderQueue.query)}»</td></tr>`}
      </tbody>
    </table>
    ${footer}
  `;

  updateQueueCounters();
}

/* ---------- Клик: чекбоксы / копирование / редактирование / удаление ---------- */
let qSuppressClick = false;

$('tab-second-content').addEventListener('click', async e => {
  if (qSuppressClick) { qSuppressClick = false; return; }

  if (e.target.matches('#uploader-queue-check-all')) {
    const on = e.target.checked;
    for (const t of filteredQueueItems()) {
      const p = String(t.folder_path || '');
      if (on) uploaderSelection.add(p);
      else uploaderSelection.delete(p);
    }
    renderUploaderQueue();
    return;
  }

  const check = e.target.closest('.row-check');
  if (check) {
    const p = check.dataset.path;
    if (check.checked) uploaderSelection.add(p);
    else uploaderSelection.delete(p);
    renderUploaderQueue();
    return;
  }

  const editBtn = e.target.closest('[data-edit-path]');
  if (editBtn) {
    const path = editBtn.dataset.editPath;
    const task = uploaderQueue.items.find(t => String(t.folder_path) === path);
    if (task) uploaderOpenEdit(task);
    return;
  }

  const tr = e.target.closest('tr[data-path]');
  if (tr && !e.target.closest('button, input[type="checkbox"], a')) {
    const path = tr.dataset.path;
    if (uploaderSelection.has(path)) uploaderSelection.delete(path);
    else uploaderSelection.add(path);
    renderUploaderQueue();
    return;
  }

  const copyBtn = e.target.closest('[data-copy-path]');
  if (copyBtn) {
    const path = copyBtn.dataset.copyPath;
    try {
      await navigator.clipboard.writeText(path);
      toast('Путь скопирован: ' + path);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = path;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Путь скопирован'); }
      catch (_) { toast('Не удалось скопировать'); }
      ta.remove();
    }
    return;
  }

  const delBtn = e.target.closest('[data-del-path]');
  if (delBtn) {
    const p = delBtn.dataset.delPath;
    if (!confirm(`Удалить задачу из очереди?\n${p}`)) return;
    try {
      const res = await postJSON(DELETE_TASKS_URL, { folder_paths: [p] });
      uploaderSelection.delete(p);
      uploaderQueue.items = Array.isArray(res.remaining) ? res.remaining : [];
      uploaderQueue.total = Number(res.total) || uploaderQueue.items.length;
      updateQueueCounters();
      renderUploaderQueue();
      toast(`Удалено: ${res.removed ?? 1}`);
    } catch (err) {
      toast('Ошибка удаления: ' + err.message);
    }
  }
});

/* =====================================================================
   КАСТОМНЫЙ DRAG СТРОК — с пружинным ghost и точным сдвигом
   ===================================================================== */
const qGhostEl = document.getElementById('queue-ghost');
let qDrag = null;
let qGhostRaf = 0;

$('tab-second-content').addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (e.target.closest('button, input, a, select, textarea')) return;

  const tr = e.target.closest('tr[data-path]');
  if (!tr) return;

  const rect = tr.getBoundingClientRect();
  qDrag = {
    tr,
    path: tr.dataset.path,
    startX: e.clientX,
    startY: e.clientY,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    rect,
    active: false,
    ghost: null,
    targetIdx: -1,
    dragHeight: Math.round(rect.height),
    spring: null,
    rowTops: null,
  };
});

document.addEventListener('mousemove', e => {
  if (!qDrag) return;
  if (!qDrag.active) {
    const dist = Math.hypot(e.clientX - qDrag.startX, e.clientY - qDrag.startY);
    if (dist < 6) return;
    startQueueDrag(e);
  }
  if (!qDrag?.active) return;
  moveQueueDrag(e);
});

document.addEventListener('mouseup', e => {
  if (!qDrag) return;
  if (qDrag.active) {
    qSuppressClick = true;
    endQueueDrag(e);
  } else {
    qDrag = null;
  }
});

function startQueueDrag(e) {
  const tr = qDrag.tr;
  qDrag.active = true;
  qDrag.rect = tr.getBoundingClientRect();
  qDrag.dragHeight = Math.round(qDrag.rect.height);

  const rows = [...$('tab-second-content').querySelectorAll('tbody tr[data-path]')];
  qDrag.rowTops = rows.map(r => {
    const b = r.getBoundingClientRect();
    return { top: b.top, mid: b.top + b.height / 2, height: b.height };
  });

  tr.classList.add('q-dragging');
  document.body.classList.add('is-dragging-items');

  const item = uploaderQueue.items.find(t => String(t.folder_path) === qDrag.path);
  const discipline = item?.discipline || '—';
  const folderPath = qDrag.path || '';
  const folder = folderPath.split('/').filter(Boolean).pop() || '—';

  qGhostEl.innerHTML = `
    <div class="q-ghost-inner">
      <div class="q-ghost-icon"><i class="bi bi-grip-vertical"></i></div>
      <div class="q-ghost-text">
        <div class="q-ghost-title">${esc(discipline)}</div>
        <div class="q-ghost-sub">${esc(folder)}</div>
      </div>
    </div>
  `;
  qGhostEl.style.display = 'block';
  qGhostEl.classList.add('show');
  qDrag.ghost = qGhostEl;

  const gw = qGhostEl.offsetWidth;
  const gh = qGhostEl.offsetHeight;
  qDrag.offsetX = Math.max(10, Math.min(qDrag.offsetX, gw - 30));
  qDrag.offsetY = Math.max(6,  Math.min(qDrag.offsetY, gh - 6));

  const startLeft = e.clientX - qDrag.offsetX;
  const startTop  = e.clientY - qDrag.offsetY;
  qDrag.spring = { x: startLeft, y: startTop, tx: startLeft, ty: startTop, t: 0 };

  qGhostEl.style.transform = `translate(${startLeft}px, ${startTop}px)`;

  startQueueGhostTicker();
  updateQueueDropTarget(e.clientX, e.clientY);
}

function startQueueGhostTicker() {
  if (qGhostRaf) cancelAnimationFrame(qGhostRaf);
  const tick = () => {
    if (!qDrag?.active || !qDrag.ghost || !qDrag.spring) return;
    const s = qDrag.spring;

    s.x += (s.tx - s.x) * 0.22;
    s.y += (s.ty - s.y) * 0.22;

    s.t += 0.16;
    const dx = s.tx - s.x;
    const lean  = Math.max(-12, Math.min(12, dx * 0.7));
    const wob   = Math.sin(s.t) * 1.2;
    const bob   = Math.sin(s.t * 0.6) * 2;
    const scale = 1 + Math.sin(s.t * 0.15) * 0.03;

    qDrag.ghost.style.transform =
      `translate(${s.x}px, ${s.y + bob}px) rotate(${lean + wob}deg) scale(${scale})`;

    qGhostRaf = requestAnimationFrame(tick);
  };
  tick();
}

function moveQueueDrag(e) {
  if (qDrag?.spring) {
    qDrag.spring.tx = e.clientX - qDrag.offsetX;
    qDrag.spring.ty = e.clientY - qDrag.offsetY;
  }
  updateQueueDropTarget(e.clientX, e.clientY);
}

function computeQueueInsertIdx(mx, my) {
  const area = $('tab-second-content');
  const tbody = area.querySelector('tbody');
  if (!tbody) return -1;

  const rows = [...tbody.querySelectorAll('tr[data-path]')];
  const fromIdx = rows.indexOf(qDrag.tr);
  if (fromIdx < 0) return -1;

  const tbodyRect = tbody.getBoundingClientRect();

  if (my < tbodyRect.top) return 0;
  if (my > tbodyRect.bottom) return rows.length;

  const tops = qDrag.rowTops;
  if (!tops) return -1;

  let posInOthers = tops.length - 1;
  let othersSeen = 0;
  for (let i = 0; i < tops.length; i++) {
    if (i === fromIdx) continue;
    if (my < tops[i].mid) { posInOthers = othersSeen; break; }
    othersSeen++;
  }
  if (othersSeen === tops.length - 1 && my >= tops[tops.length - 1].mid) {
    posInOthers = tops.length - 1;
  }

  return posInOthers <= fromIdx ? posInOthers : posInOthers + 1;
}

function updateQueueDropTarget(mx, my) {
  if (!qDrag?.active) return;

  const rows = [...$('tab-second-content').querySelectorAll('tbody tr[data-path]')];
  const fromIdx = rows.indexOf(qDrag.tr);
  if (fromIdx < 0) return;

  const rawIdx = computeQueueInsertIdx(mx, my);
  if (rawIdx < 0) return;

  const insertIdx = (rawIdx === fromIdx || rawIdx === fromIdx + 1) ? fromIdx : rawIdx;

  if (insertIdx === qDrag.targetIdx) return;
  qDrag.targetIdx = insertIdx;

  clearQueueShifts();
  if (insertIdx === fromIdx) return;

  const h = qDrag.dragHeight;
  if (fromIdx < insertIdx) {
    for (let i = fromIdx + 1; i < insertIdx; i++) {
      rows[i].style.setProperty('--q-shift', h + 'px');
      rows[i].classList.add('q-shifted-up');
    }
  } else {
    for (let i = insertIdx; i < fromIdx; i++) {
      rows[i].style.setProperty('--q-shift', h + 'px');
      rows[i].classList.add('q-shifted-down');
    }
  }
}

function clearQueueShifts() {
  $('tab-second-content').querySelectorAll('tr.q-shifted-up, tr.q-shifted-down').forEach(el => {
    el.classList.remove('q-shifted-up', 'q-shifted-down');
    el.style.removeProperty('--q-shift');
  });
}

async function endQueueDrag() {
  const targetIdx = qDrag?.targetIdx ?? -1;
  const draggedPath = qDrag?.path;
  const ghost = qDrag?.ghost;

  if (qGhostRaf) { cancelAnimationFrame(qGhostRaf); qGhostRaf = 0; }

  if (ghost) {
    ghost.classList.remove('show');
    setTimeout(() => { if (!ghost.classList.contains('show')) ghost.style.display = 'none'; }, 150);
  }
  document.body.classList.remove('is-dragging-items');
  qDrag?.tr.classList.remove('q-dragging');
  clearQueueShifts();

  const fromIdxSaved = uploaderQueue.items.findIndex(t => String(t.folder_path) === draggedPath);
  qDrag = null;

  if (targetIdx < 0 || fromIdxSaved < 0) { renderUploaderQueue(); return; }
  if (targetIdx === fromIdxSaved || targetIdx === fromIdxSaved + 1) { renderUploaderQueue(); return; }

  const [moved] = uploaderQueue.items.splice(fromIdxSaved, 1);
  const insertAt = targetIdx > fromIdxSaved ? targetIdx - 1 : targetIdx;
  uploaderQueue.items.splice(insertAt, 0, moved);

  renderUploaderQueue();

  try {
    const paths = uploaderQueue.items.map(t => String(t.folder_path));
    const res = await postJSON(REORDER_TASKS_URL, { folder_paths: paths });
    if (Array.isArray(res.existing)) {
      uploaderQueue.items = res.existing;
      uploaderQueue.total = Number(res.total) || res.existing.length;
      updateQueueCounters();
      renderUploaderQueue();
    }
    toast('Порядок сохранён');
  } catch (err) {
    toast('Не удалось сохранить порядок: ' + err.message);
    loadUploaderQueue();
  }
}

/* =====================================================================
   МОДАЛКА ПОДТВЕРЖДЕНИЯ ЗАГРУЗКИ ОЧЕРЕДИ
   ===================================================================== */
const uploadQueueModalEl = document.getElementById('upload-queue-modal');
const uploadQueueModal = new bootstrap.Modal(uploadQueueModalEl);

function uploadQueueResetUi() {
  $('upload-queue-body').hidden = false;
  $('upload-queue-success').hidden = true;
  $('upload-queue-error').hidden = true;
  $('upload-queue-error').textContent = '';
  const confirmBtn = $('upload-queue-confirm');
  confirmBtn.disabled = false;
  confirmBtn.innerHTML = '<i class="bi bi-play-fill me-1"></i>Начать загрузку';
  $('upload-queue-cancel').disabled = false;
}

function uploadQueueRenderPreview() {
  const items = uploaderQueue.items;
  const total = items.length;

  // Сводная статистика
  const uniqueDisciplines = new Set(items.map(t => String(t.discipline || '').toLowerCase()).filter(Boolean));
  const withPres = items.filter(t => t.presentation).length;
  const withLecture = items.filter(t => t.lecture_count != null).length;

  $('upload-queue-stats').innerHTML = `
    <div class="uq-stat">
      <div class="uq-stat-value">${total}</div>
      <div class="uq-stat-label">Задач</div>
    </div>
    <div class="uq-stat">
      <div class="uq-stat-value">${uniqueDisciplines.size}</div>
      <div class="uq-stat-label">Дисциплин</div>
    </div>
    <div class="uq-stat">
      <div class="uq-stat-value">${withLecture}</div>
      <div class="uq-stat-label">С номером лекции</div>
    </div>
    <div class="uq-stat">
      <div class="uq-stat-value">${withPres}</div>
      <div class="uq-stat-label">Презентаций</div>
    </div>
  `;

  // Список задач (все, без обрезки — контейнер скроллится)
  const rows = items.map((t, i) => {
    const path = String(t.folder_path || '');
    const base = path.split('/').filter(Boolean).pop() || '—';
    const loc = LOCALE_LABELS[t.locale] || ('#' + t.locale);
    const lec = t.lecture_count ? `Лекция ${t.lecture_count}` : '—';
    const pres = t.presentation
      ? '<i class="bi bi-easel text-warning" title="Презентация"></i>'
      : '<span class="text-secondary">—</span>';
    return `<tr>
      <td class="text-secondary text-end" style="width:32px">${i + 1}</td>
      <td class="text-truncate" style="max-width:240px" title="${esc(t.discipline || '')}">
        ${esc(t.discipline || '—')}
      </td>
      <td class="text-truncate font-monospace small" style="max-width:200px" title="${esc(path)}">
        ${esc(base)}
      </td>
      <td class="small text-nowrap">${esc(loc)}</td>
      <td class="small text-nowrap">${esc(lec)}</td>
      <td class="text-center">${pres}</td>
    </tr>`;
  }).join('');

  $('upload-queue-list').innerHTML = `
    <table class="table table-sm table-hover align-middle mb-0">
      <thead class="table-light" style="position: sticky; top: 0;">
        <tr>
          <th class="text-end">#</th>
          <th>Дисциплина</th>
          <th>Папка</th>
          <th>Язык</th>
          <th>Лекция</th>
          <th class="text-center"><i class="bi bi-easel"></i></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  $('upload-queue-count').textContent = `Всего: ${total}`;
}

function uploadQueueOpen() {
  if (uploaderQueue.total === 0) {
    toast('Очередь пуста — нечего загружать');
    return;
  }
  uploadQueueResetUi();
  uploadQueueRenderPreview();
  uploadQueueModal.show();
}

$('uploader-queue-run').addEventListener('click', uploadQueueOpen);

$('upload-queue-confirm').addEventListener('click', async () => {
  const btn = $('upload-queue-confirm');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Запуск…';
  $('upload-queue-cancel').disabled = true;
  $('upload-queue-error').hidden = true;

  try {
    // Отправляем актуальную очередь — backend может прочитать и файл, но
    // так мы гарантируем, что запускаем ровно то, что видит пользователь.
    const res = await postJSON(RUN_UPLOAD_URL, { files: uploaderQueue.items });

    // Показываем экран успеха
    $('upload-queue-body').hidden = true;
    $('upload-queue-success').hidden = false;
    $('upload-queue-job').innerHTML = res?.job_id
      ? `ID задачи: <code>${esc(res.job_id)}</code>`
      : '';

    // Кнопка подтверждения больше не нужна — превращаем футер в «Закрыть»
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Готово';
    btn.disabled = false;

    toast('Загрузка запущена');

    // Обновим очередь на всякий случай (бэк может пометить задачи как выполненные)
    setTimeout(() => loadUploaderQueue(), 2000);
  } catch (err) {
    $('upload-queue-error').hidden = false;
    $('upload-queue-error').textContent = 'Не удалось запустить: ' + err.message;
    btn.disabled = false;
    btn.innerHTML = orig;
    $('upload-queue-cancel').disabled = false;
    toast('Ошибка запуска: ' + err.message);
  }
});

uploadQueueModalEl.addEventListener('hidden.bs.modal', () => {
  // Сброс на случай повторного открытия
  uploadQueueResetUi();
  // Если предыдущая попытка закончилась успехом — просто закроем и обновим
  loadUploaderQueue();
});

/* ========== Кнопки очереди (удаление / очистка / поиск) ========== */
$('uploader-queue-delete').addEventListener('click', async () => {
  if (!uploaderSelection.size) return;
  const n = uploaderSelection.size;
  if (!confirm(`Удалить ${n} ${n === 1 ? 'задачу' : 'задач'} из очереди?`)) return;
  try {
    const res = await postJSON(DELETE_TASKS_URL, { folder_paths: [...uploaderSelection] });
    uploaderSelection.clear();
    uploaderQueue.items = Array.isArray(res.remaining) ? res.remaining : [];
    uploaderQueue.total = Number(res.total) || uploaderQueue.items.length;
    updateQueueCounters();
    renderUploaderQueue();
    toast(`Удалено: ${res.removed ?? n}`);
  } catch (err) { toast('Ошибка удаления: ' + err.message); }
});

$('uploader-queue-clear').addEventListener('click', async () => {
  if (!uploaderQueue.total) return toast('Очередь уже пуста');
  if (!confirm(`Удалить ВСЕ ${uploaderQueue.total} задач из очереди?\nДействие необратимо.`)) return;
  try {
    const res = await postJSON(DELETE_TASKS_URL, { clear_all: true });
    uploaderSelection.clear();
    uploaderQueue.items = [];
    uploaderQueue.total = 0;
    updateQueueCounters();
    renderUploaderQueue();
    toast(`Очередь очищена (удалено ${res.removed ?? '—'})`);
  } catch (err) { toast('Ошибка: ' + err.message); }
});

$('uploader-queue-search').addEventListener('input', e => {
  uploaderQueue.query = e.target.value;
  renderUploaderQueue();
});
$('uploader-queue-refresh').addEventListener('click', () => {
  loadUploaderQueue().then(() => toast('Очередь обновлена'));
});

document.getElementById('tab-second-btn').addEventListener('shown.bs.tab', () => {
  loadUploaderQueue();
});

/* ========== Вкладки ========== */
document.querySelectorAll('#main-tabs [data-bs-toggle="tab"]').forEach(btn =>
  btn.addEventListener('shown.bs.tab', e => {
    try { localStorage.setItem('fm-tab', e.target.dataset.bsTarget); } catch (_) {}
  }));
try {
  const last = localStorage.getItem('fm-tab');
  if (last === '#tab-second') bootstrap.Tab.getOrCreateInstance($('tab-second-btn')).show();
} catch (_) {}

loadDir('/');
loadUploaderQueue();