import { Band } from '../band/band';
import { drawBand } from '../band/render';
import { Chart } from '../engine/chart';
import { SongClock } from '../engine/clock';
import { projectTo3 } from '../engine/project';
import { judgeDelta, medianMs, HIT_WINDOW_MS, Scoreboard } from '../engine/judge';
import { SyncMachine } from '../engine/sync';
import { InputMapper } from '../input';
import { Highway } from '../render/highway';
import { drawVisualizer } from '../render/visualizer';
import { THEMES } from '../render/theme';
import { loadSettings } from '../settings-store';
import { keepKeyboardFocus, YouTubePane } from '../youtube';
import type { AnalysisLite, Beatmap } from '../types';
import { videoIdOf } from '../types';
import { showResultsOverlay } from './results';

export interface GameResult {
  beatmapId: string; score: number; maxCombo: number; grade: string;
  accuracy: number; counts: Record<string, number>; unranked: boolean;
  medianDeltaMs: number | null;
}

export interface GameHandlers {
  onReplay: () => void;
  onExit: () => void;
  currentKey: string;                                   // the map being played
  maps: { key: string; mode: 'standard' | 'custom' }[]; // all maps for this song (pause-menu switch)
  onChangeDifficulty: (key: string) => void;            // re-launches the song on another map
}

export async function runGame(root: HTMLElement, bm: Beatmap,
                              handlers: GameHandlers,
                              analysis: AnalysisLite | null = null): Promise<() => void> {
  const settings = loadSettings();
  root.innerHTML = `
    <div class="game-layout ${settings.highwaySide === 'right' ? 'mirrored' : ''}">
      <div class="highway-col">
        <canvas></canvas>
        <button class="pause-btn" id="pause-btn" title="pause (Esc)">⏸</button>
        <button class="pause-btn" id="restart-btn" style="left:56px" title="restart song">↺</button>
        <div class="overlay">
          <div id="ov-text"></div>
          <div id="pause-menu" class="hidden">
            <div class="pm-label">difficulty — switching restarts the song</div>
            <div id="pm-diffs" class="pm-diffs"></div>
            <button id="pm-resume">▶ resume</button>
            <button id="pm-restart" class="ghost">↻ restart song</button>
            <button id="pm-quit" class="ghost">✕ quit to library</button>
          </div>
        </div>
      </div>
      <div class="side-col">
        <div class="video-box"><div id="yt-mount"></div></div>
        <div class="viz-box"><canvas id="viz-canvas"></canvas></div>
        <div class="stage-box"><canvas id="band-canvas"></canvas></div>
      </div>
    </div>`;
  const canvas = root.querySelector('.highway-col canvas') as HTMLCanvasElement;
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  const bandCanvas = root.querySelector('#band-canvas') as HTMLCanvasElement;
  bandCanvas.width = bandCanvas.clientWidth; bandCanvas.height = bandCanvas.clientHeight;
  const bandCtx = bandCanvas.getContext('2d')!;
  const vizCanvas = root.querySelector('#viz-canvas') as HTMLCanvasElement;
  vizCanvas.width = vizCanvas.clientWidth; vizCanvas.height = vizCanvas.clientHeight;
  const vizCtx = vizCanvas.getContext('2d')!;
  const band = new Band(analysis?.roster ?? ['drummer', 'guitarist'], analysis?.energyCurves ?? null);

  const lanes = settings.laneCount;
  const chart = new Chart(lanes === 3 ? { ...bm, notes: projectTo3(bm.notes) } : bm);
  const clock = new SongClock();
  // No blocking count-in: maps have a 2 s note-free lead-in as the runway.
  const sync = new SyncMachine(0);
  const board = new Scoreboard();
  const mapper = new InputMapper(settings.keyCodes.slice(0, lanes));
  const highway = new Highway(canvas, THEMES[settings.theme], lanes);
  const yt = new YouTubePane();
  const overlay = root.querySelector('.overlay') as HTMLElement;
  const ovText = root.querySelector('#ov-text') as HTMLElement;
  yt.onEmbedBlocked = () => { ovText.textContent = 'This video blocks embedding 😢'; overlay.classList.remove('hidden'); };
  await yt.mount(root.querySelector('#yt-mount') as HTMLElement, videoIdOf(bm.songId));
  const unfocus = keepKeyboardFocus();   // clicking the video must not eat DFJK/Esc

  const pauseMenu = root.querySelector('#pause-menu') as HTMLElement;
  function togglePause(): void {
    if (done) return;
    if (sync.state === 'paused') yt.play();
    else if (sync.state === 'live' || sync.state === 'countdown') yt.pause();
  }
  (root.querySelector('#pause-btn') as HTMLElement).addEventListener('click', togglePause);
  (root.querySelector('#restart-btn') as HTMLElement).addEventListener('click', handlers.onReplay);
  root.querySelector('#pm-resume')!.addEventListener('click', () => yt.play());
  root.querySelector('#pm-restart')!.addEventListener('click', handlers.onReplay);
  root.querySelector('#pm-quit')!.addEventListener('click', handlers.onExit);

  const DIFF_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  const diffs = root.querySelector('#pm-diffs') as HTMLElement;
  diffs.innerHTML = handlers.maps.map(m => {
    const cls = m.mode === 'custom' ? 'medium' : m.key;
    const label = m.mode === 'custom' ? `★ ${m.key}` : (DIFF_LABEL[m.key] ?? m.key);
    const current = m.key === handlers.currentKey ? ' style="outline:2px solid #fff"' : '';
    return `<button class="chip ${cls}" data-diff="${m.key}"${current}>${label}</button>`;
  }).join('');
  diffs.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.diff === handlers.currentKey) { yt.play(); return; }   // same map → just resume
      handlers.onChangeDifficulty(b.dataset.diff!);
    }));

  const pressed = [false, false, false, false];
  const holding: (ReturnType<Chart['findHittable']> | null)[] = [null, null, null, null];
  const offS = settings.latencyOffsetMs / 1000;   // one offset, applied to judging AND rendering
  const hitDeltasMs: number[] = [];

  function onKey(e: KeyboardEvent, down: boolean): void {
    if (done) return;
    if (e.code === 'Escape' && down && !e.repeat) {     // Esc toggles pause
      togglePause();
      return;
    }
    const lane = mapper.laneFor(e.code);
    if (lane === null || e.repeat) return;
    pressed[lane] = down;
    const t = clock.time(performance.now()) + offS;
    if (sync.state !== 'live') return;
    if (down) {
      const n = chart.findHittable(lane, t, HIT_WINDOW_MS / 1000);
      if (!n) {                                                     // whiff
        const hadBigCombo = board.combo >= 50;
        board.breakCombo();
        if (hadBigCombo) band.onComboBreak(); else band.onWhiff();
        highway.effects.flash(THEMES[settings.theme].judgeColors.miss, 0.10);
        return;
      }
      const deltaMs = (t - n.t) * 1000;
      const j = judgeDelta(deltaMs);
      if (!j) return;
      hitDeltasMs.push(deltaMs);
      chart.markHit(n);
      board.hit(j);
      if (board.combo > 0 && board.combo % 50 === 0) {
        band.onMilestone();
        highway.effects.confetti(canvas.width, THEMES[settings.theme].noteColors);
        highway.effects.flash('#ffd166', 0.12);
      }
      if (n.type === 'hold') holding[lane] = n;
      highway.effects.burst(highway.laneX(lane), highway.hitY, THEMES[settings.theme].judgeColors[j]);
      highway.effects.popup(highway.laneX(lane), highway.hitY - 60, j, THEMES[settings.theme].judgeColors[j]);
    } else {
      const h = holding[lane];
      if (h?.state === 'holding') {
        const frac = (t - h.t) / (h.dur ?? 1);
        h.state = frac >= 0.95 ? 'hit' : frac >= 0.5 ? 'hit' : 'dropped';
        if (frac < 0.5) {
          const hadBigCombo = board.combo >= 50;
          board.miss();
          if (hadBigCombo) band.onComboBreak(); else band.onMiss();
        }
        holding[lane] = null;
      }
    }
  }
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  let last = performance.now();
  let raf = 0;
  let done = false;
  let wasLive = false;
  function frame(now: number): void {
    const dt = (now - last) / 1000; last = now;
    const snap = yt.snapshot();
    sync.tick(snap, dt);

    // Song time only flows while the video's content is actually advancing
    // (live or counting in). Otherwise it's pinned to the player's frozen time,
    // so notes never move during ads, pauses, or before playback starts.
    let t: number;
    if (sync.state === 'live' || sync.state === 'countdown') {
      clock.reconcile(snap.currentTime, now);
      t = clock.time(now) + offS;
    } else {
      clock.reset();
      t = snap.currentTime + offS;
    }

    if (sync.state === 'live' && !done) {
      if (!wasLive) chart.dropBefore(t - HIT_WINDOW_MS / 1000); // forgive notes lost to the gap
      for (const _missed of chart.sweepMissed(t)) {
        const hadBigCombo = board.combo >= 50;
        board.miss();
        if (hadBigCombo) band.onComboBreak(); else band.onMiss();
        highway.effects.flash(THEMES[settings.theme].judgeColors.miss, 0.16);
        highway.effects.popup(highway.laneX(_missed.lane), highway.hitY - 60, 'miss',
                              THEMES[settings.theme].judgeColors.miss);
      }
      // active holds: points trickle in + embers rise off the hit line
      for (let l = 0; l < 4; l++) {
        const h = holding[l];
        if (h?.state !== 'holding') continue;
        if (t > h.t + (h.dur ?? 0)) { h.state = 'hit'; holding[l] = null; continue; }  // held to the end
        board.holdTick(dt);
        highway.effects.holdSpark(highway.laneX(l), highway.hitY, THEMES[settings.theme].noteColors[l]);
      }
    }
    wasLive = sync.state === 'live';
    highway.draw(chart.visible(t, 2.5), t, settings.scrollSpeed, pressed, dt,
                 { score: board.score, combo: board.combo, accuracy: board.accuracy,
                   hits: board.totalJudged - board.counts.miss, misses: board.counts.miss,
                   timingMs: hitDeltasMs.length >= 8 ? medianMs(hitDeltasMs) : null });
    band.update(dt);
    drawBand(bandCtx, band, t);
    drawVisualizer(vizCtx, analysis?.energyCurves ?? null, t);

    overlay.classList.toggle('hidden', sync.state === 'live' || done);
    pauseMenu.classList.toggle('hidden', sync.state !== 'paused' || done);
    if (sync.state === 'waiting') ovText.textContent = snap.currentTime < 1 ? '⏳ waiting for ad / video…' : '⏳ ad break…';
    if (sync.state === 'countdown') ovText.textContent = String(Math.ceil(sync.countdownLeftS));
    if (sync.state === 'paused') ovText.textContent = '⏸ paused';

    if (!done && (sync.state === 'ended' || (chart.finished && sync.state === 'live'))) {
      done = true;
      const result: GameResult = {
        beatmapId: bm.beatmapId, score: Math.round(board.score), maxCombo: board.maxCombo,
        grade: board.grade(), accuracy: board.accuracy, counts: { ...board.counts },
        unranked: sync.unranked, medianDeltaMs: medianMs(hitDeltasMs),
      };
      const good = result.grade === 'S' || result.grade === 'A' || result.grade === 'B';
      band.finale(good);
      if (good) highway.effects.confetti(canvas.width, THEMES[settings.theme].noteColors);
      // overlay the results on the live scene — band keeps performing behind the glass
      showResultsOverlay(root.querySelector('.game-layout') as HTMLElement, result,
                         handlers.onReplay, handlers.onExit);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', kd);
                 window.removeEventListener('keyup', ku); unfocus(); yt.destroy(); };
}
