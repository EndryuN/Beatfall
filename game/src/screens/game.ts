import { Chart } from '../engine/chart';
import { SongClock } from '../engine/clock';
import { judgeDelta, HIT_WINDOW_MS, Scoreboard } from '../engine/judge';
import { SyncMachine } from '../engine/sync';
import { InputMapper } from '../input';
import { Highway } from '../render/highway';
import { THEMES } from '../render/theme';
import { loadSettings } from '../settings-store';
import { YouTubePane } from '../youtube';
import type { Beatmap } from '../types';
import { videoIdOf } from '../types';

export interface GameResult {
  beatmapId: string; score: number; maxCombo: number; grade: string;
  accuracy: number; counts: Record<string, number>; unranked: boolean;
}

export async function runGame(root: HTMLElement, bm: Beatmap,
                              onDone: (r: GameResult) => void): Promise<() => void> {
  const settings = loadSettings();
  root.innerHTML = `
    <div class="game-layout ${settings.highwaySide === 'right' ? 'mirrored' : ''}">
      <div class="highway-col">
        <canvas></canvas>
        <div class="overlay"><div id="ov-text"></div></div>
      </div>
      <div class="side-col">
        <div class="video-box"><div id="yt-mount"></div></div>
        <div class="stage-box">🥁 🎸 🎤</div>
        <div class="hud"><span id="hud-score">0</span><span id="hud-combo"></span><span id="hud-acc">100%</span></div>
      </div>
    </div>`;
  const canvas = root.querySelector('canvas')!;
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;

  const chart = new Chart(bm);
  const clock = new SongClock();
  const sync = new SyncMachine();
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
    const lane = mapper.laneFor(e.code);
    if (lane === null || e.repeat) return;
    pressed[lane] = down;
    const t = clock.time(performance.now()) + settings.latencyOffsetMs / 1000;
    if (sync.state !== 'live') return;
    if (down) {
      const n = chart.findHittable(lane, t, HIT_WINDOW_MS / 1000);
      if (!n) { board.breakCombo(); return; }                       // whiff
      const j = judgeDelta((t - n.t) * 1000);
      if (!j) return;
      chart.markHit(n);
      board.hit(j);
      if (n.type === 'hold') holding[lane] = n;
      highway.effects.burst(highway.laneX(lane), highway.hitY, THEMES[settings.theme].judgeColors[j]);
      highway.effects.popup(highway.laneX(lane), highway.hitY - 60, j, THEMES[settings.theme].judgeColors[j]);
    } else {
      const h = holding[lane];
      if (h?.state === 'holding') {
        const frac = (t - h.t) / (h.dur ?? 1);
        h.state = frac >= 0.95 ? 'hit' : frac >= 0.5 ? 'hit' : 'dropped';
        if (frac < 0.5) board.miss();
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

    if (sync.state === 'live') {
      if (!wasLive) chart.dropBefore(t - HIT_WINDOW_MS / 1000); // forgive notes lost to the gap
      for (const _missed of chart.sweepMissed(t)) {
        board.miss();
        highway.effects.popup(highway.laneX(_missed.lane), highway.hitY - 60, 'miss',
                              THEMES[settings.theme].judgeColors.miss);
      }
      // auto-complete holds held to the end
      for (let l = 0; l < 4; l++) {
        const h = holding[l];
        if (h?.state === 'holding' && t > h.t + (h.dur ?? 0)) { h.state = 'hit'; holding[l] = null; }
      }
    }
    wasLive = sync.state === 'live';
    highway.draw(chart.visible(t, 2.5), t, settings.scrollSpeed, pressed, dt);

    overlay.classList.toggle('hidden', sync.state === 'live');
    if (sync.state === 'waiting') ovText.textContent = snap.currentTime < 1 ? '⏳ waiting for ad / video…' : '⏳ ad break…';
    if (sync.state === 'countdown') ovText.textContent = String(Math.ceil(sync.countdownLeftS));
    if (sync.state === 'paused') ovText.textContent = '⏸ paused';

    (root.querySelector('#hud-score') as HTMLElement).textContent = String(Math.round(board.score));
    (root.querySelector('#hud-combo') as HTMLElement).textContent = board.combo > 1 ? `×${board.combo}` : '';
    (root.querySelector('#hud-acc') as HTMLElement).textContent = `${(board.accuracy * 100).toFixed(1)}%`;

    if (!done && (sync.state === 'ended' || (chart.finished && sync.state === 'live'))) {
      done = true;
      onDone({ beatmapId: bm.beatmapId, score: Math.round(board.score), maxCombo: board.maxCombo,
               grade: board.grade(), accuracy: board.accuracy, counts: { ...board.counts },
               unranked: sync.unranked });
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', kd);
                 window.removeEventListener('keyup', ku); yt.destroy(); };
}
