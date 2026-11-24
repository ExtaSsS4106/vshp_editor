import { esc, alertModal } from '../cammon.js';
import { st, els } from './state.js';
import { apiList } from './api.js';
import { renderTests, applySearch } from './render.js';
import { openEditModal, initEditor } from './editor.js';
import { runTest, deleteTest, addTest } from './actions.js';

async function loadTests() {
    try { renderTests(await apiList()); }
    catch (err) {
        console.error('[tester] load error:', err);
        els.grid.innerHTML = `<div class="alert alert-danger py-2 mb-0 d-flex align-items-center gap-2">
            <i class="bi bi-exclamation-triangle-fill"></i>
            <span>Не удалось загрузить тесты: ${esc(err.message)}</span>
            <button class="btn btn-sm btn-outline-danger ms-auto" id="grid-retry">Повторить</button>
        </div>`;
        document.getElementById('grid-retry')?.addEventListener('click', loadTests);
        els.cnt.textContent = '0';
    }
}

initEditor();

els.search.addEventListener('input', () => {
    clearTimeout(st.searchTimer);
    st.searchTimer = setTimeout(applySearch, 120);
});
els.search.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); els.search.value = ''; applySearch(); els.search.blur(); }
});
els.clear.addEventListener('click', () => { els.search.value = ''; applySearch(); els.search.focus(); });

document.addEventListener('keydown', e => {
    const inField = e.target.matches('input, textarea, select, [contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); els.search.focus(); els.search.select(); return; }
    if (e.key === '/' && !inField) { e.preventDefault(); els.search.focus(); }
});

els.grid.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const id = btn.closest('.card')?.dataset.id; if (!id) return;
    const a = btn.dataset.action;
    if (a === 'edit') openEditModal(id);
    else if (a === 'run') runTest(id, btn);
    else if (a === 'delete') deleteTest(id, btn);
});

document.getElementById('btnReload')?.addEventListener('click', () => {
    const icon = document.getElementById('btnReloadIcon');
    if (icon) { icon.classList.remove('spin'); void icon.offsetWidth; icon.classList.add('spin'); }
    loadTests();
});

document.getElementById('btnAddSubmit')?.addEventListener('click', addTest);

loadTests();
