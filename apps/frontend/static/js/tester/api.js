import { apiFetch } from '../cammon.js';
import {API} from './conf.js';
const {list, create, update, remove, run} = API;
export async function apiList() {
    const d = await apiFetch(list);
    if (Array.isArray(d)) return d;
    return d?.data || d?.tests || d?.items || [];
}
export const apiSave   = p  => apiFetch(create,   { method: 'POST',   body: { id: p.id, questions: p.questions } });
export const apiCreate = p  => apiFetch(update,   { method: 'POST',   body: { id: p.id, questions: p.questions } });
export const apiDelete = id => apiFetch(remove, { method: 'DELETE', body: { id } });
export const apiRun    = id => apiFetch(run,        { method: 'POST',   body: { id } });
