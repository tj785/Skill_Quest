export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* plain text (CSV) */ }
  if (!r.ok) throw new ApiError(r.status, data?.error || `Request failed (${r.status})`);
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T = any>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T = any>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url)
};

export interface Me { id: number; username: string; displayName: string; role: 'admin' | 'teacher' | 'student'; classId?: number; }

import { setAddress } from './nav';

export function navigate(path: string) {
  setAddress(path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Fetch a file from the API (CSV export etc.) and save it. Works in the hosted and offline builds. */
export async function downloadApi(url: string, filename: string, type = 'text/csv') {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new ApiError(r.status, 'Download failed.');
  download(filename, await r.text(), type);
}

export function download(filename: string, content: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
