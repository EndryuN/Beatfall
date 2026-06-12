import { Band } from '../band/band';
import { drawBand } from '../band/render';
import { Chart } from '../engine/chart';
import { SongClock } from '../engine/clock';
import { judgeDelta, HIT_WINDOW_MS, Scoreboard } from '../engine/judge';
import { SyncMachine } from '../engine/sync';
import { InputMapper } from '../input';
import { Highway } from '../render/highway';
import { THEMES } from '../render/theme';
import { loadSettings } from '../settings-store';
import { YouTubePane } from '../youtube';
import type { AnalysisLite, Beatmap } from '../types';
import { videoIdOf } from '../types';
import { showResultsOverlay } from './results';

export interface GameResult {
  beatmapId: string; score: number; maxCombo: number; grade: string;
  accuracy: number; counts: Record<string, number>; unranked: boolean;
}

export interface GameHandlers { onReplay: () => void; onExit: () => void; }

export async function runGame(root: HTMLElement, bm: Beatmap,
                              handlers: GameHandlers,
                              analysis: AnalysisLite | null = null): Promise<() => void> {
  const settings = loadSettings();
  root.innerHTML = `
    <div class="game-layout ${settings.highwaySide === 'right' ? 'mirrored' : ''}">
      <div class="highway-col">
        <canvas></canvas>
        <div class="overlay"><div id="ov-text"></div></div>
      </div>
      <div class="side-col">
        <div class="video-box"><div id="yt-mount"></div></div>
        <div class="stage-box"><canvas id="band-canvas"></canvas></div>
      </div>
    </div>`;
  const canvas = root.querySelector('.highway-col canvas') as HTMLCanvasElement;
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  const bandCanvas = root.querySelector('#band-canvas') as HTMLCanvasElement;
  bandCanvas.width = bandCanvas.clientWidth; bandCanvas.height = bandCanvas.clientHeight;
  const bandCtx = bandCanvas.getContext('2d')!;
  const band = new Band(analysis?.roster ?? ['drummer', 'guitarist'], analysis?.energyCurves ?? null);

  const chart = new Chart(bm);
  const clock = new SongClock();
  // No blocking count-in: maps have a 2 s note-free lead-in as the runway.
  const sync = new SyncMachine(0);
  const board = new Scoreboard();
  const mapper = new InputMapper(settings.keyCodes);
  const highway = new Highway(canvas, THEMES[settings.theme]);
  const yt = new YouTubePane();
  const overlay = root.querySelector('.overlay') as HTMLElement;
  const ovText = root.querySelector('#ov-text') as HTMLElement;
  yt.onEmbedBlocked = () => { ovText.textContent = 'This video blocks embedding 😢'; overlay.classList.remove('hidden'); };
  await yt.mount(root.querySelector('#yt-mount') as HTMLElement, videoIdOf(bm.songId));

  const pressed = [false, false, false, false];
  const holding: (ReturnType<Chart['findHittable']> | null)[] = [null, null, null, null];

  function onKey(e: KeyboardEvent, down: boolean): void {
    if (done) return;
    const lane = mapper.laneFor(e.code);
    if (lane === null || e.repeat) return;
    pressed[lane] = down;
    const t = clock.time(performance.now()) + settings.latencyOffsetMs / 1000;
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
      const j = judgeDelta((t - n.t) * 1000);
      if (!j) return;
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
      t = clock.time(now);
    } else {
      clock.reset();
      t = snap.currentTime;
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
                   hits: board.totalJudged - board.counts.miss, misses: board.counts.miss });
    band.update(dt);
    drawBand(bandCtx, band, t);

    overlay.classList.toggle('hidden', sync.state === 'live' || done);
    if (sync.state === 'waiting') ovText.textContent = snap.currentTime < 1 ? '⏳ waiting for ad / video…' : '⏳ ad break…';
    if (sync.state === 'countdown') ovText.textContent = String(Math.ceil(sync.countdownLeftS));
    if (sync.state === 'paused') ovText.textContent = '⏸ paused';

    if (!done && (sync.state === 'ended' || (chart.finished && sync.state === 'live'))) {
      done = true;
      const result: GameResult = {
        beatmapId: bm.beatmapId, score: Math.round(board.score), maxCombo: board.maxCombo,
        grade: board.grade(), accuracy: board.accuracy, counts: { ...board.counts },
        unranked: sync.unranked,
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
                 window.removeEventListener('keyup', ku); yt.destroy(); };
}
