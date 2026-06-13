export interface Settings {
  keyCodes: string[];                 // lane 0..3
  laneCount: 3 | 4;                   // 3 = classic Tap Tap projection, 4 = native
  highwaySide: 'left' | 'right';
  scrollSpeed: number;                // px/s note travel speed
  latencyOffsetMs: number;            // added to input timestamps when judging
  theme: 'stage' | 'neon';
  apiKey?: string;                    // X-API-Key for remote mlib writes
}
const DEFAULTS: Settings = {
  keyCodes: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  laneCount: 4,
  highwaySide: 'left', scrollSpeed: 600, latencyOffsetMs: 0, theme: 'stage',
};
const KEY = 'beatfall.settings';

export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings): void { localStorage.setItem(KEY, JSON.stringify(s)); }
