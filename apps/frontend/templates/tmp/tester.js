/* =====================================================================
   Тестер — единый скрипт (база + редактор + API)
   ===================================================================== */

/* =====================================================================
   1. БАЗА
   ===================================================================== */

const grid = document.getElementById('grid');
const cnt  = document.getElementById('cnt');

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/* =====================================================================
   1b. ДИАЛОГИ — обёртки над bootstrap.Modal
   ===================================================================== */

/**
 * Модальное подтверждение. Возвращает Promise<boolean>.
 *   true  — пользователь нажал OK
 *   false — отмена / Esc / клик по бэкдропу / закрытие крестиком
 */
function confirmModal(message, {
    title = 'Подтверждение',
    okText = 'Да',
    cancelText = 'Отмена',
    okClass = 'btn-danger',
    icon = 'bi-question-circle-fill text-warning',
} = {}) {
    return new Promise(resolve => {
        const el      = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmModalTitle');
        const bodyEl  = document.getElementById('confirmModalBody');
        const okBtn   = document.getElementById('confirmModalOk');
        const cancel  = document.getElementById('confirmModalCancel');

        titleEl.innerHTML = `<i class="bi ${icon}"></i><span>${esc(title)}</span>`;
        bodyEl.textContent = message;
        okBtn.textContent  = okText;
        cancel.textContent = cancelText;
        okBtn.className    = 'btn ' + okClass;

        const modal = bootstrap.Modal.getOrCreateInstance(el, { backdrop: 'static' });

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            okBtn.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            el.removeEventListener('hidden.bs.modal', onHidden);
            resolve(value);
        };
        const onOk     = () => { finish(true);  modal.hide(); };
        const onCancel = () => { finish(false); modal.hide(); };
        const onHidden = () => finish(false);

        okBtn.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        el.addEventListener('hidden.bs.modal', onHidden);

        modal.show();
    });
}

/**
 * Модальное сообщение (аналог alert). Возвращает Promise<void>.
 */
function alertModal(message, {
    title = 'Ошибка',
    okText = 'OK',
    okClass = 'btn-primary',
    icon = 'bi-exclamation-triangle-fill text-danger',
} = {}) {
    return new Promise(resolve => {
        const el      = document.getElementById('alertModal');
        const titleEl = document.getElementById('alertModalTitle');
        const bodyEl  = document.getElementById('alertModalBody');
        const okBtn   = document.getElementById('alertModalOk');

        titleEl.innerHTML = `<i class="bi ${icon}"></i><span>${esc(title)}</span>`;
        bodyEl.textContent = message;
        okBtn.textContent  = okText;
        okBtn.className    = 'btn ' + okClass;

        const modal = bootstrap.Modal.getOrCreateInstance(el);

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            okBtn.removeEventListener('click', onOk);
            el.removeEventListener('hidden.bs.modal', onHidden);
            resolve();
        };
        const onOk     = () => { finish(); modal.hide(); };
        const onHidden = () => finish();

        okBtn.addEventListener('click', onOk);
        el.addEventListener('hidden.bs.modal', onHidden);

        modal.show();
    });
}

/* =====================================================================
   2. ПОИСК — состояние и утилиты
   ===================================================================== */

const searchInput = document.getElementById('search');
const searchClear = document.getElementById('search-clear');
let searchQuery = '';
let searchTimer = 0;

function matchTest(t, needle) {
    const n = needle.toLowerCase();
    if (String(t.id    ?? '').toLowerCase().includes(n)) return true;
    if (String(t.title ?? '').toLowerCase().includes(n)) return true;
    if (String(t.url   ?? '').toLowerCase().includes(n)) return true;
    const qs = Array.isArray(t.questions) ? t.questions : [];
    for (const q of qs) {
        const text = String(q.question || q.text || q.title || '').toLowerCase();
        if (text.includes(n)) return true;
    }
    return false;
}

function highlight(text) {
    const s = String(text ?? '');
    if (!searchQuery) return esc(s);
    const idx = s.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx < 0) return esc(s);
    return esc(s.slice(0, idx))
        + '<mark>' + esc(s.slice(idx, idx + searchQuery.length)) + '</mark>'
        + esc(s.slice(idx + searchQuery.length));
}

/* =====================================================================
   3. РЕНДЕР КАРТОЧКИ ТЕСТА
   ===================================================================== */

function testCardHTML(t) {
    const qs = Array.isArray(t.questions) ? t.questions : [];

    let previewQs = qs;
    if (searchQuery) {
        const n = searchQuery.toLowerCase();
        const matched = qs.filter(q =>
            String(q.question || q.text || q.title || '').toLowerCase().includes(n)
        );
        if (matched.length) previewQs = matched;
    }

    const preview = previewQs.slice(0, 3).map(q => {
        const text = q.question || q.text || q.title || '(без текста)';
        return `<li>${highlight(text)}</li>`;
    }).join('');

    const hiddenCount = previewQs.length > 3 ? previewQs.length - 3 : 0;
    const more = hiddenCount
        ? `<li class="text-body-tertiary">… ещё ${hiddenCount}</li>`
        : '';

    const sourceUrl = t.url || t.link;
    const idBadge = sourceUrl
        ? `<a class="badge text-bg-primary text-decoration-none"
              href="${esc(sourceUrl)}" target="_blank" rel="noopener"
              title="Открыть источник: ${esc(sourceUrl)}">
               ID ${highlight(t.id)} <i class="bi bi-box-arrow-up-right small"></i>
           </a>`
        : `<span class="badge text-bg-primary">ID ${highlight(t.id)}</span>`;

    const title = t.title
        ? `<span class="mb-0 fw-semibold">${highlight(t.title)}</span>`
        : '';

    return `
    <div class="card shadow-sm" data-id="${esc(t.id)}">
        <div class="card-body">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                ${idBadge}
                ${title}
                <span class="badge text-bg-secondary">${qs.length} вопр.</span>
                <div class="ms-auto d-flex gap-1">
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-action="run"    title="Запустить">
                        <i class="bi bi-play-fill"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit"   title="Редактировать">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-danger"    data-action="delete" title="Удалить">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
            ${qs.length
                ? `<ol class="small text-body-secondary mb-0 ps-3">${preview}${more}</ol>`
                : `<div class="small text-body-tertiary">Вопросов нет</div>`}
        </div>
    </div>`;
}

/* =====================================================================
   4. СОСТОЯНИЕ РЕДАКТОРА
   ===================================================================== */

let currentTests = [];
let editingTest  = null;
let tqDrag       = null;

/* =====================================================================
   5. renderTests / renderGrid
   ===================================================================== */

function renderTests(tests) {
    currentTests = Array.isArray(tests) ? tests : [];
    renderGrid();
}

function renderGrid() {
    const total = currentTests.length;
    const list = searchQuery
        ? currentTests.filter(t => matchTest(t, searchQuery))
        : currentTests;

    if (!total) {
        grid.innerHTML = `<div class="alert alert-secondary py-2 mb-0">Тестов пока нет</div>`;
    } else if (!list.length) {
        grid.innerHTML = `
            <div class="alert alert-secondary d-flex align-items-center gap-2 py-2 mb-0">
                <i class="bi bi-search"></i>
                <span>Ничего не найдено по запросу «<strong>${esc(searchQuery)}</strong>»</span>
                <button class="btn btn-sm btn-outline-secondary ms-auto" id="grid-clear-search">
                    Сбросить
                </button>
            </div>`;
        const reset = document.getElementById('grid-clear-search');
        if (reset) reset.addEventListener('click', () => {
            searchInput.value = '';
            applySearch();
            searchInput.focus();
        });
    } else {
        grid.innerHTML = list.map(testCardHTML).join('');
    }

    cnt.textContent = searchQuery ? `${list.length} / ${total}` : String(total);
    cnt.classList.toggle('text-bg-warning', !!searchQuery);
    cnt.classList.toggle('text-bg-secondary', !searchQuery);
}

function applySearch() {
    searchQuery = searchInput.value.trim();
    searchClear.classList.toggle('d-none', !searchQuery);
    renderGrid();
}

/* =====================================================================
   6. ОБРАБОТЧИКИ ПОИСКА
   ===================================================================== */

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 120);
});

searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        e.preventDefault();
        searchInput.value = '';
        applySearch();
        searchInput.blur();
    }
});

searchClear.addEventListener('click', () => {
    searchInput.value = '';
    applySearch();
    searchInput.focus();
});

document.addEventListener('keydown', e => {
    const inField = e.target.matches('input, textarea, select, [contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
    }
    if (e.key === '/' && !inField) {
        e.preventDefault();
        searchInput.focus();
    }
});

/* =====================================================================
   7. ОТКРЫТИЕ РЕДАКТОРА
   ===================================================================== */

function openEditModal(id) {
    const t = currentTests.find(x => String(x.id) === String(id));
    if (!t) return;

    editingTest = JSON.parse(JSON.stringify(t));
    editingTest.questions = Array.isArray(editingTest.questions) ? editingTest.questions : [];

    document.getElementById('editTitle').textContent = `Тест ${t.id}`;
    document.getElementById('editError').classList.add('d-none');
    document.getElementById('editError').textContent = '';
    document.getElementById('editInfo').textContent = '';

    const tabVisBtn = document.getElementById('tabVis');
    if (tabVisBtn) bootstrap.Tab.getOrCreateInstance(tabVisBtn).show();

    renderVisual();
    syncJsonFromVisual();

    bootstrap.Modal.getOrCreateInstance(document.getElementById('editModal')).show();
}

/* =====================================================================
   8. РЕНДЕР ВИЗУАЛЬНОЙ ЧАСТИ
   ===================================================================== */

function renderVisual() {
    const container = document.getElementById('visual');
    const qs = editingTest?.questions || [];

    const list = qs.length
        ? `<div class="q-list">${qs.map(renderQuestion).join('')}</div>`
        : `<div class="q-list-empty text-center py-5 text-secondary">
             <i class="bi bi-inbox display-4 d-block mb-2 opacity-50"></i>
             <div>Вопросов пока нет — добавьте первый</div>
           </div>`;

    container.innerHTML = list + `
        <div class="text-center mt-3">
            <button type="button" class="btn btn-outline-primary" id="add-question-btn">
                <i class="bi bi-plus-lg me-1"></i>Добавить вопрос
            </button>
        </div>`;
}

function renderQuestion(q, idx) {
    const answers  = Array.isArray(q.answer)   ? q.answer   : [];
    const variants = Array.isArray(q.variants) ? q.variants : [];
    const correctSet = new Set(answers.map(String));

    const vHtml = variants.map((v, vi) => {
        const isCorrect = correctSet.has(String(v));
        return `
        <div class="q-variant${isCorrect ? ' is-correct' : ''}" data-vi="${vi}">
            <input type="checkbox" class="form-check-input q-variant-correct"
                   ${isCorrect ? 'checked' : ''} title="Правильный ответ">
            <input type="text" class="form-control form-control-sm q-variant-text"
                   value="${esc(v)}" placeholder="Вариант ответа">
            <button type="button" class="btn btn-sm btn-outline-danger q-variant-del" title="Удалить вариант">
                <i class="bi bi-x-lg"></i>
            </button>
        </div>`;
    }).join('');

    return `
    <div class="q-item" data-q="${idx}">
        <div class="q-drag-handle" title="Перетащите, чтобы изменить порядок">
            <i class="bi bi-grip-vertical"></i>
        </div>
        <div class="q-body">
            <div class="q-header">
                <span class="badge text-bg-secondary q-num">#${idx + 1}</span>
                <textarea class="form-control form-control-sm q-text" rows="2"
                          placeholder="Текст вопроса…">${esc(q.question || '')}</textarea>
                <button type="button" class="btn btn-sm btn-outline-danger q-del" title="Удалить вопрос">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
            <div class="q-variants">
                ${vHtml}
                <button type="button" class="btn btn-sm btn-outline-secondary q-add-variant">
                    <i class="bi bi-plus-lg me-1"></i>Добавить вариант
                </button>
            </div>
        </div>
    </div>`;
}

/* =====================================================================
   9. СИНХРОНИЗАЦИЯ visual ↔ JSON
   ===================================================================== */

function syncJsonFromVisual() {
    const area = document.getElementById('editJson');
    if (!area || !editingTest) return;
    area.value = JSON.stringify(editingTest, null, 2);
}

function syncVisualFromJson() {
    const area = document.getElementById('editJson');
    if (!area) return false;
    try {
        const parsed = JSON.parse(area.value);
        if (!parsed || typeof parsed !== 'object') throw new Error('ожидается объект');
        if (!Array.isArray(parsed.questions)) throw new Error('поле questions должно быть массивом');
        parsed.questions.forEach((q, i) => {
            if (!q || typeof q !== 'object') throw new Error(`вопрос #${i + 1}: не объект`);
            if (!Array.isArray(q.variants)) throw new Error(`вопрос #${i + 1}: variants должен быть массивом`);
            if (!Array.isArray(q.answer))   q.answer = [];
        });
        editingTest = parsed;
        renderVisual();
        return true;
    } catch (err) {
        showEditError('Неверный JSON: ' + err.message);
        return false;
    }
}

function showEditError(msg) {
    const el = document.getElementById('editError');
    el.textContent = msg;
    el.classList.remove('d-none');
}
function hideEditError() {
    const el = document.getElementById('editError');
    el.classList.add('d-none');
    el.textContent = '';
}

/* =====================================================================
   10. ДЕЛЕГИРОВАНИЕ input / change / click в #visual
   ===================================================================== */

document.getElementById('visual').addEventListener('input', e => {
    if (!editingTest) return;
    const qItem = e.target.closest('.q-item');
    if (!qItem) return;
    const q = editingTest.questions[+qItem.dataset.q];
    if (!q) return;

    if (e.target.matches('.q-text')) {
        q.question = e.target.value;
        syncJsonFromVisual();
    } else if (e.target.matches('.q-variant-text')) {
        const vItem = e.target.closest('.q-variant');
        const vi = +vItem.dataset.vi;
        const oldText = q.variants[vi];
        const newText = e.target.value;
        q.variants[vi] = newText;
        q.answer = (q.answer || []).map(a => String(a) === String(oldText) ? newText : a);
        syncJsonFromVisual();
    }
});

document.getElementById('visual').addEventListener('change', e => {
    if (!editingTest) return;
    if (!e.target.matches('.q-variant-correct')) return;

    const qItem = e.target.closest('.q-item');
    const q = editingTest.questions[+qItem.dataset.q];
    if (!q) return;

    qItem.querySelectorAll('.q-variant').forEach(vEl => {
        vEl.classList.toggle('is-correct', vEl.querySelector('.q-variant-correct').checked);
    });
    q.answer = [...qItem.querySelectorAll('.q-variant')]
        .filter(vEl => vEl.querySelector('.q-variant-correct').checked)
        .map(vEl => vEl.querySelector('.q-variant-text').value);

    syncJsonFromVisual();
});

document.getElementById('visual').addEventListener('click', async e => {
    if (!editingTest) return;

    if (e.target.closest('#add-question-btn')) {
        editingTest.questions.push({ question: '', answer: [], variants: ['', '', ''] });
        renderVisual();
        syncJsonFromVisual();
        return;
    }

    const qItem = e.target.closest('.q-item');
    if (!qItem) return;
    const qi = +qItem.dataset.q;
    const q = editingTest.questions[qi];
    if (!q) return;

    if (e.target.closest('.q-del')) {
        const ok = await confirmModal(
            `Удалить вопрос #${qi + 1}?`,
            {
                title: 'Удалить вопрос',
                okText: 'Удалить',
                okClass: 'btn-danger',
                icon: 'bi-trash-fill text-danger',
            }
        );
        if (!ok) return;
        editingTest.questions.splice(qi, 1);
        renderVisual();
        syncJsonFromVisual();
        return;
    }

    if (e.target.closest('.q-add-variant')) {
        (q.variants = q.variants || []).push('');
        renderVisual();
        syncJsonFromVisual();
        return;
    }

    if (e.target.closest('.q-variant-del')) {
        const vItem = e.target.closest('.q-variant');
        const vi = +vItem.dataset.vi;
        const removed = q.variants[vi];
        q.variants.splice(vi, 1);
        q.answer = (q.answer || []).filter(a => String(a) !== String(removed));
        renderVisual();
        syncJsonFromVisual();
    }
});

/* =====================================================================
   11. СИНХРОНИЗАЦИЯ ВКЛАДОК
   ===================================================================== */

document.getElementById('tabJson')?.addEventListener('shown.bs.tab', () => {
    syncJsonFromVisual();
    hideEditError();
});
document.getElementById('tabVis')?.addEventListener('shown.bs.tab', () => {
    const ok = syncVisualFromJson();
    if (!ok) {
        setTimeout(() => bootstrap.Tab.getOrCreateInstance(document.getElementById('tabJson')).show(), 0);
    }
});

/* =====================================================================
   12. DRAG & DROP ВОПРОСОВ
   ===================================================================== */

document.getElementById('visual').addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, textarea, select, a')) return;

    const handle = e.target.closest('.q-drag-handle');
    if (!handle) return;
    const item = handle.closest('.q-item');
    if (!item) return;

    const rect = item.getBoundingClientRect();
    tqDrag = {
        item,
        qi: +item.dataset.q,
        startX: e.clientX,
        startY: e.clientY,
        grabOffsetY: e.clientY - rect.top,
        initialRect: rect,
        active: false,
    };
});

document.addEventListener('mousemove', e => {
    if (!tqDrag) return;
    if (!tqDrag.active) {
        const dist = Math.hypot(e.clientX - tqDrag.startX, e.clientY - tqDrag.startY);
        if (dist < 5) return;
        startTqDrag();
    }
    if (!tqDrag?.active) return;
    moveTqDrag(e);
});

document.addEventListener('mouseup', () => {
    if (!tqDrag) return;
    if (tqDrag.active) endTqDrag();
    else tqDrag = null;
});

function startTqDrag() {
    const item  = tqDrag.item;
    const rect  = tqDrag.initialRect;
    const listEl = item.closest('.q-list');
    if (!listEl) { tqDrag = null; return; }

    tqDrag.active = true;
    tqDrag.listEl = listEl;

    const ph = document.createElement('div');
    ph.className = 'q-item tq-placeholder';
    ph.style.height = rect.height + 'px';
    listEl.insertBefore(ph, item);
    tqDrag.placeholder = ph;

    item.style.position = 'fixed';
    item.style.left    = rect.left   + 'px';
    item.style.top     = rect.top    + 'px';
    item.style.width   = rect.width  + 'px';
    item.style.height  = rect.height + 'px';
    item.classList.add('tq-dragging');

    document.body.classList.add('is-dragging-items');
}

function moveTqDrag(e) {
    if (!tqDrag?.active) return;

    const item     = tqDrag.item;
    const listEl   = tqDrag.listEl;
    const ph       = tqDrag.placeholder;
    const listRect = listEl.getBoundingClientRect();
    const h        = tqDrag.initialRect.height;

    let top = e.clientY - tqDrag.grabOffsetY;
    const minTop = listRect.top;
    const maxTop = Math.max(minTop, listRect.bottom - h);
    top = Math.max(minTop, Math.min(maxTop, top));
    item.style.top = top + 'px';

    const others = [...listEl.querySelectorAll('.q-item:not(.tq-dragging):not(.tq-placeholder)')];
    let beforeEl = null;
    for (const el of others) {
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { beforeEl = el; break; }
    }

    if (beforeEl) {
        if (ph.nextElementSibling !== beforeEl) listEl.insertBefore(ph, beforeEl);
    } else {
        if (ph.nextElementSibling !== null) listEl.appendChild(ph);
    }
}

function endTqDrag() {
    const item    = tqDrag.item;
    const ph      = tqDrag.placeholder;
    const listEl  = tqDrag.listEl;
    const fromIdx = tqDrag.qi;

    item.style.position = '';
    item.style.left = '';
    item.style.top = '';
    item.style.width = '';
    item.style.height = '';
    item.classList.remove('tq-dragging');
    document.body.classList.remove('is-dragging-items');

    const all = [...listEl.querySelectorAll('.q-item')];
    const withoutDragged = all.filter(el => el !== item);
    const insertAt = withoutDragged.indexOf(ph);

    if (ph.parentNode) ph.parentNode.replaceChild(item, ph);

    tqDrag = null;

    if (insertAt < 0 || insertAt === fromIdx) {
        renderVisual();
        return;
    }

    const [moved] = editingTest.questions.splice(fromIdx, 1);
    editingTest.questions.splice(insertAt, 0, moved);

    renderVisual();
    syncJsonFromVisual();

    requestAnimationFrame(() => {
        const el = document.querySelector(`#visual .q-item[data-q="${insertAt}"]`);
        if (el) {
            el.style.transition = 'box-shadow .3s';
            el.style.boxShadow = '0 0 0 3px rgba(var(--bs-primary-rgb), .35)';
            setTimeout(() => { el.style.boxShadow = ''; }, 400);
        }
    });
}

/* =====================================================================
   13. СОХРАНЕНИЕ ИЗ МОДАЛКИ
   ===================================================================== */

document.getElementById('btnEditSave')?.addEventListener('click', async () => {
    if (!editingTest) return;

    const jsonActive = document.getElementById('tabJson').classList.contains('active');
    let payload;

    if (jsonActive) {
        try {
            payload = JSON.parse(document.getElementById('editJson').value);
        } catch (err) {
            showEditError('Неверный JSON: ' + err.message);
            bootstrap.Tab.getOrCreateInstance(document.getElementById('tabJson')).show();
            return;
        }
    } else {
        payload = editingTest;
    }

    if (!Array.isArray(payload.questions)) {
        showEditError('Поле questions должно быть массивом');
        return;
    }

    for (let i = 0; i < payload.questions.length; i++) {
        const q = payload.questions[i];
        if (!String(q.question || '').trim()) {
            showEditError(`Вопрос #${i + 1}: пустой текст вопроса`);
            return;
        }
        if (!q.variants?.length) {
            showEditError(`Вопрос #${i + 1}: нет вариантов ответа`);
            return;
        }
        if (!q.answer?.length) {
            showEditError(`Вопрос #${i + 1}: не отмечен правильный ответ`);
            return;
        }
    }

    hideEditError();
    const btn  = document.getElementById('btnEditSave');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Сохранение…';

    try {
        const saved = await apiSave(payload);

        document.getElementById('editInfo').textContent =
            `Сохранено в ${new Date().toLocaleTimeString('ru-RU')}`;
        bootstrap.Modal.getInstance(document.getElementById('editModal'))?.hide();

        const idx = currentTests.findIndex(t => String(t.id) === String(payload.id));
        if (idx >= 0) {
            const prev = currentTests[idx] || {};
            currentTests[idx] = {
                ...prev,
                ...payload,
                ...(saved && typeof saved === 'object' && saved.id ? saved : {}),
            };
        }
        renderGrid();
    } catch (err) {
        showEditError('Не удалось сохранить: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
});

/* =====================================================================
   14. КЛИКИ ПО КАРТОЧКАМ — edit / run / delete
   ===================================================================== */

grid.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('.card');
    const id   = card?.dataset.id;
    if (!id) return;

    const action = btn.dataset.action;

    if (action === 'edit') {
        openEditModal(id);
        return;
    }

    if (action === 'run') {
        const old = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        try {
            const res = await apiRun(id);
            const target = document.getElementById('runResult');
            if (target) {
                target.innerHTML = `
                    <div class="alert alert-success py-2 mb-3 d-flex align-items-center gap-2">
                        <i class="bi bi-play-circle-fill"></i>
                        <span>Тест <strong>${esc(id)}</strong> запущен.</span>
                        ${res?.url
                            ? `<a class="alert-link ms-auto" href="${esc(res.url)}" target="_blank" rel="noopener">Открыть</a>`
                            : ''}
                    </div>`;
            }
        } catch (err) {
            await alertModal('Не удалось запустить: ' + err.message, {
                title: 'Ошибка запуска',
            });
        } finally {
            btn.disabled = false;
            btn.innerHTML = old;
        }
        return;
    }

    if (action === 'delete') {
        const ok = await confirmModal(
            `Удалить тест ${id}?`,
            {
                title: 'Удалить тест',
                okText: 'Удалить',
                okClass: 'btn-danger',
                icon: 'bi-trash-fill text-danger',
            }
        );
        if (!ok) return;

        const old = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        try {
            await apiDelete(id);
            currentTests = currentTests.filter(t => String(t.id) !== String(id));
            renderGrid();
        } catch (err) {
            await alertModal('Не удалось удалить: ' + err.message, {
                title: 'Ошибка удаления',
            });
        } finally {
            btn.disabled = false;
            btn.innerHTML = old;
        }
    }
});

/* =====================================================================
   15. КНОПКА «ОБНОВИТЬ»
   ===================================================================== */

document.getElementById('btnReload')?.addEventListener('click', () => {
    const icon = document.getElementById('btnReloadIcon');
    if (icon) {
        icon.classList.remove('spin');
        void icon.offsetWidth;
        icon.classList.add('spin');
    }
    loadTests();
});

/* =====================================================================
   16. API
   ===================================================================== */

const API = {
    base:   '/api/',
    list:   ()   => `${API.base}/tester_get_list_tests`,
    create: ()   => `${API.base}/tester_save_test`,
    update: ()   => `${API.base}/tester_save_test/`,
    remove: ()   => `${API.base}/tester_delete_test/`,
    run:    ()   => `${API.base}/tester/fill`,
};

async function apiFetch(url, opts = {}) {
    const init = { credentials: 'same-origin', ...opts };

    if (init.body && typeof init.body !== 'string') {
        init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
        init.body = JSON.stringify(init.body);
    }

    const res  = await fetch(url, init);
    const text = await res.text();

    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }

    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

async function apiList() {
    const data = await apiFetch(API.list());
    if (Array.isArray(data))               return data;
    if (data && Array.isArray(data.data))  return data.data;
    if (data && Array.isArray(data.tests)) return data.tests;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
}

async function apiSave(payload) {
    if (!payload?.id) throw new Error('Не указан id теста');
    return apiFetch(API.update(), { method: 'POST', body: { id: payload.id, questions: payload.questions } });
}

async function apiCreate(payload) {
    return apiFetch(API.create(), { method: 'POST', body: { id: payload.id, questions: payload.questions } });
}

async function apiDelete(id) {
    if (!id) throw new Error('Не указан id теста');
    return apiFetch(API.remove(), { method: 'DELETE', body: { id: id } });
}

async function apiRun(id) {
    if (!id) throw new Error('Не указан id теста');
    return apiFetch(API.run(), { method: 'POST', body: { id: id } });
}

/* =====================================================================
   17. ЗАГРУЗКА СПИСКА
   ===================================================================== */

async function loadTests() {
    try {
        const list = await apiList();
        renderTests(list);
    } catch (err) {
        console.error('[tester] load error:', err);
        grid.innerHTML = `
            <div class="alert alert-danger py-2 mb-0 d-flex align-items-center gap-2">
                <i class="bi bi-exclamation-triangle-fill"></i>
                <span>Не удалось загрузить тесты: ${esc(err.message)}</span>
                <button class="btn btn-sm btn-outline-danger ms-auto" id="grid-retry">
                    Повторить
                </button>
            </div>`;
        document.getElementById('grid-retry')?.addEventListener('click', loadTests);
        cnt.textContent = '0';
    }
}

/* =====================================================================
   18. ДОБАВЛЕНИЕ ТЕСТА (модалка #addModal)
   ===================================================================== */

document.getElementById('btnAddSubmit')?.addEventListener('click', async () => {
    const idRaw    = (document.getElementById('addId').value   || '').trim();
    const textRaw  = (document.getElementById('addText').value || '').trim();
    const resultEl = document.getElementById('addResult');

    const showError = msg => {
        resultEl.innerHTML = `<div class="alert alert-danger py-2 mb-0">${esc(msg)}</div>`;
    };

    if (!textRaw) return showError('Вставьте JSON с вопросами');

    let parsed;
    try { parsed = JSON.parse(textRaw); }
    catch (err) { return showError('Неверный JSON: ' + err.message); }

    let payload;
    if (Array.isArray(parsed))                     payload = { questions: parsed };
    else if (parsed && typeof parsed === 'object') payload = parsed;
    else return showError('Ожидается массив вопросов или объект { id, questions }');

    if (idRaw) payload.id = idRaw;
    if (!payload.id)                        return showError('Укажите ID теста');
    if (!Array.isArray(payload.questions))  return showError('Поле "questions" должно быть массивом');

    const btn  = document.getElementById('btnAddSubmit');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Добавление…';

    try {
        const created = await apiCreate(payload);
        const test = (created && typeof created === 'object' && created.id) ? created : payload;

        const idx = currentTests.findIndex(t => String(t.id) === String(test.id));
        if (idx >= 0) currentTests[idx] = test;
        else          currentTests.push(test);

        renderGrid();
        bootstrap.Modal.getInstance(document.getElementById('addModal'))?.hide();

        document.getElementById('addId').value   = '';
        document.getElementById('addText').value = '';
        resultEl.innerHTML = '';
    } catch (err) {
        showError('Не удалось добавить: ' + err.message);
    } finally {
        btn.disabled  = false;
        btn.innerHTML = orig;
    }
});

/* =====================================================================
   19. СТАРТ
   ===================================================================== */

loadTests();