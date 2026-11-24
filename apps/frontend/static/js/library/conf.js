/* =====================================================================
   БИБЛИОТЕКА — НАСТРОЙКИ И СОСТОЯНИЕ
   ===================================================================== */

const BASE = '/api/library';

export const API = {
    // Файловый менеджер
    list:        `${BASE}/get_current_list_dir`,
    upload:      `${BASE}/save`,
    deleteFiles: `${BASE}/delete_files`,
    rename:      `${BASE}/rename_file`,
    move:        `${BASE}/move_file`,
    addFolder:   `${BASE}/add_folder`,
    download:    `${BASE}/download`,

    // Очередь загрузчика
    getTasks:     `${BASE}/library_get_tasks`,
    setTasks:     `${BASE}/library_set_tasks`,
    deleteTasks:  `${BASE}/library_delete_tasks`,
    reorderTasks: `${BASE}/library_reorder_tasks`,

    // Запуск загрузки
    runUpload:    `${BASE}/upload`,
};

const ORG_LABELS = {
  1: 'ЧУВО «ВШП»', 2: 'ЧУПО «ВШП»', 3: 'ЧОУ «ВШП»',
  4: 'Sàrl «SIIL»', 5: 'ООО «ВШП»', 6: 'АНО ВО "Синергия"',
};
const LOCALE_LABELS = { 1: 'RU', 2: 'EN', 3: 'FR', 4: 'ZH-CN', 5: 'ES', 6: 'DE' };

const state = {
  currentPath: '/',
  items: [],
  history: [],
  selected: new Set(),
  view: 'list',
  query: '',
  sort: 'name',
  asc: true,
};

let libraryRoot = '';
let uploaderQueue = { items: [], total: 0, loading: false, error: null, query: '' };
const uploaderSelection = new Set();

/* ---------- УТИЛИТЫ ---------- */
const filesTabActive = () => $('tab-files').classList.contains('active');
const parentOf = p => p.split('/').slice(0, -1).join('/') || '/';
const inSubtree = (child, parent) => child === parent || child.startsWith(parent.replace(/\/+$/, '') + '/');

function fmtSize(bytes) {
  const u = ['Б','КБ','МБ','ГБ','ТБ'];
  let i = 0, v = bytes || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i ? v.toFixed(v < 10 ? 1 : 0).replace('.', ',') : v) + ' ' + u[i];
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '…';
  if (sec < 60) return Math.ceil(sec) + ' с';
  return Math.floor(sec / 60) + ' мин ' + Math.ceil(sec % 60) + ' с';
}

function iconFor(item) {
  if (item.is_dir) return 'bi-folder-fill fm-folder';
  const ext = item.name.includes('.') ? item.name.split('.').pop().toLowerCase() : '';
  const map = {
    pdf: 'bi-file-earmark-pdf text-danger',
    doc: 'bi-file-earmark-word text-primary', docx: 'bi-file-earmark-word text-primary',
    xls: 'bi-file-earmark-excel text-success', xlsx: 'bi-file-earmark-excel text-success',
    ppt: 'bi-file-earmark-slides text-warning', pptx: 'bi-file-earmark-slides text-warning',
    jpg: 'bi-file-earmark-image text-info', jpeg: 'bi-file-earmark-image text-info',
    png: 'bi-file-earmark-image text-info', gif: 'bi-file-earmark-image text-info',
    zip: 'bi-file-earmark-zip', rar: 'bi-file-earmark-zip',
    txt: 'bi-file-earmark-text', json: 'bi-file-earmark-code', md: 'bi-file-earmark-text',
  };
  return map[ext] || 'bi-file-earmark';
}

function metaOf(item) {
  if (item.is_dir) return '';
  return item.size != null ? fmtSize(item.size) : '';
}