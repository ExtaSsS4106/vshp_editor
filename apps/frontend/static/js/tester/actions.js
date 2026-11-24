import { $, esc, confirmModal, alertModal } from '../cammon.js';
import { st } from './state.js';
import { renderGrid } from './render.js';
import { apiRun, apiDelete, apiCreate } from './api.js';

export async function runTest(id, btn) {
    const old = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
        const res = await apiRun(id);
        const target = $('runResult');
        if (target) {
            target.innerHTML = `<div class="alert alert-success py-2 mb-3 d-flex align-items-center gap-2">
                <i class="bi bi-play-circle-fill"></i>
                <span>Тест <strong>${esc(id)}</strong> запущен.</span>
                ${res?.url ? `<a class="alert-link ms-auto" href="${esc(res.url)}" target="_blank" rel="noopener">Открыть</a>` : ''}
            </div>`;
        }
    } catch (err) { await alertModal('Не удалось запустить: ' + err.message, { title: 'Ошибка запуска' }); }
    finally { btn.disabled = false; btn.innerHTML = old; }
}

export async function deleteTest(id, btn) {
    if (!await confirmModal(`Удалить тест ${id}?`, { title: 'Удалить тест', okText: 'Удалить', icon: 'bi-trash-fill text-danger' })) return;
    const old = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
        await apiDelete(id);
        st.currentTests = st.currentTests.filter(t => String(t.id) !== String(id));
        renderGrid();
    } catch (err) { await alertModal('Не удалось удалить: ' + err.message, { title: 'Ошибка удаления' }); }
    finally { btn.disabled = false; btn.innerHTML = old; }
}

export async function addTest() {
    const idRaw = ($('addId').value || '').trim();
    const textRaw = ($('addText').value || '').trim();
    const resultEl = $('addResult');
    const err = m => resultEl.innerHTML = `<div class="alert alert-danger py-2 mb-0">${esc(m)}</div>`;
    if (!textRaw) return err('Вставьте JSON с вопросами');

    let parsed;
    try { parsed = JSON.parse(textRaw); } catch (e) { return err('Неверный JSON: ' + e.message); }

    let payload;
    if (Array.isArray(parsed)) payload = { questions: parsed };
    else if (parsed && typeof parsed === 'object') payload = parsed;
    else return err('Ожидается массив вопросов или объект { id, questions }');

    if (idRaw) payload.id = idRaw;
    if (!payload.id) return err('Укажите ID теста');
    if (!Array.isArray(payload.questions)) return err('Поле "questions" должно быть массивом');

    const btn = $('btnAddSubmit'), orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Добавление…';
    try {
        const created = await apiCreate(payload);
        const test = (created && created.id) ? created : payload;
        const idx = st.currentTests.findIndex(t => String(t.id) === String(test.id));
        if (idx >= 0) st.currentTests[idx] = test; else st.currentTests.push(test);
        renderGrid();
        bootstrap.Modal.getInstance($('addModal'))?.hide();
        $('addId').value = ''; $('addText').value = ''; resultEl.innerHTML = '';
    } catch (e) { err('Не удалось добавить: ' + e.message); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
}
