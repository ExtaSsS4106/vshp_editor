import { esc } from '../cammon.js';
import { st, els } from './state.js';

function matchTest(t, n) {
    n = n.toLowerCase();
    if (String(t.id ?? '').toLowerCase().includes(n)) return true;
    if (String(t.title ?? '').toLowerCase().includes(n)) return true;
    if (String(t.url ?? '').toLowerCase().includes(n)) return true;
    return (t.questions || []).some(q => String(q.question || q.text || q.title || '').toLowerCase().includes(n));
}

export function highlight(text) {
    const s = String(text ?? '');
    if (!st.searchQuery) return esc(s);
    const idx = s.toLowerCase().indexOf(st.searchQuery.toLowerCase());
    if (idx < 0) return esc(s);
    return esc(s.slice(0, idx)) + '<mark>' + esc(s.slice(idx, idx + st.searchQuery.length)) + '</mark>' + esc(s.slice(idx + st.searchQuery.length));
}

export function testCardHTML(t) {
    const qs = t.questions || [];
    let previewQs = qs;
    if (st.searchQuery) {
        const n = st.searchQuery.toLowerCase();
        const m = qs.filter(q => String(q.question || q.text || q.title || '').toLowerCase().includes(n));
        if (m.length) previewQs = m;
    }
    const preview = previewQs.slice(0, 3).map(q => `<li>${highlight(q.question || q.text || q.title || '(без текста)')}</li>`).join('');
    const more = previewQs.length > 3 ? `<li class="text-body-tertiary">… ещё ${previewQs.length - 3}</li>` : '';
    const src = t.url || t.link;
    const idBadge = src
        ? `<a class="badge text-bg-primary text-decoration-none" href="${esc(src)}" target="_blank" rel="noopener" title="Открыть источник: ${esc(src)}">ID ${highlight(t.id)} <i class="bi bi-box-arrow-up-right small"></i></a>`
        : `<span class="badge text-bg-primary">ID ${highlight(t.id)}</span>`;
    const title = t.title ? `<span class="mb-0 fw-semibold">${highlight(t.title)}</span>` : '';
    return `<div class="card shadow-sm" data-id="${esc(t.id)}"><div class="card-body">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
            ${idBadge}${title}<span class="badge text-bg-secondary">${qs.length} вопр.</span>
            <div class="ms-auto d-flex gap-1">
                <button type="button" class="btn btn-sm btn-outline-secondary" data-action="run" title="Запустить"><i class="bi bi-play-fill"></i></button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit" title="Редактировать"><i class="bi bi-pencil"></i></button>
                <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" title="Удалить"><i class="bi bi-trash"></i></button>
            </div>
        </div>
        ${qs.length ? `<ol class="small text-body-secondary mb-0 ps-3">${preview}${more}</ol>` : `<div class="small text-body-tertiary">Вопросов нет</div>`}
    </div></div>`;
}

export function renderTests(tests) { st.currentTests = Array.isArray(tests) ? tests : []; renderGrid(); }

export function renderGrid() {
    const total = st.currentTests.length;
    const list = st.searchQuery ? st.currentTests.filter(t => matchTest(t, st.searchQuery)) : st.currentTests;
    if (!total) {
        els.grid.innerHTML = `<div class="alert alert-secondary py-2 mb-0">Тестов пока нет</div>`;
    } else if (!list.length) {
        els.grid.innerHTML = `<div class="alert alert-secondary d-flex align-items-center gap-2 py-2 mb-0">
            <i class="bi bi-search"></i>
            <span>Ничего не найдено по запросу «<strong>${esc(st.searchQuery)}</strong>»</span>
            <button class="btn btn-sm btn-outline-secondary ms-auto" id="grid-clear-search">Сбросить</button>
        </div>`;
        document.getElementById('grid-clear-search')?.addEventListener('click', () => {
            els.search.value = ''; applySearch(); els.search.focus();
        });
    } else {
        els.grid.innerHTML = list.map(testCardHTML).join('');
    }
    els.cnt.textContent = st.searchQuery ? `${list.length} / ${total}` : String(total);
    els.cnt.classList.toggle('text-bg-warning', !!st.searchQuery);
    els.cnt.classList.toggle('text-bg-secondary', !st.searchQuery);
}

export function applySearch() {
    st.searchQuery = els.search.value.trim();
    els.clear.classList.toggle('d-none', !st.searchQuery);
    renderGrid();
}
