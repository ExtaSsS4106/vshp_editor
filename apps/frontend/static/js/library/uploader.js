import { $, esc, toast, postJSON, getJSON } from '../cammon.js';
import { st, ORG_LABELS, LOCALE_LABELS, fmtSize, fmtTime } from './state.js';

// Убрали импорт из './api.js'
import { API } from './conf.js';

// Добавили ваши эндпоинты в деструктуризацию API
const { 
    list, deleteFiles, rename, move, addFolder, download, 
    upload, setTasks, getTasks, deleteTasks, reorderTasks, runUpload 
} = API;

import { loadDir, render } from './fs.js';

/* ---------- ЗАГРУЗКА ФАЙЛОВ ---------- */
let uploadState = null;
function uplShow(on) { $('upl').style.display = on ? 'block' : 'none'; }
function uplSet({ title, file, pct, bytes, speed, striped, cls }) {
    const bar = $('upl-bar');
    if (title != null) $('upl-title').innerHTML = title;
    if (file != null) $('upl-file').textContent = file;
    if (pct != null) { bar.style.width = pct + '%'; bar.textContent = Math.floor(pct) + '%'; }
    if (bytes != null) $('upl-bytes').textContent = bytes;
    if (speed != null) $('upl-speed').textContent = speed;
    bar.className = 'progress-bar' + (striped ? ' progress-bar-striped progress-bar-animated' : '') + (cls ? ' ' + cls : '');
}

export async function uploadFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (uploadState) return toast('Дождитесь окончания текущей загрузки');
    const folderName = st.currentPath, keepPath = st.currentPath;
    const total = files.reduce((s, f) => s + f.size, 0) || 1;
    const t0 = performance.now();

    const progress = pct => {
        const loaded = pct * total, sec = (performance.now() - t0) / 1000;
        const speed = sec > 0.3 ? loaded / sec : 0;
        let acc = 0, cur = files[files.length - 1];
        for (const f of files) { acc += f.size; if (loaded < acc) { cur = f; break; } }
        uplSet({ title: '<i class="bi bi-cloud-arrow-up me-1"></i>Загрузка', file: (files.length > 1 ? `[${files.indexOf(cur) + 1}/${files.length}] ` : '') + cur.name, pct: pct * 100, bytes: `${fmtSize(loaded)} из ${fmtSize(total)}`, speed: speed ? `${fmtSize(speed)}/с · ${fmtTime((total - loaded) / speed)}` : '', striped: false });
    };
    const processing = () => uplSet({ title: '<i class="bi bi-gear me-1"></i>Обработка на сервере…', pct: 100, bytes: `${fmtSize(total)} передано`, speed: '', striped: true });
    const finish = (ok, msg) => {
        uploadState = null;
        uplSet({ title: ok ? '<i class="bi bi-check-circle me-1 text-success"></i>Готово' : '<i class="bi bi-x-circle me-1 text-danger"></i>Ошибка', file: msg, pct: ok ? 100 : null, speed: '', striped: false, cls: ok ? 'bg-success' : 'bg-danger' });
        setTimeout(() => { if (!uploadState) uplShow(false); }, ok ? 1800 : 4000);
        if (ok) loadDir(keepPath);
    };

    uplShow(true); progress(0);
    const fd = new FormData();
    fd.append('folder', folderName);
    files.forEach(f => fd.append('file', f, f.name));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', upload);
    xhr.upload.onprogress = e => { if (e.lengthComputable) progress(e.loaded / e.total); };
    xhr.upload.onload = processing;
    xhr.onload = () => { let j = {}; try { j = JSON.parse(xhr.responseText); } catch (_) {} if (xhr.status >= 200 && xhr.status < 300) finish(true, `Загружено файлов: ${(j.files || []).length}`); else finish(false, j.error || ('Ошибка ' + xhr.status)); };
    xhr.onerror = () => finish(false, 'Ошибка сети');
    xhr.onabort = () => { uploadState = null; uplShow(false); toast('Загрузка отменена'); };
    uploadState = { xhr, cancel() { xhr.abort(); } };
    xhr.send(fd);
}

export function initUploadDragDrop() {
    $('upl-cancel').onclick = () => { if (uploadState) uploadState.cancel(); else uplShow(false); };
    $('btn-upload').onclick = () => $('file-input').click();
    $('file-input').onchange = e => { uploadFiles(e.target.files); e.target.value = ''; };
    const isFiles = e => $('tab-files').classList.contains('active') && e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    let depth = 0;
    document.addEventListener('dragenter', e => { if (!isFiles(e)) return; depth++; $('fm-area').classList.add('drop'); });
    document.addEventListener('dragleave', e => { if (!isFiles(e)) return; if (--depth <= 0) { depth = 0; $('fm-area').classList.remove('drop'); } });
    document.addEventListener('dragover', e => { if (isFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', e => { if (!isFiles(e)) return; e.preventDefault(); depth = 0; $('fm-area').classList.remove('drop'); uploadFiles(e.dataTransfer.files); });
}

/* ---------- МОДАЛКА ЗАГРУЗЧИКА ---------- */
let uploaderModal = null, uploaderModalEl = null, uploaderForm = null;
function ensureUploader() {
    if (uploaderModal) return;
    uploaderModalEl = $('uploader-modal');
    uploaderModal = new bootstrap.Modal(uploaderModalEl);
    uploaderForm = $('uploader-form');
    uploaderModalEl.addEventListener('hidden.bs.modal', () => uploaderSetMode(null));
    uploaderForm.addEventListener('input', uploaderRefresh);
    uploaderForm.addEventListener('change', uploaderRefresh);
    uploaderForm.addEventListener('submit', e => e.preventDefault());
    $('uploader-copy').onclick = async () => {
        const miss = uploaderMissing();
        if (miss.length) return toast('Заполните: ' + miss.join(', '));
        try { await navigator.clipboard.writeText(uploaderJson()); toast('JSON скопирован'); }
        catch (err) {
            const ta = document.createElement('textarea');
            ta.value = uploaderJson(); ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); toast('JSON скопирован'); } catch (_) { toast('Не удалось: ' + err.message); }
            ta.remove();
        }
    };
    $('uploader-download').onclick = () => {
        const miss = uploaderMissing();
        if (miss.length) return toast('Заполните: ' + miss.join(', '));
        const blob = new Blob([uploaderJson()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const fn = (uploaderPayload().folder_path.split('/').pop() || 'upload_task').replace(/[^\w.-]+/g, '_');
        const a = document.createElement('a');
        a.href = url; a.download = `${fn}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Файл скачан: ' + a.download);
    };
    $('uploader-save').onclick = async () => {
        const miss = uploaderMissing();
        if (miss.length) return toast('Заполните: ' + miss.join(', '));
        const btn = $('uploader-save'), orig = btn.innerHTML;
        const wasEditing = !!st.uploaderEditingPath;
        btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Отправка…';
        const payload = uploaderPayload();
        try {
            const res = await postJSON(setTasks, { tasks: [payload] });
            uploaderShowResult(res, payload);
            toast(wasEditing ? 'Задача обновлена' : 'Сохранено');
            loadUploaderQueue();
        } catch (err) { uploaderShowError(err.message); toast('Ошибка: ' + err.message); }
        finally { btn.disabled = false; btn.innerHTML = orig; }
    };
}

function uploaderSetMode(editing) {
    st.uploaderEditingPath = editing ? String(editing) : null;
    $('uploader-modal-title').innerHTML = editing ? '<i class="bi bi-pencil me-1"></i>Редактировать задачу' : '<i class="bi bi-box-arrow-up me-1"></i>Добавить в загрузчик библиотеки';
    $('uploader-save').innerHTML = editing ? '<i class="bi bi-check2-circle me-1"></i>Сохранить изменения' : '<i class="bi bi-cloud-upload me-1"></i>Сохранить в очередь';
}

function uploaderPayload() {
    const g = n => uploaderForm.querySelector(`[name="${n}"]`);
    const lec = g('lecture_count').value.trim(), add = g('additional_name').value.trim();
    return { additional_name: add || null, author: g('author').value.trim(), discipline: g('discipline').value.trim(), folder_path: g('folder_path').value, lecture_count: lec ? parseInt(lec, 10) : null, locale: parseInt(g('locale').value, 10), organization: parseInt(g('organization').value, 10), presentation: g('presentation').checked };
}
function uploaderJson() { return JSON.stringify(uploaderPayload(), null, 2); }
function uploaderMissing() {
    const p = uploaderPayload(); const m = [];
    if (!p.discipline) m.push('Дисциплина');
    if (!p.author) m.push('Автор');
    if (!p.folder_path) m.push('Путь к папке');
    return m;
}
function uploaderRefresh() {
    $('uploader-json').textContent = uploaderJson();
    const m = uploaderMissing(), el = $('uploader-validation');
    if (m.length) { el.textContent = 'Не заполнено: ' + m.join(', '); el.className = 'text-danger small'; }
    else { el.textContent = 'Готово'; el.className = 'text-success small'; }
}

export function openUploaderModal(folder) {
    ensureUploader();
    if (!st.libraryRoot) return toast('Корень библиотеки неизвестен — обновите страницу');
    uploaderForm.reset(); uploaderSetMode(null);
    uploaderForm.querySelector('[name="folder_path"]').value = st.libraryRoot.replace(/\/+$/, '') + folder.path;
    uploaderForm.querySelector('[name="author"]').value = '-';
    uploaderForm.querySelector('[name="organization"]').value = '1';
    uploaderForm.querySelector('[name="locale"]').value = '1';
    uploaderForm.querySelector('[name="presentation"]').checked = false;
    $('uploader-result').hidden = true; $('uploader-result').innerHTML = '';
    uploaderRefresh(); uploaderModal.show();
    setTimeout(() => uploaderForm.querySelector('[name="discipline"]').focus(), 200);
}

export function openUploaderEdit(task) {
    ensureUploader();
    if (!task) return;
    uploaderForm.reset(); uploaderSetMode(task.folder_path);
    const g = n => uploaderForm.querySelector(`[name="${n}"]`);
    g('discipline').value = task.discipline || '';
    g('organization').value = String(task.organization ?? 1);
    g('locale').value = String(task.locale ?? 1);
    g('author').value = task.author || '-';
    g('additional_name').value = task.additional_name || '';
    g('lecture_count').value = task.lecture_count != null ? String(task.lecture_count) : '';
    g('presentation').checked = !!task.presentation;
    g('folder_path').value = task.folder_path || '';
    $('uploader-result').hidden = true; $('uploader-result').innerHTML = '';
    uploaderRefresh(); uploaderModal.show();
    setTimeout(() => g('discipline').focus(), 200);
}

function uploaderShowError(msg) {
    const el = $('uploader-result');
    el.hidden = false;
    el.innerHTML = `<div class="alert alert-danger d-flex gap-2 align-items-start mb-0"><i class="bi bi-exclamation-triangle-fill fs-5"></i><div class="flex-grow-1"><strong>Не удалось сохранить</strong><div class="small mt-1">${esc(msg)}</div></div></div>`;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function uploaderShowResult(res, sent) {
    const total = Number(res?.total) || 0;
    const existing = Array.isArray(res?.existing) ? res.existing : [];
    const mine = existing.find(t => t.folder_path === sent.folder_path);
    const rows = existing.map(t => {
        const isMine = t.folder_path === sent.folder_path;
        const lec = t.lecture_count ? `Лекция ${t.lecture_count}` : '—';
        const pres = t.presentation ? '<i class="bi bi-easel text-warning"></i>' : '';
        return `<tr${isMine ? ' class="table-success"' : ''}><td class="text-truncate" style="max-width:160px">${esc(t.discipline || '—')}</td><td class="text-truncate font-monospace" style="max-width:220px">${esc((t.folder_path || '').split('/').pop() || '—')}</td><td>${lec}</td><td>${pres}</td></tr>`;
    }).join('');
    const el = $('uploader-result');
    el.hidden = false;
    el.innerHTML = `<div class="alert alert-success d-flex gap-2 align-items-start mb-2"><i class="bi bi-check-circle-fill fs-4 text-success"></i><div class="flex-grow-1"><strong>${mine ? 'Задача в очереди' : 'Задача отправлена'}</strong><div class="small mt-1">Всего: <strong>${total}</strong></div></div></div><details class="border rounded p-2 bg-body-tertiary"><summary class="small text-secondary" style="cursor:pointer">Показать очередь (${total})</summary><div class="table-responsive mt-2" style="max-height:220px;overflow:auto;"><table class="table table-sm table-hover mb-0"><thead class="table-light"><tr><th>Дисциплина</th><th>Папка</th><th>Лекция</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="text-secondary text-center">Очередь пуста</td></tr>'}</tbody></table></div></details>`;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- ОЧЕРЕДЬ ---------- */
function filteredQueueItems() {
    const q = st.uploaderQueue.query.trim().toLowerCase();
    if (!q) return st.uploaderQueue.items;
    return st.uploaderQueue.items.filter(t => (t.discipline || '').toLowerCase().includes(q) || (t.folder_path || '').toLowerCase().includes(q) || (t.author || '').toLowerCase().includes(q) || (t.additional_name || '').toLowerCase().includes(q));
}

export async function loadUploaderQueue() {
    const Q = st.uploaderQueue;
    Q.loading = true; Q.error = null; renderUploaderQueue();
    try {
        const res = await getJSON(getTasks);
        Q.items = Array.isArray(res.existing) ? res.existing : [];
        Q.total = Number(res.total) || Q.items.length;
    } catch (err) { Q.items = []; Q.total = 0; Q.error = err.message; }
    finally {
        Q.loading = false;
        const alive = new Set(Q.items.map(t => String(t.folder_path || '')));
        for (const p of [...st.uploaderSelection]) if (!alive.has(p)) st.uploaderSelection.delete(p);
        updateQueueCounters(); renderUploaderQueue();
    }
}

function updateQueueCounters() {
    const Q = st.uploaderQueue;
    $('tab-second-badge').textContent = String(Q.total);
    $('uploader-queue-total').textContent = String(Q.total);
    const d = $('uploader-queue-delete'), dc = $('uploader-queue-delete-count');
    if (d && dc) { d.disabled = st.uploaderSelection.size === 0; dc.hidden = st.uploaderSelection.size === 0; dc.textContent = String(st.uploaderSelection.size); }
    const r = $('uploader-queue-run'); if (r) r.disabled = Q.total === 0;
}

export function renderUploaderQueue() {
    const area = $('tab-second-content');
    if (!area) return;
    const Q = st.uploaderQueue;
    if (Q.loading) { area.innerHTML = `<div class="text-center py-5 text-secondary"><div class="spinner-border spinner-border-sm mb-2"></div><div class="small">Загрузка очереди…</div></div>`; updateQueueCounters(); return; }
    if (Q.error) {
        area.innerHTML = `<div class="p-3"><div class="alert alert-danger d-flex gap-2 align-items-start mb-0"><i class="bi bi-exclamation-triangle-fill fs-5"></i><div class="flex-grow-1"><strong>Ошибка</strong><div class="small mt-1">${esc(Q.error)}</div><button class="btn btn-sm btn-outline-danger mt-2" id="uploader-queue-retry"><i class="bi bi-arrow-clockwise me-1"></i>Повторить</button></div></div></div>`;
        area.querySelector('#uploader-queue-retry')?.addEventListener('click', loadUploaderQueue);
        updateQueueCounters(); return;
    }
    if (!Q.total) {
        area.innerHTML = `<div class="text-center py-5 text-secondary"><i class="bi bi-inbox display-4 d-block mb-2 opacity-50"></i><div>Очередь пуста</div><div class="small mt-2">ПКМ на папке в «Файлах» → «Добавить в загрузчик»</div></div>`;
        updateQueueCounters(); return;
    }
    const filtered = filteredQueueItems();
    const allChecked = filtered.length > 0 && filtered.every(t => st.uploaderSelection.has(String(t.folder_path || '')));
    const rows = filtered.map((t, i) => {
        const fp = String(t.folder_path || ''); const checked = st.uploaderSelection.has(fp);
        const base = fp.split('/').filter(Boolean).pop() || '—';
        const parent = fp.replace(/[\\/][^\\/]+$/, '');
        const tail = parent.split('/').filter(Boolean).slice(-2).join('/') || '';
        const org = ORG_LABELS[t.organization] || ('#' + t.organization);
        const loc = LOCALE_LABELS[t.locale] || ('#' + t.locale);
        const lec = t.lecture_count ? `<span class="badge text-bg-light border">${t.lecture_count}</span>` : '<span class="text-secondary">—</span>';
        const pres = t.presentation ? '<i class="bi bi-easel text-warning"></i>' : '<span class="text-secondary">—</span>';
        return `<tr data-path="${esc(fp)}"${checked ? ' class="row-selected"' : ''}>
            <td class="text-center"><input type="checkbox" class="form-check-input row-check" data-path="${esc(fp)}" ${checked ? 'checked' : ''}></td>
            <td class="text-center text-secondary" style="width:32px"><i class="bi bi-grip-vertical"></i></td>
            <td class="text-secondary text-end">${i + 1}</td>
            <td class="cell-disc"><div class="text-truncate">${esc(t.discipline || '—')}</div>${t.additional_name ? `<div class="small text-secondary text-truncate">${esc(t.additional_name)}</div>` : ''}</td>
            <td class="cell-path font-monospace small"><div class="text-truncate">${esc(base)}</div>${tail ? `<div class="small text-secondary text-truncate">…/${esc(tail)}</div>` : ''}</td>
            <td class="small text-nowrap">${esc(t.author || '—')}</td>
            <td class="small text-nowrap">${esc(loc)}</td>
            <td class="small text-nowrap"><div class="text-truncate" style="max-width:150px">${esc(org)}</div></td>
            <td class="text-center">${lec}</td>
            <td class="text-center">${pres}</td>
            <td class="text-end text-nowrap">
                <button class="btn btn-sm btn-outline-primary btn-row-action" data-edit-path="${esc(fp)}" title="Ред."><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-secondary btn-row-action" data-copy-path="${esc(fp)}" title="Копировать"><i class="bi bi-clipboard"></i></button>
                <button class="btn btn-sm btn-outline-danger btn-row-action" data-del-path="${esc(fp)}" title="Удалить"><i class="bi bi-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
    const footer = Q.query ? `<div class="small text-secondary px-3 py-2 border-top">Показано ${filtered.length} из ${Q.items.length}</div>` : '';
    area.innerHTML = `<table class="table table-sm table-hover align-middle mb-0"><thead><tr>
        <th class="text-center" style="width:36px"><input type="checkbox" class="form-check-input" id="uploader-queue-check-all" ${allChecked ? 'checked' : ''}></th>
        <th style="width:32px"></th><th class="text-end" style="width:40px">#</th>
        <th>Дисциплина</th><th>Папка</th><th>Автор</th><th>Язык</th><th>Организация</th>
        <th class="text-center">Лекция</th><th class="text-center"><i class="bi bi-easel"></i></th><th style="width:130px"></th>
    </tr></thead><tbody>${rows || `<tr><td colspan="11" class="text-center text-secondary py-4">Ничего не найдено по запросу «${esc(Q.query)}»</td></tr>`}</tbody></table>${footer}`;
    updateQueueCounters();
}

/* ---------- DRAG REORDER ---------- */
let qDrag = null, qGhostRaf = 0, qSuppressClick = false;

function clearQueueShifts() {
    document.querySelectorAll('#tab-second-content tr.q-shifted-up, #tab-second-content tr.q-shifted-down').forEach(el => {
        el.classList.remove('q-shifted-up', 'q-shifted-down'); el.style.removeProperty('--q-shift');
    });
}

async function endQueueDrag() {
    const targetIdx = qDrag?.targetIdx ?? -1;
    const draggedPath = qDrag?.path;
    const ghost = qDrag?.ghost;
    if (qGhostRaf) { cancelAnimationFrame(qGhostRaf); qGhostRaf = 0; }
    if (ghost) { ghost.classList.remove('show'); setTimeout(() => { if (!ghost.classList.contains('show')) ghost.style.display = 'none'; }, 150); }
    document.body.classList.remove('is-dragging-items');
    qDrag?.tr.classList.remove('q-dragging');
    clearQueueShifts();
    const Q = st.uploaderQueue;
    const fromIdxSaved = Q.items.findIndex(t => String(t.folder_path) === draggedPath);
    qDrag = null;
    if (targetIdx < 0 || fromIdxSaved < 0) { renderUploaderQueue(); return; }
    if (targetIdx === fromIdxSaved || targetIdx === fromIdxSaved + 1) { renderUploaderQueue(); return; }
    const [moved] = Q.items.splice(fromIdxSaved, 1);
    const insertAt = targetIdx > fromIdxSaved ? targetIdx - 1 : targetIdx;
    Q.items.splice(insertAt, 0, moved);
    renderUploaderQueue();
    try {
        const paths = Q.items.map(t => String(t.folder_path));
        const res = await postJSON(reorderTasks, { folder_paths: paths });
        if (Array.isArray(res.existing)) { Q.items = res.existing; Q.total = Number(res.total) || res.existing.length; updateQueueCounters(); renderUploaderQueue(); }
        toast('Порядок сохранён');
    } catch (err) { toast('Не удалось: ' + err.message); loadUploaderQueue(); }
}

export function initQueueHandlers() {
    const area = $('tab-second-content');

    area.addEventListener('click', async e => {
        if (qSuppressClick) { qSuppressClick = false; return; }
        if (e.target.matches('#uploader-queue-check-all')) {
            const on = e.target.checked;
            for (const t of filteredQueueItems()) {
                const p = String(t.folder_path || '');
                if (on) st.uploaderSelection.add(p); else st.uploaderSelection.delete(p);
            }
            renderUploaderQueue(); return;
        }
        const check = e.target.closest('.row-check');
        if (check) {
            if (check.checked) st.uploaderSelection.add(check.dataset.path); else st.uploaderSelection.delete(check.dataset.path);
            renderUploaderQueue(); return;
        }
        const editBtn = e.target.closest('[data-edit-path]');
        if (editBtn) {
            const task = st.uploaderQueue.items.find(t => String(t.folder_path) === editBtn.dataset.editPath);
            if (task) openUploaderEdit(task);
            return;
        }
        const tr = e.target.closest('tr[data-path]');
        if (tr && !e.target.closest('button, input[type="checkbox"], a')) {
            if (st.uploaderSelection.has(tr.dataset.path)) st.uploaderSelection.delete(tr.dataset.path); else st.uploaderSelection.add(tr.dataset.path);
            renderUploaderQueue(); return;
        }
        const copyBtn = e.target.closest('[data-copy-path]');
        if (copyBtn) {
            try { await navigator.clipboard.writeText(copyBtn.dataset.copyPath); toast('Скопировано'); } catch { toast('Не удалось'); }
            return;
        }
        const delBtn = e.target.closest('[data-del-path]');
        if (delBtn) {
            if (!confirm(`Удалить задачу?\n${delBtn.dataset.delPath}`)) return;
            try {
                const res = await postJSON(deleteTasks, { folder_paths: [delBtn.dataset.delPath] });
                st.uploaderSelection.delete(delBtn.dataset.delPath);
                st.uploaderQueue.items = Array.isArray(res.remaining) ? res.remaining : [];
                st.uploaderQueue.total = Number(res.total) || st.uploaderQueue.items.length;
                updateQueueCounters(); renderUploaderQueue(); toast(`Удалено: ${res.removed ?? 1}`);
            } catch (err) { toast('Ошибка: ' + err.message); }
        }
    });

    area.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, a, select, textarea')) return;
        const tr = e.target.closest('tr[data-path]'); if (!tr) return;
        const rect = tr.getBoundingClientRect();
        qDrag = { tr, path: tr.dataset.path, startX: e.clientX, startY: e.clientY, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, rect, active: false, ghost: null, targetIdx: -1, dragHeight: Math.round(rect.height), spring: null, rowTops: null };
    });

    document.addEventListener('mousemove', e => {
        if (!qDrag) return;
        if (!qDrag.active) {
            if (Math.hypot(e.clientX - qDrag.startX, e.clientY - qDrag.startY) < 6) return;
            startQDrag(e);
        }
        if (qDrag?.active) moveQDrag(e);
    });

    document.addEventListener('mouseup', () => {
        if (!qDrag) return;
        if (qDrag.active) { qSuppressClick = true; endQueueDrag(); }
        else qDrag = null;
    });
}

function startQDrag(e) {
    const qGhostEl = document.getElementById('queue-ghost');
    const tr = qDrag.tr;
    qDrag.active = true;
    qDrag.rect = tr.getBoundingClientRect();
    qDrag.dragHeight = Math.round(qDrag.rect.height);
    const rows = [...document.querySelectorAll('#tab-second-content tbody tr[data-path]')];
    qDrag.rowTops = rows.map(r => { const b = r.getBoundingClientRect(); return { top: b.top, mid: b.top + b.height / 2, height: b.height }; });
    tr.classList.add('q-dragging');
    document.body.classList.add('is-dragging-items');
    const item = st.uploaderQueue.items.find(t => String(t.folder_path) === qDrag.path);
    const disc = item?.discipline || '—';
    const folder = (qDrag.path || '').split('/').filter(Boolean).pop() || '—';
    qGhostEl.innerHTML = `<div class="q-ghost-inner"><div class="q-ghost-icon"><i class="bi bi-grip-vertical"></i></div><div class="q-ghost-text"><div class="q-ghost-title">${esc(disc)}</div><div class="q-ghost-sub">${esc(folder)}</div></div></div>`;
    qGhostEl.style.display = 'block';
    qGhostEl.classList.add('show');
    qDrag.ghost = qGhostEl;
    const gw = qGhostEl.offsetWidth, gh = qGhostEl.offsetHeight;
    qDrag.offsetX = Math.max(10, Math.min(qDrag.offsetX, gw - 30));
    qDrag.offsetY = Math.max(6, Math.min(qDrag.offsetY, gh - 6));
    const L = e.clientX - qDrag.offsetX, T = e.clientY - qDrag.offsetY;
    qDrag.spring = { x: L, y: T, tx: L, ty: T, t: 0 };
    qGhostEl.style.transform = `translate(${L}px, ${T}px)`;
    if (qGhostRaf) cancelAnimationFrame(qGhostRaf);
    const tick = () => {
        if (!qDrag?.active || !qDrag.ghost || !qDrag.spring) return;
        const s = qDrag.spring;
        s.x += (s.tx - s.x) * 0.22; s.y += (s.ty - s.y) * 0.22; s.t += 0.16;
        const lean = Math.max(-12, Math.min(12, (s.tx - s.x) * 0.7));
        const wob = Math.sin(s.t) * 1.2, bob = Math.sin(s.t * 0.6) * 2;
        qDrag.ghost.style.transform = `translate(${s.x}px, ${s.y + bob}px) rotate(${lean + wob}deg) scale(${1 + Math.sin(s.t * 0.15) * 0.03})`;
        qGhostRaf = requestAnimationFrame(tick);
    };
    tick();
    updateQTarget(e.clientX, e.clientY);
}

function moveQDrag(e) {
    if (qDrag?.spring) { qDrag.spring.tx = e.clientX - qDrag.offsetX; qDrag.spring.ty = e.clientY - qDrag.offsetY; }
    updateQTarget(e.clientX, e.clientY);
}

function updateQTarget(mx, my) {
    if (!qDrag?.active) return;
    const rows = [...document.querySelectorAll('#tab-second-content tbody tr[data-path]')];
    const fromIdx = rows.indexOf(qDrag.tr);
    if (fromIdx < 0) return;
    const tbody = document.querySelector('#tab-second-content tbody');
    const tr = tbody.getBoundingClientRect();
    let raw = -1;
    if (my < tr.top) raw = 0;
    else if (my > tr.bottom) raw = rows.length;
    else {
        let pos = rows.length - 1, seen = 0;
        for (let i = 0; i < qDrag.rowTops.length; i++) {
            if (i === fromIdx) continue;
            if (my < qDrag.rowTops[i].mid) { pos = seen; break; }
            seen++;
        }
        if (seen === qDrag.rowTops.length - 1 && my >= qDrag.rowTops[qDrag.rowTops.length - 1].mid) pos = qDrag.rowTops.length - 1;
        raw = pos <= fromIdx ? pos : pos + 1;
    }
    if (raw < 0) return;
    const insertIdx = (raw === fromIdx || raw === fromIdx + 1) ? fromIdx : raw;
    if (insertIdx === qDrag.targetIdx) return;
    qDrag.targetIdx = insertIdx;
    clearQueueShifts();
    if (insertIdx === fromIdx) return;
    const h = qDrag.dragHeight;
    if (fromIdx < insertIdx) for (let i = fromIdx + 1; i < insertIdx; i++) { rows[i].style.setProperty('--q-shift', h + 'px'); rows[i].classList.add('q-shifted-up'); }
    else for (let i = insertIdx; i < fromIdx; i++) { rows[i].style.setProperty('--q-shift', h + 'px'); rows[i].classList.add('q-shifted-down'); }
}

/* ---------- МОДАЛКА ПОДТВЕРЖДЕНИЯ ЗАГРУЗКИ ОЧЕРЕДИ ---------- */
let uploadQueueModal = null, uploadQueueModalEl = null;
function ensureUploadQueue() {
    if (uploadQueueModal) return;
    uploadQueueModalEl = document.getElementById('upload-queue-modal');
    uploadQueueModal = new bootstrap.Modal(uploadQueueModalEl);
    uploadQueueModalEl.addEventListener('hidden.bs.modal', () => { uploadQueueResetUi(); loadUploaderQueue(); });
}

function uploadQueueResetUi() {
    $('upload-queue-body').hidden = false;
    $('upload-queue-success').hidden = true;
    $('upload-queue-error').hidden = true;
    $('upload-queue-error').textContent = '';
    const c = $('upload-queue-confirm');
    c.disabled = false; c.innerHTML = '<i class="bi bi-play-fill me-1"></i>Начать загрузку';
    $('upload-queue-cancel').disabled = false;
}

function uploadQueueRenderPreview() {
    const items = st.uploaderQueue.items, total = items.length;
    const uniqD = new Set(items.map(t => String(t.discipline || '').toLowerCase()).filter(Boolean));
    const pres = items.filter(t => t.presentation).length;
    const lec = items.filter(t => t.lecture_count != null).length;
    $('upload-queue-stats').innerHTML = `
        <div class="uq-stat"><div class="uq-stat-value">${total}</div><div class="uq-stat-label">Задач</div></div>
        <div class="uq-stat"><div class="uq-stat-value">${uniqD.size}</div><div class="uq-stat-label">Дисциплин</div></div>
        <div class="uq-stat"><div class="uq-stat-value">${lec}</div><div class="uq-stat-label">С номером лекции</div></div>
        <div class="uq-stat"><div class="uq-stat-value">${pres}</div><div class="uq-stat-label">Презентаций</div></div>`;
    const rows = items.map((t, i) => {
        const p = String(t.folder_path || ''); const base = p.split('/').filter(Boolean).pop() || '—';
        const loc = LOCALE_LABELS[t.locale] || ('#' + t.locale);
        const l = t.lecture_count ? `Лекция ${t.lecture_count}` : '—';
        const pr = t.presentation ? '<i class="bi bi-easel text-warning"></i>' : '<span class="text-secondary">—</span>';
        return `<tr><td class="text-secondary text-end" style="width:32px">${i + 1}</td><td class="text-truncate" style="max-width:240px">${esc(t.discipline || '—')}</td><td class="text-truncate font-monospace small" style="max-width:200px">${esc(base)}</td><td class="small text-nowrap">${esc(loc)}</td><td class="small text-nowrap">${esc(l)}</td><td class="text-center">${pr}</td></tr>`;
    }).join('');
    $('upload-queue-list').innerHTML = `<table class="table table-sm table-hover align-middle mb-0"><thead class="table-light" style="position:sticky;top:0;"><tr><th class="text-end">#</th><th>Дисциплина</th><th>Папка</th><th>Язык</th><th>Лекция</th><th class="text-center"><i class="bi bi-easel"></i></th></tr></thead><tbody>${rows}</tbody></table>`;
    $('upload-queue-count').textContent = `Всего: ${total}`;
}

export function initUploadQueueHandlers() {
    $('uploader-queue-run').addEventListener('click', () => {
        ensureUploadQueue();
        if (st.uploaderQueue.total === 0) return toast('Очередь пуста');
        uploadQueueResetUi(); uploadQueueRenderPreview(); uploadQueueModal.show();
    });

    ensureUploadQueue();
    $('upload-queue-confirm').addEventListener('click', async () => {
        const btn = $('upload-queue-confirm'), orig = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Запуск…';
        $('upload-queue-cancel').disabled = true; $('upload-queue-error').hidden = true;
        try {
            const res = await postJSON(runUpload, { files: st.uploaderQueue.items });
            $('upload-queue-body').hidden = true; $('upload-queue-success').hidden = false;
            $('upload-queue-job').innerHTML = res?.job_id ? `ID задачи: <code>${esc(res.job_id)}</code>` : '';
            btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Готово'; btn.disabled = false;
            toast('Загрузка запущена');
            setTimeout(() => loadUploaderQueue(), 2000);
        } catch (err) {
            $('upload-queue-error').hidden = false;
            $('upload-queue-error').textContent = 'Не удалось: ' + err.message;
            btn.disabled = false; btn.innerHTML = orig; $('upload-queue-cancel').disabled = false;
            toast('Ошибка: ' + err.message);
        }
    });

    $('uploader-queue-delete').addEventListener('click', async () => {
        if (!st.uploaderSelection.size) return;
        const n = st.uploaderSelection.size;
        if (!confirm(`Удалить ${n} задач?`)) return;
        try {
            const res = await postJSON(deleteTasks, { folder_paths: [...st.uploaderSelection] });
            st.uploaderSelection.clear();
            st.uploaderQueue.items = Array.isArray(res.remaining) ? res.remaining : [];
            st.uploaderQueue.total = Number(res.total) || st.uploaderQueue.items.length;
            updateQueueCounters(); renderUploaderQueue(); toast(`Удалено: ${res.removed ?? n}`);
        } catch (err) { toast('Ошибка: ' + err.message); }
    });

    $('uploader-queue-clear').addEventListener('click', async () => {
        if (!st.uploaderQueue.total) return toast('Очередь уже пуста');
        if (!confirm(`Удалить ВСЕ ${st.uploaderQueue.total} задач?`)) return;
        try {
            const res = await postJSON(deleteTasks, { clear_all: true });
            st.uploaderSelection.clear(); st.uploaderQueue.items = []; st.uploaderQueue.total = 0;
            updateQueueCounters(); renderUploaderQueue();
            toast(`Очищено: ${res.removed ?? '—'}`);
        } catch (err) { toast('Ошибка: ' + err.message); }
    });

    $('uploader-queue-search').addEventListener('input', e => { st.uploaderQueue.query = e.target.value; renderUploaderQueue(); });
    $('uploader-queue-refresh').addEventListener('click', () => { loadUploaderQueue().then(() => toast('Очередь обновлена')); });
    document.getElementById('tab-second-btn').addEventListener('shown.bs.tab', () => loadUploaderQueue());
}