import { $ } from '../cammon.js';

export const st = {
    currentPath: '/', items: [], history: [], selected: new Set(),
    view: 'list', query: '', sort: 'name', asc: true,
    libraryRoot: '',
    uploaderQueue: { items: [], total: 0, loading: false, error: null, query: '' },
    uploaderSelection: new Set(),
    uploaderEditingPath: null,
};

export const ORG_LABELS = { 1: 'ЧУВО «ВШП»', 2: 'ЧУПО «ВШП»', 3: 'ЧОУ «ВШП»', 4: 'Sàrl «SIIL»', 5: 'ООО «ВШП»', 6: 'АНО ВО "Синергия"' };
export const LOCALE_LABELS = { 1: 'RU', 2: 'EN', 3: 'FR', 4: 'ZH-CN', 5: 'ES', 6: 'DE' };

export const filesTabActive = () => $('tab-files').classList.contains('active');
export const parentOf = p => p.split('/').slice(0, -1).join('/') || '/';
export const inSubtree = (child, parent) => child === parent || child.startsWith(parent.replace(/\/+$/, '') + '/');

export function fmtSize(b) {
    const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']; let i = 0, v = b || 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i ? v.toFixed(v < 10 ? 1 : 0).replace('.', ',') : v) + ' ' + u[i];
}
export function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '…';
    if (s < 60) return Math.ceil(s) + ' с';
    return Math.floor(s / 60) + ' мин ' + Math.ceil(s % 60) + ' с';
}
export function iconFor(i) {
    if (i.is_dir) return 'bi-folder-fill fm-folder';
    const ext = i.name.includes('.') ? i.name.split('.').pop().toLowerCase() : '';
    const map = { pdf: 'bi-file-earmark-pdf text-danger', doc: 'bi-file-earmark-word text-primary', docx: 'bi-file-earmark-word text-primary', xls: 'bi-file-earmark-excel text-success', xlsx: 'bi-file-earmark-excel text-success', ppt: 'bi-file-earmark-slides text-warning', pptx: 'bi-file-earmark-slides text-warning', jpg: 'bi-file-earmark-image text-info', jpeg: 'bi-file-earmark-image text-info', png: 'bi-file-earmark-image text-info', gif: 'bi-file-earmark-image text-info', zip: 'bi-file-earmark-zip', rar: 'bi-file-earmark-zip', txt: 'bi-file-earmark-text', json: 'bi-file-earmark-code', md: 'bi-file-earmark-text' };
    return map[ext] || 'bi-file-earmark';
}
export const metaOf = i => i.is_dir ? '' : (i.size != null ? fmtSize(i.size) : '');
