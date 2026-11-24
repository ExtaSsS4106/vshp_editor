import { esc } from '../cammon.js';
import { API } from './conf.js';
const { download } = API;

let previewModalEl = null, previewModal = null;
let currentPptxCleanup = null, pptxToken = 0;

function ensureModal() {
    if (previewModal) return;
    previewModalEl = document.getElementById('preview-modal');
    previewModal = new bootstrap.Modal(previewModalEl);
    previewModalEl.addEventListener('hidden.bs.modal', () => {
        pptxToken++;
        document.getElementById('preview-body').innerHTML = '';
        if (currentPptxCleanup) { try { currentPptxCleanup(); } catch (_) {} currentPptxCleanup = null; }
    });
}

export async function openPreview(item, downloadItems) {
    ensureModal();
    const body = document.getElementById('preview-body');
    const title = document.getElementById('preview-title');
    const fileUrl = `${download}?path=${encodeURIComponent(item.path)}`;
    body.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';
    title.textContent = item.name;
    document.getElementById('preview-download').onclick = () => downloadItems([item]);
    const ext = item.name.split('.').pop().toLowerCase();
    previewModal.show();

    try {
        switch (ext) {
            case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'svg':
                body.innerHTML = `<img src="${fileUrl}" class="img-fluid d-block mx-auto" alt="${esc(item.name)}">`; break;
            case 'mp4': case 'webm':
                body.innerHTML = `<video src="${fileUrl}" controls autoplay class="w-100"></video>`; break;
            case 'mp3': case 'wav': case 'ogg':
                body.innerHTML = `<audio src="${fileUrl}" controls class="w-100 mt-3"></audio>`; break;
            case 'pdf': await renderPdf(fileUrl, body); break;
            case 'docx': await renderDocx(fileUrl, body); break;
            case 'txt': case 'md': case 'json': case 'js': case 'css': case 'html': case 'xml': case 'csv':
                await renderText(fileUrl, body); break;
            case 'pptx': {
                const run = () => renderPptx(fileUrl, body).catch(err => body.innerHTML = `<div class="alert alert-danger">Не удалось: ${esc(err.message)}</div>`);
                if (body.clientWidth > 0) run();
                else previewModalEl.addEventListener('shown.bs.modal', run, { once: true });
                break;
            }
            default:
                body.innerHTML = `<div class="alert alert-info">Предпросмотр для <strong>.${ext}</strong> не поддерживается. <a href="${fileUrl}" class="alert-link" download>Скачать</a></div>`;
        }
    } catch (err) { body.innerHTML = `<div class="alert alert-danger">Не удалось: ${esc(err.message)}</div>`; }
}

async function renderPdf(url, container) {
    const pdf = await pdfjsLib.getDocument(url).promise;
    container.innerHTML = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.className = 'd-block mx-auto mb-3 shadow-sm';
        const ctx = canvas.getContext('2d');
        canvas.height = vp.height; canvas.width = vp.width;
        container.appendChild(canvas);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
    }
}
async function renderDocx(url, container) {
    const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    container.innerHTML = '';
    await docx.renderAsync(new Uint8Array(buf), container);
}
async function renderText(url, container) {
    const r = await fetch(url); if (!r.ok) throw new Error('Не удалось загрузить текст');
    const t = await r.text();
    container.innerHTML = `<pre class="p-3 bg-body-tertiary rounded mb-0" style="max-height:100%;overflow:auto;">${esc(t)}</pre>`;
}

async function getPptxRatio(blob) {
    try {
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const xml = await zip.file('ppt/presentation.xml').async('string');
        const tag = xml.match(/<p:sldSz\b[^>]*>/)[0];
        const cx = +tag.match(/\bcx="(\d+)"/)[1], cy = +tag.match(/\bcy="(\d+)"/)[1];
        if (cx > 0 && cy > 0) return cy / cx;
    } catch (_) {}
    return 9 / 16;
}

async function renderPptx(url, container) {
    if (currentPptxCleanup) { try { currentPptxCleanup(); } catch (_) {} currentPptxCleanup = null; }
    const token = ++pptxToken;
    const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    if (token !== pptxToken) return;
    container.innerHTML = `
        <canvas id="pptx-canvas" class="d-block mx-auto mb-3 shadow-sm"></canvas>
        <div class="d-flex justify-content-center align-items-center gap-2">
            <button id="pptx-prev" class="btn btn-sm btn-outline-secondary">← Назад</button>
            <span id="pptx-status" class="text-secondary small"></span>
            <button id="pptx-next" class="btn btn-sm btn-outline-secondary">Вперёд →</button>
        </div>`;
    const canvas = container.querySelector('#pptx-canvas');
    const prevBtn = container.querySelector('#pptx-prev');
    const nextBtn = container.querySelector('#pptx-next');
    const statusEl = container.querySelector('#pptx-status');
    let ratio = await getPptxRatio(blob);
    if (!isFinite(ratio) || ratio < 0.3 || ratio > 2) ratio = 9 / 16;
    const boxW = container.clientWidth || Math.round(innerWidth * 0.9);
    const availW = Math.max(320, boxW - 32);
    const availH = Math.max(240, innerHeight - 190);
    const cssW = Math.round(Math.min(1280, availW, availH / ratio));
    const cssH = Math.round(cssW * ratio);
    const scale = Math.max(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * scale); canvas.height = Math.round(cssH * scale);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px'; canvas.style.maxWidth = 'none';
    const file = new File([blob], 'presentation.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const viewer = new window.PptxViewJS.PPTXViewer({ canvas });
    await viewer.loadFile(file);
    if (token !== pptxToken) { try { viewer.destroy?.(); } catch (_) {} return; }
    await viewer.render();
    const update = async () => {
        const cur = await viewer.getCurrentSlideIndex();
        const total = await viewer.getSlideCount();
        statusEl.textContent = `Слайд ${cur + 1} из ${total}`;
        prevBtn.disabled = cur <= 0; nextBtn.disabled = cur >= total - 1;
    };
    const go = async fn => { try { await fn(); } finally { update(); } };
    prevBtn.onclick = () => go(() => viewer.previousSlide());
    nextBtn.onclick = () => go(() => viewer.nextSlide());
    const onKey = e => { if (e.key === 'ArrowRight') nextBtn.click(); if (e.key === 'ArrowLeft' && !e.altKey) prevBtn.click(); };
    document.addEventListener('keydown', onKey);
    await update();
    currentPptxCleanup = () => { document.removeEventListener('keydown', onKey); try { viewer.destroy?.(); } catch (_) {} };
}
