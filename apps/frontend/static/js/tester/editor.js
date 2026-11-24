import { $, esc, confirmModal } from '../cammon.js';
import { st } from './state.js';
import { renderGrid } from './render.js';
import { apiSave } from './api.js';

export function openEditModal(id) {
    const t = st.currentTests.find(x => String(x.id) === String(id));
    if (!t) return;
    st.editingTest = JSON.parse(JSON.stringify(t));
    st.editingTest.questions = Array.isArray(st.editingTest.questions) ? st.editingTest.questions : [];
    $('editTitle').textContent = `Тест ${t.id}`;
    $('editError').classList.add('d-none'); $('editError').textContent = '';
    $('editInfo').textContent = '';
    bootstrap.Tab.getOrCreateInstance($('tabVis'))?.show();
    renderVisual(); syncJsonFromVisual();
    bootstrap.Modal.getOrCreateInstance($('editModal')).show();
}

export function renderVisual() {
    const qs = st.editingTest?.questions || [];
    const list = qs.length
        ? `<div class="q-list">${qs.map(renderQuestion).join('')}</div>`
        : `<div class="q-list-empty text-center py-5 text-secondary"><i class="bi bi-inbox display-4 d-block mb-2 opacity-50"></i><div>Вопросов пока нет — добавьте первый</div></div>`;
    $('visual').innerHTML = list + `<div class="text-center mt-3"><button type="button" class="btn btn-outline-primary" id="add-question-btn"><i class="bi bi-plus-lg me-1"></i>Добавить вопрос</button></div>`;
}

function renderQuestion(q, idx) {
    const answers = q.answer || [], variants = q.variants || [];
    const correctSet = new Set(answers.map(String));
    const vHtml = variants.map((v, vi) => {
        const isCorrect = correctSet.has(String(v));
        return `<div class="q-variant${isCorrect ? ' is-correct' : ''}" data-vi="${vi}">
            <input type="checkbox" class="form-check-input q-variant-correct" ${isCorrect ? 'checked' : ''} title="Правильный ответ">
            <input type="text" class="form-control form-control-sm q-variant-text" value="${esc(v)}" placeholder="Вариант ответа">
            <button type="button" class="btn btn-sm btn-outline-danger q-variant-del" title="Удалить вариант"><i class="bi bi-x-lg"></i></button>
        </div>`;
    }).join('');
    return `<div class="q-item" data-q="${idx}">
        <div class="q-drag-handle" title="Перетащите, чтобы изменить порядок"><i class="bi bi-grip-vertical"></i></div>
        <div class="q-body">
            <div class="q-header">
                <span class="badge text-bg-secondary q-num">#${idx + 1}</span>
                <textarea class="form-control form-control-sm q-text" rows="2" placeholder="Текст вопроса…">${esc(q.question || '')}</textarea>
                <button type="button" class="btn btn-sm btn-outline-danger q-del" title="Удалить вопрос"><i class="bi bi-trash"></i></button>
            </div>
            <div class="q-variants">${vHtml}<button type="button" class="btn btn-sm btn-outline-secondary q-add-variant"><i class="bi bi-plus-lg me-1"></i>Добавить вариант</button></div>
        </div>
    </div>`;
}

export function syncJsonFromVisual() {
    const area = $('editJson');
    if (!area || !st.editingTest) return;
    area.value = JSON.stringify(st.editingTest, null, 2);
}

export function syncVisualFromJson() {
    const area = $('editJson');
    if (!area) return false;
    try {
        const p = JSON.parse(area.value);
        if (!p || typeof p !== 'object') throw new Error('ожидается объект');
        if (!Array.isArray(p.questions)) throw new Error('поле questions должно быть массивом');
        p.questions.forEach((q, i) => {
            if (!q || typeof q !== 'object') throw new Error(`вопрос #${i + 1}: не объект`);
            if (!Array.isArray(q.variants)) throw new Error(`вопрос #${i + 1}: variants должен быть массивом`);
            if (!Array.isArray(q.answer)) q.answer = [];
        });
        st.editingTest = p;
        renderVisual();
        return true;
    } catch (err) {
        showEditError('Неверный JSON: ' + err.message);
        return false;
    }
}

export function showEditError(m) { $('editError').textContent = m; $('editError').classList.remove('d-none'); }
export function hideEditError() { $('editError').classList.add('d-none'); $('editError').textContent = ''; }

export function initEditor() {
    $('visual').addEventListener('input', e => {
        if (!st.editingTest) return;
        const qItem = e.target.closest('.q-item'); if (!qItem) return;
        const q = st.editingTest.questions[+qItem.dataset.q]; if (!q) return;
        if (e.target.matches('.q-text')) {
            q.question = e.target.value; syncJsonFromVisual();
        } else if (e.target.matches('.q-variant-text')) {
            const vi = +e.target.closest('.q-variant').dataset.vi;
            const oldText = q.variants[vi], newText = e.target.value;
            q.variants[vi] = newText;
            q.answer = (q.answer || []).map(a => String(a) === String(oldText) ? newText : a);
            syncJsonFromVisual();
        }
    });

    $('visual').addEventListener('change', e => {
        if (!st.editingTest || !e.target.matches('.q-variant-correct')) return;
        const qItem = e.target.closest('.q-item');
        const q = st.editingTest.questions[+qItem.dataset.q]; if (!q) return;
        qItem.querySelectorAll('.q-variant').forEach(vEl => vEl.classList.toggle('is-correct', vEl.querySelector('.q-variant-correct').checked));
        q.answer = [...qItem.querySelectorAll('.q-variant')].filter(v => v.querySelector('.q-variant-correct').checked).map(v => v.querySelector('.q-variant-text').value);
        syncJsonFromVisual();
    });

    $('visual').addEventListener('click', async e => {
        if (!st.editingTest) return;
        if (e.target.closest('#add-question-btn')) {
            st.editingTest.questions.push({ question: '', answer: [], variants: ['', '', ''] });
            renderVisual(); syncJsonFromVisual(); return;
        }
        const qItem = e.target.closest('.q-item'); if (!qItem) return;
        const qi = +qItem.dataset.q, q = st.editingTest.questions[qi]; if (!q) return;

        if (e.target.closest('.q-del')) {
            if (!await confirmModal(`Удалить вопрос #${qi + 1}?`, { title: 'Удалить вопрос', okText: 'Удалить', icon: 'bi-trash-fill text-danger' })) return;
            st.editingTest.questions.splice(qi, 1); renderVisual(); syncJsonFromVisual(); return;
        }
        if (e.target.closest('.q-add-variant')) { (q.variants = q.variants || []).push(''); renderVisual(); syncJsonFromVisual(); return; }
        if (e.target.closest('.q-variant-del')) {
            const vi = +e.target.closest('.q-variant').dataset.vi;
            const removed = q.variants[vi];
            q.variants.splice(vi, 1);
            q.answer = (q.answer || []).filter(a => String(a) !== String(removed));
            renderVisual(); syncJsonFromVisual();
        }
    });

    $('tabJson')?.addEventListener('shown.bs.tab', () => { syncJsonFromVisual(); hideEditError(); });
    $('tabVis')?.addEventListener('shown.bs.tab', () => {
        if (!syncVisualFromJson()) setTimeout(() => bootstrap.Tab.getOrCreateInstance($('tabJson')).show(), 0);
    });

    initDrag();

    $('btnEditSave')?.addEventListener('click', async () => {
        if (!st.editingTest) return;
        let payload;
        if ($('tabJson').classList.contains('active')) {
            try { payload = JSON.parse($('editJson').value); }
            catch (err) { showEditError('Неверный JSON: ' + err.message); return; }
        } else payload = st.editingTest;

        if (!Array.isArray(payload.questions)) return showEditError('Поле questions должно быть массивом');
        for (let i = 0; i < payload.questions.length; i++) {
            const q = payload.questions[i];
            if (!String(q.question || '').trim()) return showEditError(`Вопрос #${i + 1}: пустой текст`);
            if (!q.variants?.length) return showEditError(`Вопрос #${i + 1}: нет вариантов`);
            if (!q.answer?.length) return showEditError(`Вопрос #${i + 1}: нет правильного ответа`);
        }

        hideEditError();
        const btn = $('btnEditSave'), orig = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Сохранение…';
        try {
            const saved = await apiSave(payload);
            $('editInfo').textContent = `Сохранено в ${new Date().toLocaleTimeString('ru-RU')}`;
            bootstrap.Modal.getInstance($('editModal'))?.hide();
            const idx = st.currentTests.findIndex(t => String(t.id) === String(payload.id));
            if (idx >= 0) st.currentTests[idx] = { ...st.currentTests[idx], ...payload, ...(saved?.id ? saved : {}) };
            renderGrid();
        } catch (err) { showEditError('Не удалось сохранить: ' + err.message); }
        finally { btn.disabled = false; btn.innerHTML = orig; }
    });
}

function initDrag() {
    $('visual').addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, textarea, select, a')) return;
        const handle = e.target.closest('.q-drag-handle'); if (!handle) return;
        const item = handle.closest('.q-item'); if (!item) return;
        const rect = item.getBoundingClientRect();
        st.tqDrag = { item, qi: +item.dataset.q, startX: e.clientX, startY: e.clientY, grabOffsetY: e.clientY - rect.top, initialRect: rect, active: false };
    });
    document.addEventListener('mousemove', e => {
        if (!st.tqDrag) return;
        if (!st.tqDrag.active) {
            if (Math.hypot(e.clientX - st.tqDrag.startX, e.clientY - st.tqDrag.startY) < 5) return;
            startDrag();
        }
        if (st.tqDrag?.active) moveDrag(e);
    });
    document.addEventListener('mouseup', () => {
        if (!st.tqDrag) return;
        if (st.tqDrag.active) endDrag();
        else st.tqDrag = null;
    });
}

function startDrag() {
    const { item, initialRect: rect } = st.tqDrag;
    const listEl = item.closest('.q-list');
    if (!listEl) { st.tqDrag = null; return; }
    st.tqDrag.active = true; st.tqDrag.listEl = listEl;
    const ph = document.createElement('div');
    ph.className = 'q-item tq-placeholder';
    ph.style.height = rect.height + 'px';
    listEl.insertBefore(ph, item);
    st.tqDrag.placeholder = ph;
    Object.assign(item.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    item.classList.add('tq-dragging');
    document.body.classList.add('is-dragging-items');
}

function moveDrag(e) {
    const { item, listEl, placeholder: ph, initialRect } = st.tqDrag;
    const listRect = listEl.getBoundingClientRect();
    let top = e.clientY - st.tqDrag.grabOffsetY;
    top = Math.max(listRect.top, Math.min(listRect.bottom - initialRect.height, top));
    item.style.top = top + 'px';
    const others = [...listEl.querySelectorAll('.q-item:not(.tq-dragging):not(.tq-placeholder)')];
    const before = others.find(el => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (before) { if (ph.nextElementSibling !== before) listEl.insertBefore(ph, before); }
    else if (ph.nextElementSibling !== null) listEl.appendChild(ph);
}

function endDrag() {
    const { item, placeholder: ph, listEl, qi: fromIdx } = st.tqDrag;
    Object.assign(item.style, { position: '', left: '', top: '', width: '', height: '' });
    item.classList.remove('tq-dragging');
    document.body.classList.remove('is-dragging-items');
    const withoutDragged = [...listEl.querySelectorAll('.q-item')].filter(el => el !== item);
    const insertAt = withoutDragged.indexOf(ph);
    if (ph.parentNode) ph.parentNode.replaceChild(item, ph);
    st.tqDrag = null;
    if (insertAt < 0 || insertAt === fromIdx) { renderVisual(); return; }
    const [moved] = st.editingTest.questions.splice(fromIdx, 1);
    st.editingTest.questions.splice(insertAt, 0, moved);
    renderVisual(); syncJsonFromVisual();
    requestAnimationFrame(() => {
        const el = document.querySelector(`#visual .q-item[data-q="${insertAt}"]`);
        if (el) {
            el.style.transition = 'box-shadow .3s';
            el.style.boxShadow = '0 0 0 3px rgba(var(--bs-primary-rgb), .35)';
            setTimeout(() => { el.style.boxShadow = ''; }, 400);
        }
    });
}
