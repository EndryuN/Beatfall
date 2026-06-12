export interface Settings {
  keyCodes: string[];                 // lane 0..3
  highwaySide: 'left' | 'right';
  scrollSpeed: number;                // px/s note travel speed
  latencyOffsetMs: number;            // added to input timestamps when judging
  theme: 'stage' | 'neon';
}
const DEFAULTS: Settings = {
  keyCodes: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  highwaySide: 'left', scrollSpeed: 600, latencyOffsetMs: 0, theme: 'stage',
};
const KEY = 'beatfall.settings';

export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings): void { localStorage.setItem(KEY, JSON.stringify(s)); }
