import { loadDir, initFs } from './fs.js';
import { initUploadDragDrop, initQueueHandlers, initUploadQueueHandlers, loadUploaderQueue, renderUploaderQueue } from './uploader.js';
import { $ } from '../cammon.js';

initFs();
initUploadDragDrop();
initQueueHandlers();
initUploadQueueHandlers();

document.querySelectorAll('#main-tabs [data-bs-toggle="tab"]').forEach(btn =>
    btn.addEventListener('shown.bs.tab', e => {
        try { localStorage.setItem('fm-tab', e.target.dataset.bsTarget); } catch (_) {}
    })
);
try {
    const last = localStorage.getItem('fm-tab');
    if (last === '#tab-second') bootstrap.Tab.getOrCreateInstance($('tab-second-btn')).show();
} catch (_) {}

loadDir('/');
loadUploaderQueue();
