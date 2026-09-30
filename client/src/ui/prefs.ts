/** Per-device display preferences (text size, reduced motion, mouse sensitivity). Not game progress. */
export type TouchPref = 'auto' | 'on' | 'off';
export interface Prefs { textScale: number; reduceMotion: boolean; sensitivity: number; invertY: boolean; touch: TouchPref; }
const KEY = 'cq_prefs';
const DEFAULTS: Prefs = { textScale: 1, reduceMotion: false, sensitivity: 1, invertY: false, touch: 'auto' };

/** True on phones / tablets (coarse pointer, no hover) unless the player chose otherwise. */
export function wantsTouch(p: Prefs = loadPrefs()): boolean {
  if (p.touch === 'on') return true;
  if (p.touch === 'off') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(hover: hover)').matches;
  return !!coarse || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(pointer: fine)').matches);
}

export function loadPrefs(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function savePrefs(p: Prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable: prefs just won't persist */ }
  applyPrefs(p);
}
export function applyPrefs(p: Prefs = loadPrefs()) {
  document.documentElement.style.setProperty('--scale', String(p.textScale));
  const reduce = p.reduceMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('reduce-motion', !!reduce);
}
