import { api } from '../api';
import { SongClock } from '../engine/clock';
import { InputMapper } from '../input';
import { Highway } from '../render/highway';
import { THEMES } from '../render/theme';
import { drawVisualizer } from '../render/visualizer';
import { loadSettings } from '../settings-store';
import { keepKeyboardFocus, YouTubePane } from '../youtube';
import type { AnalysisLite, BeatmapNote } from '../types';
import { videoIdOf } from '../types';
import type { RuntimeNote } from '../engine/chart';

const GRID_DIV = 4;            // 16ths
const HOLD_MIN_S = 0.3;        // recorded press longer than this becomes a hold
const VIZ_SPAN_S = 8;
const VIZ_PLAYHEAD = 0.3;

export interface EditorHandlers { onExit: () => void; onTest: (key: string) => void; }

function buildGrid(beatGrid: number[] | undefined, duration: number): number[] {
  if (!beatGrid || beatGrid.length < 2) {
    const out = [];
    for (let t = 0; t < duration; t += 0.125) out.push(t);
    return out;
  }
  const out: number[] = [];
  for (let i = 0; i + 1 < beatGrid.length; i++) {
    const step = (beatGrid[i + 1] - beatGrid[i]) / GRID_DIV;
    for (let k = 0; k < GRID_DIV; k++) out.push(beatGrid[i] + step * k);
  }
  out.push(beatGrid[beatGrid.length - 1]);
  return out;
}

function nearestIdx(grid: number[], t: number): number {
  let lo = 0, hi = grid.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (grid[mid] <= t) lo = mid; else hi = mid; }
  return Math.abs(grid[lo] - t) <= Math.abs(grid[hi] - t) ? lo : hi;
}

export async function runEditor(root: HTMLElement, songId: string, mapName: string,
                                baseNotes: BeatmapNote[], analysis: AnalysisLite | null,
                                handlers: EditorHandlers): Promise<() => void> {
  const settings = loadSettings();
  root.innerHTML = `
    <div class="game-layout">
      <div class="highway-col"><canvas></canvas></div>
      <div class="side-col">
        <div class="video-box"><div id="yt-mount"></div></div>
        <div class="viz-box"><canvas id="viz-canvas"></canvas></div>
        <div class="editor-panel">
          <div class="editor-title">✎ <b>${mapName}</b> <span id="ed-dirty"></span></div>
          <div id="ed-stats" class="editor-stats"></div>
          <div class="editor-buttons">
            <button id="md-preview" class="chip medium">▶ preview</button>
            <button id="md-edit" class="chip medium">✎ edit (E)</button>
            <button id="md-record" class="chip hard">⏺ record (R)</button>
          </div>
          <div class="editor-buttons">
            <button id="ed-save" class="chip easy">💾 save</button>
            <button id="ed-test" class="chip medium">▶ save & test</button>
            <button id="ed-exit" class="chip medium">← library</button>
          </div>
          <div class="editor-help">
            <b>space</b> play/pause · <b>←/→</b> seek beat (<b>shift</b>: bar) · click/drag waveform to scrub<br>
            <b>✎ edit (E)</b>: click a note to delete · drag a note to move · paused D F J K toggles a note
            at the playhead · <b>+/-</b> stretch/shrink last note · <b>ctrl+z</b> undo<br>
            <b>⏺ record (R)</b>: play the song and tap D F J K on the music — long presses become holds<br>
            <b>▶ preview</b>: just watch — notes are safe from stray clicks
          </div>
        </div>
      </div>
    </div>`;

  const canvas = root.querySelector('.highway-col canvas') as HTMLCanvasElement;
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  const vizCanvas = root.querySelector('#viz-canvas') as HTMLCanvasElement;
  vizCanvas.width = vizCanvas.clientWidth; vizCanvas.height = vizCanvas.clientHeight;
  const vizCtx = vizCanvas.getContext('2d')!;
  const highway = new Highway(canvas, THEMES[settings.theme]);
  const mapper = new InputMapper(settings.keyCodes);
  const clock = new SongClock();
  const yt = new YouTubePane();
  await yt.mount(root.querySelector('#yt-mount') as HTMLElement, videoIdOf(songId));
  const unfocus = keepKeyboardFocus();
  // buttons must not hold focus, or Space "clicks" them instead of play/pausing
  root.querySelectorAll<HTMLButtonElement>('.editor-buttons button').forEach(b =>
    b.addEventListener('click', () => b.blur()));

  const duration = analysis?.duration ?? 600;
  const grid = buildGrid(analysis?.beatGrid, duration);
  const beats = analysis?.beatGrid ?? grid.filter((_, i) => i % GRID_DIV === 0);

  let notes: BeatmapNote[] = baseNotes.map(n => ({ ...n }));
  const undoStack: string[] = [];
  let dirty = false;
  type Mode = 'preview' | 'edit' | 'record';
  let mode: Mode = 'edit';
  let lastTouched: BeatmapNote | null = null;
  let savedKey: string | null = null;
  const recDown = new Map<number, number>();        // lane -> press time

  const dirtyEl = root.querySelector('#ed-dirty') as HTMLElement;
  const statsEl = root.querySelector('#ed-stats') as HTMLElement;
  const modeBtns: Record<Mode, HTMLButtonElement> = {
    preview: root.querySelector('#md-preview') as HTMLButtonElement,
    edit: root.querySelector('#md-edit') as HTMLButtonElement,
    record: root.querySelector('#md-record') as HTMLButtonElement,
  };
  function setMode(m: Mode): void {
    mode = m;
    recDown.clear();
    for (const [k, b] of Object.entries(modeBtns)) {
      b.classList.toggle('mode-on', k === m && m !== 'record');
      b.classList.toggle('rec-on', k === m && m === 'record');
    }
    canvas.style.cursor = m === 'preview' ? 'default' : 'crosshair';
  }
  (Object.keys(modeBtns) as Mode[]).forEach(m =>
    modeBtns[m].addEventListener('click', () => setMode(m)));

  function pushUndo(): void {
    undoStack.push(JSON.stringify(notes));
    if (undoStack.length > 200) undoStack.shift();
    dirty = true;
  }
  function snap(t: number): number {
    return Math.round(grid[nearestIdx(grid, Math.max(0, t))] * 1000) / 1000;
  }
  function slotWidth(t: number): number {
    const i = nearestIdx(grid, t);
    return i + 1 < grid.length ? grid[i + 1] - grid[i] : 0.125;
  }
  function removeAt(lane: number, t: number): boolean {
    const tol = slotWidth(t) / 2;
    const before = notes.length;
    notes = notes.filter(n => !(n.lane === lane && Math.abs(n.t - t) < tol));
    return notes.length < before;
  }
  function addNote(lane: number, t: number, dur?: number): void {
    const n: BeatmapNote = dur && dur > 0
      ? { t, lane, type: 'hold', dur: Math.round(dur * 1000) / 1000 }
      : { t, lane, type: 'tap' };
    notes.push(n);
    notes.sort((a, b) => a.t - b.t);
    lastTouched = n;
  }

  function songTimeNow(): number {
    const snapres = yt.snapshot();
    return snapres.state === 'playing' ? clock.time(performance.now()) : snapres.currentTime;
  }
  function seekTo(t: number): void {
    yt.seekTo(Math.max(0, Math.min(duration - 0.1, t)));
    clock.reset();
  }
  function seekBeats(delta: number): void {
    const t = songTimeNow();
    let i = 0;
    while (i + 1 < beats.length && beats[i + 1] <= t + 0.01) i++;
    const target = beats[Math.max(0, Math.min(beats.length - 1, i + delta))];
    seekTo(target);
  }


  async function save(): Promise<string | null> {
    try {
      const bm = await api.saveCustom(songId, mapName, notes);
      savedKey = bm.difficulty;
      dirty = false;
      return savedKey;
    } catch (err) {
      alert(`save failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
  root.querySelector('#ed-save')!.addEventListener('click', save);
  root.querySelector('#ed-test')!.addEventListener('click', async () => {
    const key = await save();
    if (key) handlers.onTest(key);
  });
  root.querySelector('#ed-exit')!.addEventListener('click', () => {
    if (dirty && !confirm('Leave without saving? Unsaved changes will be lost.')) return;
    handlers.onExit();
  });

  // highway notes (edit mode): click = delete, drag = move (lane and time, grid-snapped)
  setMode('edit');
  function cursorPos(ev: PointerEvent): { lane: number; t: number } {
    const rect = canvas.getBoundingClientRect();
    const lane = Math.min(3, Math.max(0, Math.floor(((ev.clientX - rect.left) / rect.width) * 4)));
    const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    return { lane, t: songTimeNow() + (highway.hitY - y) / settings.scrollSpeed };
  }
  function noteAt(ev: PointerEvent): BeatmapNote | null {
    const { lane, t } = cursorPos(ev);
    const tol = Math.max(slotWidth(t) * 0.75, 12 / settings.scrollSpeed);
    let best: BeatmapNote | null = null;
    for (const n of notes) {
      if (n.lane !== lane) continue;
      const within = n.dur ? (t >= n.t - tol && t <= n.t + n.dur + tol) : Math.abs(n.t - t) <= tol;
      if (within && (best === null || Math.abs(n.t - t) < Math.abs(best.t - t))) best = n;
    }
    return best;
  }
  let noteDrag: { note: BeatmapNote; moved: boolean; x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', ev => {
    if (mode !== 'edit') return;                    // move/delete only in edit mode
    const n = noteAt(ev);
    if (!n) return;
    canvas.setPointerCapture(ev.pointerId);
    noteDrag = { note: n, moved: false, x: ev.clientX, y: ev.clientY };
  });
  canvas.addEventListener('pointermove', ev => {
    if (!noteDrag) return;
    if (!noteDrag.moved && Math.hypot(ev.clientX - noteDrag.x, ev.clientY - noteDrag.y) > 6) {
      noteDrag.moved = true;
      pushUndo();                                   // snapshot the pre-drag position
    }
    if (!noteDrag.moved) return;
    const { lane, t } = cursorPos(ev);
    noteDrag.note.lane = lane;
    noteDrag.note.t = snap(t);
  });
  canvas.addEventListener('pointerup', () => {
    if (!noteDrag) return;
    if (!noteDrag.moved) {                          // plain click: delete
      pushUndo();
      notes = notes.filter(n => n !== noteDrag!.note);
      if (lastTouched === noteDrag.note) lastTouched = null;
    } else {
      notes.sort((a, b) => a.t - b.t);
      lastTouched = noteDrag.note;                  // so +/- can stretch it right away
    }
    noteDrag = null;
  });

  // waveform scrubbing: click jumps, drag slides the song under the playhead
  let scrub: { startX: number; startT: number; moved: boolean } | null = null;
  let scrubT: number | null = null;          // instant visual preview while seeks catch up
  let lastSeekMs = 0;
  vizCanvas.style.cursor = 'grab';
  vizCanvas.addEventListener('pointerdown', ev => {
    vizCanvas.setPointerCapture(ev.pointerId);
    scrub = { startX: ev.clientX, startT: songTimeNow(), moved: false };
    vizCanvas.style.cursor = 'grabbing';
  });
  vizCanvas.addEventListener('pointermove', ev => {
    if (!scrub) return;
    const dx = ev.clientX - scrub.startX;
    if (Math.abs(dx) > 4) scrub.moved = true;
    if (!scrub.moved) return;
    const w = vizCanvas.getBoundingClientRect().width;
    const t = Math.max(0, scrub.startT - (dx / w) * VIZ_SPAN_S);   // drag left = pull future in
    scrubT = t;
    const now = performance.now();
    if (now - lastSeekMs > 90) { lastSeekMs = now; seekTo(t); }
  });
  vizCanvas.addEventListener('pointerup', ev => {
    if (!scrub) return;
    const rect = vizCanvas.getBoundingClientRect();
    if (scrub.moved) {
      const dx = ev.clientX - scrub.startX;
      seekTo(Math.max(0, scrub.startT - (dx / rect.width) * VIZ_SPAN_S));
    } else {
      const frac = (ev.clientX - rect.left) / rect.width;
      seekTo(scrub.startT + (frac - VIZ_PLAYHEAD) * VIZ_SPAN_S);
    }
    scrub = null;
    setTimeout(() => { scrubT = null; }, 250);   // hold the preview until the seek lands
    vizCanvas.style.cursor = 'grab';
  });

  function onKeyDown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault();
      const s = yt.snapshot();
      if (s.state === 'playing') yt.pause(); else yt.play();
      return; }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault();
      seekBeats((e.code === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 4 : 1)); return; }
    if (e.code === 'KeyR' && !e.repeat) { setMode(mode === 'record' ? 'edit' : 'record'); return; }
    if (e.code === 'KeyE' && !e.repeat) { setMode(mode === 'edit' ? 'preview' : 'edit'); return; }
    if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
      const prev = undoStack.pop();
      if (prev) { notes = JSON.parse(prev); lastTouched = null; }
      return; }
    if ((e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'Minus' || e.code === 'NumpadSubtract')
        && lastTouched) {
      pushUndo();
      const target = notes.find(n => n === lastTouched) ?? null;
      if (!target) return;
      const step = slotWidth(target.t);
      const grow = e.code === 'Equal' || e.code === 'NumpadAdd';
      const cur = target.dur ?? 0;
      const next = Math.max(0, cur + (grow ? step : -step));
      if (next > 0.01) { target.type = 'hold'; target.dur = Math.round(next * 1000) / 1000; }
      else { target.type = 'tap'; delete target.dur; }
      return; }

    const lane = mapper.laneFor(e.code);
    if (lane === null || e.repeat || mode === 'preview') return;
    const s = yt.snapshot();
    if (mode === 'record' && s.state === 'playing') {
      recDown.set(lane, songTimeNow());                 // note written on release
    } else if (s.state !== 'playing') {
      pushUndo();
      const t = snap(songTimeNow());
      if (!removeAt(lane, t)) addNote(lane, t);         // toggle at playhead
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    const lane = mapper.laneFor(e.code);
    if (lane === null) return;
    const down = recDown.get(lane);
    if (down === undefined) return;
    recDown.delete(lane);
    if (mode !== 'record') return;
    pushUndo();
    const t = snap(down);
    const heldS = songTimeNow() - down;
    removeAt(lane, t);                                  // re-recording overwrites
    addNote(lane, t, heldS >= HOLD_MIN_S ? snap(down + heldS) - t : undefined);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  let raf = 0;
  let last = performance.now();
  function frame(now: number): void {
    const dt = (now - last) / 1000; last = now;
    const s = yt.snapshot();
    if (s.state === 'playing') clock.reconcile(s.currentTime, now);
    const t = scrubT ?? songTimeNow();

    const visible: RuntimeNote[] = notes
      .filter(n => n.t + (n.dur ?? 0) > t - 1.5 && n.t < t + 2.5)
      .map(n => ({ ...n, state: 'pending' as const }));
    highway.draw(visible, t, settings.scrollSpeed, [false, false, false, false], dt,
                 undefined, beats, analysis?.energyCurves ?? null);
    drawVisualizer(vizCtx, analysis?.energyCurves ?? null, t);

    const beatNo = nearestIdx(beats as number[], t);
    statsEl.innerHTML =
      `${notes.length} notes · ${notes.filter(n => n.type === 'hold').length} holds<br>` +
      `t ${t.toFixed(2)}s · bar ${Math.floor(beatNo / 4) + 1} beat ${(beatNo % 4) + 1}` +
      (mode === 'record' ? ' · <span style="color:#ff5e7a">●REC</span>'
        : mode === 'preview' ? ' · <span style="color:#9aa0b0">preview</span>' : '');
    dirtyEl.textContent = dirty ? '● unsaved' : (savedKey ? '✓ saved' : '');
    dirtyEl.style.color = dirty ? '#ffd166' : '#06d6a0';

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    unfocus();
    yt.destroy();
  };
}
