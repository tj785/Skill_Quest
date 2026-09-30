/**
 * Page address helpers. The hosted app uses normal paths (/teacher, /play?class=1).
 * The single-file offline test build can't change the path of a file:// page, so it keeps
 * the same "path" in the hash instead (#/teacher, #/play?class=1).
 */
declare const __CQ_OFFLINE__: boolean | undefined;
export const OFFLINE = typeof __CQ_OFFLINE__ !== 'undefined' && !!__CQ_OFFLINE__;

function split(full: string) { const i = full.indexOf('?'); return i < 0 ? { path: full || '/', search: '' } : { path: full.slice(0, i) || '/', search: full.slice(i) }; }
export function currentPath(): string { return OFFLINE ? split(location.hash.slice(1)).path : location.pathname; }
export function currentSearch(): string { return OFFLINE ? split(location.hash.slice(1)).search : location.search; }
export function setAddress(path: string, replace = false) {
  const url = OFFLINE ? `#${path}` : path;
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
}
