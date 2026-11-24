export const $ = id => document.getElementById(id);

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export function toast(msg) {
    const el = $('toast-body');
    if (!el) return console.log(msg);
    el.textContent = msg;
    if (window.bootstrap) bootstrap.Toast.getOrCreateInstance($('toast'), { delay: 2500 }).show();
    else console.log(msg);
}

export function confirmModal(message, { title = 'Подтверждение', okText = 'Да', cancelText = 'Отмена', okClass = 'btn-danger', icon = 'bi-question-circle-fill text-warning' } = {}) {
    return new Promise(resolve => {
        const el = $('confirmModal');
        $('confirmModalTitle').innerHTML = `<i class="bi ${icon}"></i><span>${esc(title)}</span>`;
        $('confirmModalBody').textContent = message;
        const okBtn = $('confirmModalOk'), cancel = $('confirmModalCancel');
        okBtn.textContent = okText; cancel.textContent = cancelText;
        okBtn.className = 'btn ' + okClass;
        const modal = bootstrap.Modal.getOrCreateInstance(el, { backdrop: 'static' });
        let settled = false;
        const finish = v => {
            if (settled) return; settled = true;
            okBtn.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            el.removeEventListener('hidden.bs.modal', onHidden);
            resolve(v);
        };
        const onOk = () => { finish(true); modal.hide(); };
        const onCancel = () => { finish(false); modal.hide(); };
        const onHidden = () => finish(false);
        okBtn.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        el.addEventListener('hidden.bs.modal', onHidden);
        modal.show();
    });
}

export function alertModal(message, { title = 'Ошибка', okText = 'OK', okClass = 'btn-primary', icon = 'bi-exclamation-triangle-fill text-danger' } = {}) {
    return new Promise(resolve => {
        const el = $('alertModal');
        $('alertModalTitle').innerHTML = `<i class="bi ${icon}"></i><span>${esc(title)}</span>`;
        $('alertModalBody').textContent = message;
        const okBtn = $('alertModalOk');
        okBtn.textContent = okText; okBtn.className = 'btn ' + okClass;
        const modal = bootstrap.Modal.getOrCreateInstance(el);
        let settled = false;
        const finish = () => {
            if (settled) return; settled = true;
            okBtn.removeEventListener('click', onOk);
            el.removeEventListener('hidden.bs.modal', onHidden);
            resolve();
        };
        const onOk = () => { finish(); modal.hide(); };
        const onHidden = () => finish();
        okBtn.addEventListener('click', onOk);
        el.addEventListener('hidden.bs.modal', onHidden);
        modal.show();
    });
}

export async function apiFetch(url, opts = {}) {
    const init = { credentials: 'same-origin', ...opts };
    if (init.body && typeof init.body !== 'string' && !(init.body instanceof FormData)) {
        init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
        init.body = JSON.stringify(init.body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

export const postJSON = (url, body) => apiFetch(url, { method: 'POST', body });
export const getJSON = url => apiFetch(url, { method: 'GET' });
