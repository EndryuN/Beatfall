import { loadSettings, saveSettings } from '../settings-store';

export function renderSettings(root: HTMLElement, onBack: () => void): void {
  const s = loadSettings();
  root.innerHTML = `
    <div style="max-width:520px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:16px">
      <h2>Settings</h2>
      <div>Keys (click then press a key): ${[0, 1, 2, 3].map(i =>
        `<button class="chip medium" data-key="${i}">${s.keyCodes[i].replace('Key', '')}</button>`).join(' ')}</div>
      <label>Highway lanes:
        <select id="lanes"><option value="4">4 lanes (D F J K)</option><option value="3">3 lanes — classic Tap Tap (D F J)</option></select></label>
      <label>Highway side:
        <select id="side"><option value="left">left</option><option value="right">right</option></select></label>
      <label>Theme:
        <select id="theme"><option value="stage">Dark Stage</option><option value="neon">Neon Arcade</option></select></label>
      <label>Scroll speed <input id="speed" type="range" min="300" max="1200" step="50" value="${s.scrollSpeed}"></label>
      <label>Input offset (ms) <input id="offset" type="number" value="${s.latencyOffsetMs}" step="5"></label>
      <label>API key <input id="apikey" type="password" value="${s.apiKey ?? ''}" placeholder="needed for remote mlib"></label>
      <p style="color:#888;font-size:13px">Calibration: play an easy song and watch the judgment bias —
        mostly EARLY hits → increase offset; mostly LATE → decrease. (±5 ms steps; proper metronome test is post-hackathon.)</p>
      <button id="back">save & back</button>
    </div>`;
  (root.querySelector('#lanes') as HTMLSelectElement).value = String(s.laneCount);
  (root.querySelector('#side') as HTMLSelectElement).value = s.highwaySide;
  (root.querySelector('#theme') as HTMLSelectElement).value = s.theme;
  root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(b =>
    b.addEventListener('click', () => {
      b.textContent = '…';
      const h = (e: KeyboardEvent) => {
        e.preventDefault();
        s.keyCodes[Number(b.dataset.key)] = e.code;
        b.textContent = e.code.replace('Key', '');
        window.removeEventListener('keydown', h);
      };
      window.addEventListener('keydown', h);
    }));
  root.querySelector('#back')!.addEventListener('click', () => {
    s.laneCount = Number((root.querySelector('#lanes') as HTMLSelectElement).value) === 3 ? 3 : 4;
    s.highwaySide = (root.querySelector('#side') as HTMLSelectElement).value as 'left' | 'right';
    s.theme = (root.querySelector('#theme') as HTMLSelectElement).value as 'stage' | 'neon';
    s.scrollSpeed = Number((root.querySelector('#speed') as HTMLInputElement).value);
    s.latencyOffsetMs = Number((root.querySelector('#offset') as HTMLInputElement).value);
    s.apiKey = (root.querySelector('#apikey') as HTMLInputElement).value.trim() || undefined;
    saveSettings(s);
    onBack();
  });
}
