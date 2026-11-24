import { $, esc, toast, postJSON } from '../cammon.js';
import { st, filesTabActive, parentOf, inSubtree, iconFor, metaOf } from './state.js';
import { API } from './conf.js';
const { list, deleteFiles, rename, move, addFolder, download } = API;
import { openPreview } from './preview.js';
import { openUploaderModal } from './uploader.js';

export async function loadDir(path = null, { pushHistory = false } = {}) {
    if (path === null) path = st.currentPath;
    if (pushHistory && path !== st.currentPath) st.history.push(st.currentPath);
    try {
        const json = await postJSON(list, { current_path: path });
        if (json.library_root) st.libraryRoot = String(json.library_root);
        st.currentPath = json.current_path || path;
        st.items = json.data || [];
        st.selected.clear();
        st.query = '';
        $('search').value = '';
        render();
    } catch (err) {
        $('fm-area').innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`;
    }
}

export function goUp() { if (st.currentPath !== '/') loadDir(parentOf(st.currentPath), { pushHistory: true }); }
export function goBack() { const p = st.history.pop(); if (p !== undefined) loadDir(p); }

export function openItem(item) {
    if (item.is_dir) loadDir(item.path, { pushHistory: true });
    else openPreview(item, downloadItems);
}

function renderPathBar() {
    const parts = st.currentPath.split('/').filter(Boolean);
    const crumbs = [{ name: 'Библиотека', path: '/' }];
    let acc = '';
    for (const p of parts) { acc += '/' + p; crumbs.push({ name: p, path: acc }); }
    $('pathbar').innerHTML = crumbs.map((c, i) =>
        (i ? '<i class="bi bi-chevron-right small text-secondary"></i>' : '<i class="bi bi-hdd me-1"></i>') +
        `<button class="seg" data-path="${esc(c.path)}">${esc(c.name)}</button>`
    ).join('');
    $('pathbar').querySelectorAll('[data-path]').forEach(b => b.onclick = () => loadDir(b.dataset.path, { pushHistory: true }));
}

function visibleItems() {
    const q = st.query.toLowerCase();
    const items = st.items.filter(i => i.name.toLowerCase().includes(q));
    const dir = st.asc ? 1 : -1;
    const ext = i => i.name.includes('.') ? i.name.split('.').pop().toLowerCase() : '';
    items.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        let r = 0;
        if (st.sort === 'type') r = ext(a).localeCompare(ext(b));
        if (st.sort === 'size') r = (a.size || 0) - (b.size || 0);
        if (r === 0) r = a.name.localeCompare(b.name, 'ru');
        return r * dir;
    });
    return items;
}

export function render() {
    renderPathBar();
    const items = visibleItems();
    const area = $('fm-area');
    area.className = 'card-body ' + (st.view === 'grid' ? 'fm-grid' : 'fm-list');
    area.innerHTML = items.length
        ? items.map(item => {
            const sel = st.selected.has(item.path) ? ' selected' : '';
            const meta = metaOf(item);
            const attrs = `class="fm-item${sel}" data-path="${esc(item.path)}" data-is-dir="${item.is_dir}"`;
            return st.view === 'grid'
                ? `<div ${attrs}><i class="fm-icon bi ${iconFor(item)}"></i><span class="fm-name">${esc(item.name)}</span>${meta ? `<span class="d-block small text-secondary">${meta}</span>` : ''}</div>`
                : `<div ${attrs}><i class="fm-icon bi ${iconFor(item)}"></i><span>${esc(item.name)}</span><span class="fm-meta">${meta}</span></div>`;
        }).join('')
        : `<p class="text-secondary text-center mt-5 w-100" style="grid-column:1/-1">${st.query ? 'Ничего не найдено' : 'Папка пуста. Перетащите сюда файлы для загрузки'}</p>`;
    $('btn-up').disabled = st.currentPath === '/';
    $('btn-back').disabled = !st.history.length;
    $('view-list').classList.toggle('active', st.view === 'list');
    $('view-grid').classList.toggle('active', st.view === 'grid');
    $('sort-dir').innerHTML = `<i class="bi bi-sort-${st.sort === 'size' ? 'numeric' : 'alpha'}-${st.asc ? 'down' : 'up'}"></i>`;
    $('diskpath').textContent = st.currentPath;
    paintSelection();
}

function paintSelection() {
    $('btn-download').disabled = !st.selected.size;
    document.querySelectorAll('#fm-area .fm-item').forEach(el => el.classList.toggle('selected', st.selected.has(el.dataset.path)));
    $('status').textContent = `Элементов: ${st.items.length}` + (st.selected.size ? `, выбрано: ${st.selected.size}` : '');
}

const itemFromEl = el => { const p = el?.dataset?.path; return p ? st.items.find(i => i.path === p) : null; };

let ghost = null, itemDrag = null, band = null;
const ghostEl = () => $('drag-ghost');

function ghostShow(items, mx, my) {
    const primary = items[0];
    const el = ghostEl();
    el.innerHTML = `<i class="bi ${iconFor(primary)}"></i><span class="text-truncate" style="max-width:180px">${esc(primary.name)}</span>${items.length > 1 ? `<span class="count">+${items.length - 1}</span>` : ''}`;
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('show'));
    ghost = { x: mx - 12, y: my - 12, tx: mx - 12, ty: my - 12, t: Math.random() * 10, raf: 0 };
    const tick = () => {
        if (!ghost) return;
        ghost.x += (ghost.tx - ghost.x) * 0.22; ghost.y += (ghost.ty - ghost.y) * 0.22; ghost.t += 0.16;
        const dx = ghost.tx - ghost.x;
        const lean = Math.max(-14, Math.min(14, dx * 0.7));
        const wob = Math.sin(ghost.t) * 1.2, bob = Math.sin(ghost.t * 0.6) * 2;
        const sc = 1 + Math.sin(ghost.t * 0.15) * 0.03;
        el.style.transform = `translate(${ghost.x}px, ${ghost.y + bob}px) rotate(${lean + wob}deg) scale(${sc})`;
        ghost.raf = requestAnimationFrame(tick);
    };
    tick();
}
function ghostMove(mx, my) { if (ghost) { ghost.tx = mx - 12; ghost.ty = my - 12; } }
function ghostHide() {
    const el = ghostEl();
    el.classList.remove('show');
    setTimeout(() => { if (!el.classList.contains('show')) el.style.display = 'none'; }, 150);
    if (ghost?.raf) cancelAnimationFrame(ghost.raf);
    ghost = null;
}

function hideMenu() { $('fm-menu').style.display = 'none'; }

export function initFs() {
    $('fm-area').addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        hideMenu();
        const el = e.target.closest('.fm-item');
        const path = el?.dataset?.path;
        const multi = e.ctrlKey || e.metaKey;
        if (!multi) {
            if (path && !st.selected.has(path)) st.selected = new Set([path]);
            else if (!path) st.selected.clear();
            paintSelection();
        }
        if (path) itemDrag = { startX: e.clientX, startY: e.clientY, started: false, target: null, path };
        else band = { x: e.clientX, y: e.clientY, base: new Set(multi ? st.selected : []) };
    });

    document.addEventListener('mousemove', e => {
        if (itemDrag) {
            const d = Math.hypot(e.clientX - itemDrag.startX, e.clientY - itemDrag.startY);
            if (!itemDrag.started) {
                if (d < 8) return;
                itemDrag.started = true;
                document.body.classList.add('is-dragging-items');
                if (!st.selected.has(itemDrag.path)) { st.selected.add(itemDrag.path); paintSelection(); }
                const items = [...st.selected].map(p => st.items.find(i => i.path === p)).filter(Boolean);
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
        st.selected = sel;
        paintSelection();
    });

    document.addEventListener('mouseup', async () => {
        $('band').style.display = 'none';
        if (itemDrag) {
            document.body.classList.remove('is-dragging-items');
            ghostHide();
            if (!itemDrag.started) { itemDrag = null; return; }
            const targetEl = itemDrag.target;
            const paths = [...st.selected];
            itemDrag = null;
            if (targetEl) targetEl.classList.remove('drop-target');
            if (!targetEl) return;
            let targetFolder = null;
            if (targetEl.closest('#pathbar')) targetFolder = targetEl.dataset.path;
            else { const tgt = st.items.find(i => i.path === targetEl.dataset.path); if (!tgt || !tgt.is_dir) return; targetFolder = tgt.path; }
            if (paths.some(p => inSubtree(targetFolder, p))) return toast('Нельзя переместить папку внутрь себя');
            try {
                for (const p of paths) { if (parentOf(p) === targetFolder) continue; await postJSON(move, { file_path: p, target_folder: targetFolder }); }
                st.selected.clear(); await loadDir(); toast('Перемещено');
            } catch (err) { toast('Ошибка перемещения: ' + err.message); }
            return;
        }
        band = null;
    });

    $('fm-area').addEventListener('dblclick', e => { const item = itemFromEl(e.target.closest('.fm-item')); if (item) openItem(item); });

    $('fm-area').addEventListener('contextmenu', e => {
        e.preventDefault();
        const item = itemFromEl(e.target.closest('.fm-item'));
        if (item) { if (!st.selected.has(item.path)) st.selected = new Set([item.path]); }
        else st.selected.clear();
        paintSelection();
        const menu = $('fm-menu');
        const mode = item ? 'item' : 'area';
        menu.querySelectorAll('li').forEach(li => li.style.display = li.dataset.for === mode ? '' : 'none');
        const single = st.selected.size === 1;
        menu.querySelectorAll('[data-act="open"],[data-act="rename"]').forEach(a => a.classList.toggle('disabled', !single));
        const uLi = menu.querySelector('[data-act="to-uploader"]')?.closest('li');
        if (uLi) uLi.style.display = (mode === 'item' && single && item?.is_dir) ? '' : 'none';
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

    $('btn-back').onclick = goBack;
    $('btn-up').onclick = goUp;
    $('btn-refresh').onclick = () => loadDir();
    $('view-list').onclick = () => { st.view = 'list'; render(); };
    $('view-grid').onclick = () => { st.view = 'grid'; render(); };
    $('search').oninput = e => { st.query = e.target.value; st.selected.clear(); render(); };
    $('sort').onchange = e => { st.sort = e.target.value; render(); };
    $('sort-dir').onclick = () => { st.asc = !st.asc; render(); };
    $('btn-download').onclick = () => downloadItems([...st.selected].map(p => st.items.find(i => i.path === p)).filter(Boolean));

    $('new-folder-create').onclick = async () => {
        const name = $('new-folder-name').value.trim();
        if (!name) return toast('Введите имя папки');
        try {
            await postJSON(addFolder, { folder_name: name, path: st.currentPath });
            $('new-folder-name').value = '';
            bootstrap.Modal.getInstance($('new-folder'))?.hide();
            await loadDir(); toast('Папка создана');
        } catch (err) { toast('Ошибка: ' + err.message); }
    };
    $('new-folder-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('new-folder-create').click(); });

    document.addEventListener('keydown', e => {
        if (e.target.matches('input, select, textarea')) return;
        if (!filesTabActive()) return;
        if (e.key === 'Escape') {
            if (itemDrag) { document.body.classList.remove('is-dragging-items'); if (itemDrag.target) itemDrag.target.classList.remove('drop-target'); itemDrag = null; ghostHide(); }
            $('band').style.display = 'none'; band = null; st.selected.clear(); paintSelection(); hideMenu();
            return;
        }
        if (e.altKey && e.key === 'ArrowLeft') return goBack();
        if (e.altKey && e.key === 'ArrowUp') return goUp();
        if (e.key === 'Backspace') { e.preventDefault(); goUp(); }
        if (e.key === 'Delete') doAction('delete');
        if (e.key === 'F2' && st.selected.size === 1) doAction('rename');
        if (e.key === 'Enter' && st.selected.size === 1) doAction('open');
        if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doAction('selectall'); }
    });
}

async function doAction(act) {
    const items = [...st.selected].map(p => st.items.find(i => i.path === p)).filter(Boolean);
    if (act === 'refresh') return loadDir();
    if (act === 'toggleview') { st.view = st.view === 'list' ? 'grid' : 'list'; return render(); }
    if (act === 'selectall') { visibleItems().forEach(i => st.selected.add(i.path)); return paintSelection(); }
    if (act === 'upload') return $('file-input').click();
    if (act === 'newfolder') return bootstrap.Modal.getOrCreateInstance($('new-folder')).show();
    if (!items.length) return;
    if (act === 'open') return openItem(items[0]);
    if (act === 'download') return downloadItems(items);
    if (act === 'to-uploader') { const item = items[0]; if (item?.is_dir) openUploaderModal(item); return; }
    if (act === 'rename') {
        const item = items[0];
        const name = (prompt('Новое имя:', item.name) || '').trim();
        if (!name || name === item.name) return;
        try { await postJSON(rename, { path: item.path, new_name: name }); await loadDir(); toast('Переименовано'); }
        catch (err) { toast('Ошибка переименования: ' + err.message); }
        return;
    }
    if (act === 'delete') {
        if (!confirm(`Удалить выбранное (${items.length})?`)) return;
        try { await postJSON(deleteFiles, { paths: items.map(i => i.path) }); await loadDir(); toast('Удалено'); }
        catch (err) { toast('Ошибка удаления: ' + err.message); }
    }
}

export function downloadItems(items) {
    if (!items.length) return toast('Выберите, что скачать');
    const query = items.map(i => 'path=' + encodeURIComponent(i.path)).join('&');
    const url = `${download}?${query}&download=1`;
    if (url.length > 7000) return toast('Слишком много элементов');
    const single = items.length === 1;
    const name = single ? (items[0].is_dir ? items[0].name + '.zip' : items[0].name) : 'files.zip';
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    toast(single && !items[0].is_dir ? 'Скачивание: ' + items[0].name : 'Скачивание архива…');
}
