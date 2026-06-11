# Beatfall Track B — TypeScript Game Implementation Plan (Laptop B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser game that plays any analyzed song: YouTube video in its own pane, canvas note highway beside it, precise sync (incl. ad handling), judgments/scoring, library + settings screens. Developed entirely against `contracts/fixtures/` until Track A goes live.

**Architecture:** Vanilla TypeScript + Vite (no UI framework — three screens, hand-rolled DOM). All game logic (clock, judging, chart state, sync state machine) is pure and unit-tested with vitest; the canvas renderer, YouTube IFrame wrapper, and DOM screens are thin shells verified by playing. Layout: highway column + right pane (video / stage placeholder / HUD), mirrorable.

**Tech Stack:** TypeScript 5, Vite 5, vitest, YouTube IFrame Player API, Canvas 2D, localStorage (settings + scores).

**Prereq:** Foundation plan complete (contracts + fixtures pushed).

---

### Task 1: Scaffold Vite + vitest

**Files:**
- Create: `game/` via scaffolder, then `game/vite.config.ts`, `game/src/types.ts`
- Test: `game/src/types.test.ts`

- [ ] **Step 1: Scaffold**

```bash
cd <repo-root>
npm create vite@latest game -- --template vanilla-ts
cd game && npm install && npm install -D vitest
```

Add to `game/package.json` scripts: `"test": "vitest run", "test:watch": "vitest"`.

- [ ] **Step 2: Write `game/vite.config.ts`** — allow importing `contracts/` from outside the Vite root

```ts
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@contracts': fileURLToPath(new URL('../contracts', import.meta.url)) },
  },
  server: { fs: { allow: ['..'] } },
});
```

Also add to `game/tsconfig.json` `compilerOptions`: `"paths": { "@contracts/*": ["../contracts/*"] }, "resolveJsonModule": true`.

- [ ] **Step 3: Write `game/src/types.ts`** (mirrors contracts — keep in sync by hand, announce changes)

```ts
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Stem = 'drums' | 'bass' | 'vocals' | 'other';

export interface BeatmapNote { t: number; lane: number; type: 'tap' | 'hold'; dur?: number; }
export interface Beatmap {
  beatmapId: string; songId: string; generatorVersion: number;
  difficulty: Difficulty; mode: 'standard'; laneCount: 4; notes: BeatmapNote[];
}
export interface LibraryEntry {
  songId: string; title: string; channel: string; duration: number; thumbnail: string;
  bpm?: number; status: 'queued' | 'processing' | 'ready' | 'error';
  error?: string | null; difficulties: Difficulty[]; addedAt: string;
}
export interface JobStatus {
  jobId: string; songId: string;
  stage: 'queued' | 'downloading' | 'separating' | 'analyzing' | 'generating' | 'done' | 'error';
  progress: number; error?: string | null;
}
export interface SearchCandidate { videoId: string; title: string; channel: string; duration: number; thumbnail: string; }
export const videoIdOf = (songId: string): string => songId.replace(/^yt:/, '');
```

- [ ] **Step 4: Smoke test `game/src/types.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '@contracts/fixtures/fixture.beatmap.hard.json';
import type { Beatmap } from './types';
import { videoIdOf } from './types';

describe('contract fixtures', () => {
  it('fixture beatmap matches our types', () => {
    const bm = fixture as Beatmap;
    expect(bm.laneCount).toBe(4);
    expect(bm.notes.length).toBeGreaterThan(10);
    expect(videoIdOf(bm.songId)).toBe('dQw4w9WgXcQ');
  });
});
```

- [ ] **Step 5: Run** `npm test` → PASS. **Commit:** `git add game && git commit -m "feat(game): scaffold + contract types" && git push`

### Task 2: SongClock (drift-corrected time source)

**Files:**
- Create: `game/src/engine/clock.ts`
- Test: `game/src/engine/clock.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { SongClock } from './clock';

describe('SongClock', () => {
  it('tracks time between reconciles', () => {
    const c = new SongClock();
    c.reconcile(10.0, 1000);            // player says 10.0s at perf=1000ms
    expect(c.time(1500)).toBeCloseTo(10.5, 3);
  });
  it('snaps on large error', () => {
    const c = new SongClock();
    c.reconcile(10.0, 1000);
    c.reconcile(12.0, 1500);            // expected 10.5, player says 12.0 → snap
    expect(c.time(1500)).toBeCloseTo(12.0, 3);
  });
  it('smooths small error instead of jumping', () => {
    const c = new SongClock();
    c.reconcile(10.0, 1000);
    c.reconcile(10.55, 1500);           // 50ms error → nudge, not jump
    const t = c.time(1500);
    expect(t).toBeGreaterThan(10.5);
    expect(t).toBeLessThan(10.55);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run src/engine/clock.test.ts`
- [ ] **Step 3: Implement `game/src/engine/clock.ts`**

```ts
export class SongClock {
  private offset = 0;      // songTime(s) - perfNow(s)
  private started = false;
  constructor(private snapThresholdS = 0.08, private smoothing = 0.15) {}

  reconcile(playerTimeS: number, perfNowMs: number): void {
    const nowS = perfNowMs / 1000;
    if (!this.started) { this.offset = playerTimeS - nowS; this.started = true; return; }
    const err = playerTimeS - (nowS + this.offset);
    this.offset += Math.abs(err) > this.snapThresholdS ? err : err * this.smoothing;
  }
  time(perfNowMs: number): number { return perfNowMs / 1000 + this.offset; }
  reset(): void { this.started = false; this.offset = 0; }
}
```

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `git add -A game && git commit -m "feat(game): drift-corrected song clock" && git push`

### Task 3: Judge + scoring (pure)

**Files:**
- Create: `game/src/engine/judge.ts`
- Test: `game/src/engine/judge.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { judgeDelta, Scoreboard } from './judge';

describe('judgeDelta', () => {
  it.each([
    [0, 'perfect'], [44, 'perfect'], [-45, 'perfect'],
    [46, 'great'], [90, 'great'], [-91, 'good'], [135, 'good'],
  ])('delta %ims → %s', (d, expected) => expect(judgeDelta(d)).toBe(expected));
  it('outside window → null (not a hit)', () => expect(judgeDelta(136)).toBeNull());
});

describe('Scoreboard', () => {
  it('combo multiplies score and breaks on miss', () => {
    const s = new Scoreboard();
    for (let i = 0; i < 10; i++) s.hit('perfect');
    expect(s.combo).toBe(10);
    const before = s.score;
    s.miss();
    expect(s.combo).toBe(0);
    s.hit('good');
    expect(s.score).toBeGreaterThan(before);
  });
  it('accuracy and grade', () => {
    const s = new Scoreboard();
    for (let i = 0; i < 95; i++) s.hit('perfect');
    for (let i = 0; i < 5; i++) s.miss();
    expect(s.accuracy).toBeCloseTo(0.95, 2);
    expect(s.grade()).toBe('A');     // S ≥ 0.98 > A ≥ 0.92 > B ≥ 0.85 > C ≥ 0.7 > D
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `game/src/engine/judge.ts`**

```ts
export type Judgment = 'perfect' | 'great' | 'good';
export const WINDOWS_MS: Record<Judgment, number> = { perfect: 45, great: 90, good: 135 };
export const HIT_WINDOW_MS = 135;
const BASE: Record<Judgment, number> = { perfect: 300, great: 200, good: 100 };
const JUDGE_WEIGHT: Record<Judgment, number> = { perfect: 1, great: 0.8, good: 0.5 };

export function judgeDelta(deltaMs: number): Judgment | null {
  const d = Math.abs(deltaMs);
  if (d <= WINDOWS_MS.perfect) return 'perfect';
  if (d <= WINDOWS_MS.great) return 'great';
  if (d <= WINDOWS_MS.good) return 'good';
  return null;
}

export class Scoreboard {
  score = 0; combo = 0; maxCombo = 0;
  counts: Record<Judgment | 'miss', number> = { perfect: 0, great: 0, good: 0, miss: 0 };

  private get multiplier(): number { return Math.min(2, 1 + Math.floor(this.combo / 10) * 0.1); }
  get totalJudged(): number { return this.counts.perfect + this.counts.great + this.counts.good + this.counts.miss; }
  get accuracy(): number {
    if (this.totalJudged === 0) return 1;
    const w = this.counts.perfect * 1 + this.counts.great * 0.8 + this.counts.good * 0.5;
    return w / this.totalJudged;
  }
  hit(j: Judgment): void {
    this.score += Math.round(BASE[j] * this.multiplier * JUDGE_WEIGHT[j] * 10) / 10;
    this.combo += 1; this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.counts[j] += 1;
  }
  miss(): void { this.combo = 0; this.counts.miss += 1; }
  breakCombo(): void { this.combo = 0; }   // whiff: combo breaks, no miss counted
  grade(): 'S' | 'A' | 'B' | 'C' | 'D' {
    const a = this.accuracy;
    return a >= 0.98 ? 'S' : a >= 0.92 ? 'A' : a >= 0.85 ? 'B' : a >= 0.7 ? 'C' : 'D';
  }
}
```

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `git add -A game && git commit -m "feat(game): judge + scoreboard" && git push`

### Task 4: Chart (runtime note state)

**Files:**
- Create: `game/src/engine/chart.ts`
- Test: `game/src/engine/chart.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { Chart } from './chart';
import type { Beatmap } from '../types';

const bm: Beatmap = {
  beatmapId: 'x', songId: 'yt:dQw4w9WgXcQ', generatorVersion: 1,
  difficulty: 'easy', mode: 'standard', laneCount: 4,
  notes: [
    { t: 1.0, lane: 0, type: 'tap' },
    { t: 1.2, lane: 0, type: 'tap' },
    { t: 2.0, lane: 1, type: 'hold', dur: 1.0 },
  ],
};

describe('Chart', () => {
  it('finds nearest pending note in lane within window', () => {
    const c = new Chart(bm);
    const n = c.findHittable(0, 1.15, 0.135);
    expect(n?.t).toBe(1.2);                       // 1.2 is nearer to 1.15 than 1.0
  });
  it('hit notes are consumed', () => {
    const c = new Chart(bm);
    const n = c.findHittable(0, 1.0, 0.135)!;
    c.markHit(n);
    expect(c.findHittable(0, 1.0, 0.135)?.t).toBe(1.2);
  });
  it('sweeps late notes as missed', () => {
    const c = new Chart(bm);
    const missed = c.sweepMissed(1.5);            // both lane-0 taps now > 135ms late
    expect(missed.map(n => n.t)).toEqual([1.0, 1.2]);
    expect(c.sweepMissed(1.5)).toEqual([]);       // idempotent
  });
  it('notes visible in scroll window', () => {
    const c = new Chart(bm);
    const vis = c.visible(0.5, 2.0);              // songTime 0.5, lookahead 2s
    expect(vis.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `game/src/engine/chart.ts`**

```ts
import type { Beatmap, BeatmapNote } from '../types';

export type NoteState = 'pending' | 'hit' | 'missed' | 'holding' | 'dropped';
export interface RuntimeNote extends BeatmapNote { state: NoteState; }

export class Chart {
  readonly notes: RuntimeNote[];
  constructor(bm: Beatmap) {
    this.notes = bm.notes.map(n => ({ ...n, state: 'pending' as NoteState }))
                          .sort((a, b) => a.t - b.t);
  }
  findHittable(lane: number, songTime: number, windowS: number): RuntimeNote | null {
    let best: RuntimeNote | null = null;
    for (const n of this.notes) {
      if (n.lane !== lane || n.state !== 'pending') continue;
      const d = Math.abs(n.t - songTime);
      if (d <= windowS && (best === null || d < Math.abs(best.t - songTime))) best = n;
      if (n.t - songTime > windowS) break;        // sorted: nothing further can match
    }
    return best;
  }
  markHit(n: RuntimeNote): void { n.state = n.type === 'hold' ? 'holding' : 'hit'; }
  sweepMissed(songTime: number, windowS = 0.135): RuntimeNote[] {
    const out: RuntimeNote[] = [];
    for (const n of this.notes) {
      if (n.state === 'pending' && n.t < songTime - windowS) { n.state = 'missed'; out.push(n); }
      if (n.t >= songTime - windowS) break;
    }
    return out;
  }
  visible(songTime: number, lookaheadS: number): RuntimeNote[] {
    return this.notes.filter(n =>
      (n.state === 'pending' || n.state === 'holding') &&
      n.t + (n.dur ?? 0) > songTime - 0.3 && n.t < songTime + lookaheadS);
  }
  get finished(): boolean { return this.notes.every(n => n.state !== 'pending' && n.state !== 'holding'); }
}
```

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `git add -A game && git commit -m "feat(game): runtime chart" && git push`

### Task 5: Sync state machine (ads, buffering, seeks)

**Files:**
- Create: `game/src/engine/sync.ts`
- Test: `game/src/engine/sync.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { SyncMachine } from './sync';

const playing = (t: number) => ({ state: 'playing' as const, currentTime: t });
const buffering = (t: number) => ({ state: 'buffering' as const, currentTime: t });

describe('SyncMachine', () => {
  it('pre-roll ad: playing but time frozen stays waiting, then counts down', () => {
    const m = new SyncMachine();
    for (let i = 0; i < 20; i++) m.tick(playing(0), 0.1);   // ad: time stuck at 0
    expect(m.state).toBe('waiting');
    m.tick(playing(0.05), 0.1);                             // content started
    expect(m.state).toBe('countdown');
    for (let i = 0; i < 31; i++) m.tick(playing(0.05 + i * 0.1), 0.1);
    expect(m.state).toBe('live');
  });
  it('mid-roll ad: stall during live → waiting → countdown → live', () => {
    const m = new SyncMachine(); m.forceLive();
    for (let i = 0; i < 10; i++) m.tick(playing(30 + i * 0.1), 0.1);
    for (let i = 0; i < 8; i++) m.tick(playing(31), 0.1);   // frozen 0.8s > 0.5s threshold
    expect(m.state).toBe('waiting');
  });
  it('buffering behaves like an ad stall', () => {
    const m = new SyncMachine(); m.forceLive();
    for (let i = 0; i < 8; i++) m.tick(buffering(31), 0.1);
    expect(m.state).toBe('waiting');
  });
  it('user seek marks run unranked but stays live', () => {
    const m = new SyncMachine(); m.forceLive();
    m.tick(playing(30), 0.1);
    m.tick(playing(95), 0.1);                               // jump >> 1.5s
    expect(m.state).toBe('live');
    expect(m.unranked).toBe(true);
  });
  it('pause and resume re-counts in', () => {
    const m = new SyncMachine(); m.forceLive();
    m.tick({ state: 'paused', currentTime: 30 }, 0.1);
    expect(m.state).toBe('paused');
    m.tick(playing(30.05), 0.1);
    expect(m.state).toBe('countdown');
  });
  it('ended', () => {
    const m = new SyncMachine(); m.forceLive();
    m.tick({ state: 'ended', currentTime: 213 }, 0.1);
    expect(m.state).toBe('ended');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `game/src/engine/sync.ts`**

```ts
export type PlayerState = 'unstarted' | 'playing' | 'paused' | 'buffering' | 'ended' | 'cued';
export interface PlayerSnapshot { state: PlayerState; currentTime: number; }
export type SyncState = 'waiting' | 'countdown' | 'live' | 'paused' | 'ended';

export class SyncMachine {
  state: SyncState = 'waiting';
  unranked = false;
  countdownLeftS = 0;
  private lastTime = -1;
  private stallS = 0;

  constructor(private countdownS = 3, private stallThresholdS = 0.5, private seekJumpS = 1.5) {}

  forceLive(): void { this.state = 'live'; this.lastTime = -1; }

  private advancing(t: number): boolean {
    const adv = this.lastTime >= 0 && t > this.lastTime + 0.001;
    return adv;
  }

  tick(p: PlayerSnapshot, dtS: number): SyncState {
    const adv = this.advancing(p.currentTime);
    const jumped = this.lastTime >= 0 && Math.abs(p.currentTime - this.lastTime) > this.seekJumpS;

    switch (this.state) {
      case 'waiting':
        if (p.state === 'playing' && adv) { this.state = 'countdown'; this.countdownLeftS = this.countdownS; }
        break;
      case 'countdown':
        if (p.state === 'playing' && adv) {
          this.countdownLeftS -= dtS;
          if (this.countdownLeftS <= 0) this.state = 'live';
        } else if (p.state === 'paused') this.state = 'paused';
        break;
      case 'live':
        if (p.state === 'ended') this.state = 'ended';
        else if (p.state === 'paused') this.state = 'paused';
        else if (jumped && p.state === 'playing') { this.unranked = true; this.stallS = 0; }
        else if ((p.state === 'playing' || p.state === 'buffering') && !adv) {
          this.stallS += dtS;
          if (this.stallS > this.stallThresholdS) { this.state = 'waiting'; this.stallS = 0; }
        } else this.stallS = 0;
        break;
      case 'paused':
        if (p.state === 'playing' && adv) { this.state = 'countdown'; this.countdownLeftS = this.countdownS; }
        break;
      case 'ended':
        break;
    }
    this.lastTime = p.currentTime;
    return this.state;
  }
}
```

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** `git add -A game && git commit -m "feat(game): ad/stall/seek sync state machine" && git push`

### Task 6: Settings store + input bindings

**Files:**
- Create: `game/src/settings-store.ts`, `game/src/input.ts`
- Test: `game/src/input.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { InputMapper } from './input';

describe('InputMapper', () => {
  it('maps default DFJK codes to lanes', () => {
    const m = new InputMapper(['KeyD', 'KeyF', 'KeyJ', 'KeyK']);
    expect(m.laneFor('KeyD')).toBe(0);
    expect(m.laneFor('KeyK')).toBe(3);
    expect(m.laneFor('KeyQ')).toBeNull();
  });
  it('rebinds', () => {
    const m = new InputMapper(['KeyD', 'KeyF', 'KeyJ', 'KeyK']);
    m.rebind(0, 'KeyA');
    expect(m.laneFor('KeyA')).toBe(0);
    expect(m.laneFor('KeyD')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `game/src/input.ts`**

```ts
export class InputMapper {
  constructor(public codes: string[]) {}
  laneFor(code: string): number | null {
    const i = this.codes.indexOf(code);
    return i === -1 ? null : i;
  }
  rebind(lane: number, code: string): void {
    const old = this.codes.indexOf(code);
    if (old !== -1) this.codes[old] = this.codes[lane];   // swap to keep 4 unique codes
    this.codes[lane] = code;
  }
}
```

- [ ] **Step 4: Implement `game/src/settings-store.ts`**

```ts
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
```

- [ ] **Step 5: Run tests (`npm test`) → PASS. Commit** `git add -A game && git commit -m "feat(game): input mapping + settings store" && git push`

### Task 7: YouTube IFrame wrapper

**Files:**
- Create: `game/src/youtube.ts`

Thin wrapper around an external API — verified manually in Task 9 (no unit tests; the SyncMachine consuming it is already tested with fakes).

- [ ] **Step 1: Implement `game/src/youtube.ts`**

```ts
import type { PlayerSnapshot, PlayerState } from './engine/sync';

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady?: () => void; }
}

let apiReady: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (apiReady) return apiReady;
  apiReady = new Promise<void>(resolve => {
    if (window.YT?.Player) return resolve();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return apiReady;
}

const STATE_MAP: Record<number, PlayerState> = {
  [-1]: 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued',
};

export class YouTubePane {
  private player: any = null;
  /** error 101/150 = embedding disabled by uploader */
  onEmbedBlocked: (() => void) | null = null;

  async mount(el: HTMLElement, videoId: string): Promise<void> {
    await loadApi();
    await new Promise<void>(resolve => {
      this.player = new window.YT.Player(el, {
        videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => resolve(),
          onError: (e: any) => {
            if (e.data === 101 || e.data === 150) this.onEmbedBlocked?.();
          },
        },
      });
    });
  }
  snapshot(): PlayerSnapshot {
    if (!this.player?.getPlayerState) return { state: 'unstarted', currentTime: 0 };
    return {
      state: STATE_MAP[this.player.getPlayerState()] ?? 'unstarted',
      currentTime: this.player.getCurrentTime?.() ?? 0,
    };
  }
  play(): void { this.player?.playVideo?.(); }
  pause(): void { this.player?.pauseVideo?.(); }
  destroy(): void { this.player?.destroy?.(); this.player = null; }
}
```

- [ ] **Step 2: Commit** `git add -A game && git commit -m "feat(game): YouTube IFrame wrapper" && git push`

### Task 8: Highway renderer + effects

**Files:**
- Create: `game/src/render/theme.ts`, `game/src/render/highway.ts`, `game/src/render/effects.ts`

- [ ] **Step 1: Implement `game/src/render/theme.ts`**

```ts
export interface Theme {
  bg: string; laneFill: string; laneBorder: string; hitLine: string;
  noteColors: string[];               // per lane
  holdAlpha: number;
  judgeColors: Record<string, string>;
}
export const THEMES: Record<'stage' | 'neon', Theme> = {
  stage: {
    bg: '#12141f', laneFill: 'rgba(255,255,255,0.06)', laneBorder: 'rgba(255,255,255,0.15)',
    hitLine: '#ffffff', noteColors: ['#ff5e7a', '#ffd166', '#06d6a0', '#4cc9f0'],
    holdAlpha: 0.45,
    judgeColors: { perfect: '#ffd166', great: '#06d6a0', good: '#9aa0b0', miss: '#ff5e7a' },
  },
  neon: {
    bg: '#0d0221', laneFill: 'rgba(255,0,229,0.07)', laneBorder: 'rgba(0,229,255,0.35)',
    hitLine: '#ffffff', noteColors: ['#ff2ee6', '#00e5ff', '#b14cff', '#00ffb3'],
    holdAlpha: 0.5,
    judgeColors: { perfect: '#00ffb3', great: '#00e5ff', good: '#b14cff', miss: '#ff2ee6' },
  },
};
```

- [ ] **Step 2: Implement `game/src/render/effects.ts`** (particles + judgment popups)

```ts
import type { Theme } from './theme';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; }
interface Popup { x: number; y: number; text: string; color: string; life: number; }

export class Effects {
  private particles: Particle[] = [];
  private popups: Popup[] = [];

  burst(x: number, y: number, color: string, n = 14): void {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const sp = 120 + Math.random() * 160;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.5, color });
    }
  }
  popup(x: number, y: number, text: string, color: string): void {
    this.popups.push({ x, y, text, color, life: 0.6 });
  }
  update(dt: number): void {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; p.life -= dt; }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.popups) { p.y -= 40 * dt; p.life -= dt; }
    this.popups = this.popups.filter(p => p.life > 0);
  }
  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / 0.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px system-ui';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.max(0, p.life / 0.6);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text.toUpperCase(), p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}
```

- [ ] **Step 3: Implement `game/src/render/highway.ts`**

```ts
import type { RuntimeNote } from '../engine/chart';
import type { Theme } from './theme';
import { Effects } from './effects';

export class Highway {
  readonly effects = new Effects();
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement, private theme: Theme,
              private laneCount = 4, private hitLineFrac = 0.85) {
    this.ctx = canvas.getContext('2d')!;
  }
  laneX(lane: number): number {
    const w = this.canvas.width / this.laneCount;
    return w * lane + w / 2;
  }
  get hitY(): number { return this.canvas.height * this.hitLineFrac; }

  /** y position for a note at time t when song is at songTime */
  noteY(t: number, songTime: number, scrollSpeed: number): number {
    return this.hitY - (t - songTime) * scrollSpeed;
  }

  draw(notes: RuntimeNote[], songTime: number, scrollSpeed: number, pressed: boolean[], dt: number): void {
    const { ctx, canvas, theme } = this;
    const laneW = canvas.width / this.laneCount;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < this.laneCount; i++) {
      ctx.fillStyle = pressed[i] ? 'rgba(255,255,255,0.14)' : theme.laneFill;
      ctx.fillRect(i * laneW + 2, 0, laneW - 4, canvas.height);
      ctx.strokeStyle = theme.laneBorder;
      ctx.strokeRect(i * laneW + 2, 0, laneW - 4, canvas.height);
    }
    // hit line
    ctx.fillStyle = theme.hitLine;
    ctx.shadowColor = theme.hitLine; ctx.shadowBlur = 12;
    ctx.fillRect(8, this.hitY - 2, canvas.width - 16, 4);
    ctx.shadowBlur = 0;
    // notes
    const r = Math.min(26, laneW * 0.32);
    for (const n of notes) {
      const x = this.laneX(n.lane);
      const y = this.noteY(n.t, songTime, scrollSpeed);
      const color = theme.noteColors[n.lane];
      if (n.type === 'hold' && n.dur) {
        const yEnd = this.noteY(n.t + n.dur, songTime, scrollSpeed);
        ctx.globalAlpha = theme.holdAlpha;
        ctx.fillStyle = color;
        ctx.fillRect(x - r * 0.5, yEnd, r, y - yEnd);
        ctx.globalAlpha = 1;
      }
      const headY = n.state === 'holding' ? this.hitY : y;   // active hold head sticks to the hit line
      ctx.fillStyle = n.state === 'holding' ? '#ffffff' : color;
      ctx.beginPath(); ctx.arc(x, headY, r, 0, Math.PI * 2); ctx.fill();
    }
    this.effects.update(dt);
    this.effects.draw(ctx);
  }
}
```

- [ ] **Step 4: Visual smoke check happens in Task 9. Commit** `git add -A game && git commit -m "feat(game): canvas highway + effects" && git push`

### Task 9: Game screen — wire everything, play the fixture

**Files:**
- Create: `game/src/screens/game.ts`
- Modify: `game/src/main.ts`, `game/index.html`, `game/src/style.css`

- [ ] **Step 1: Replace `game/index.html` body and `game/src/style.css`**

`index.html` body:
```html
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

`src/style.css` (replace contents):
```css
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body { background: #0c0e16; color: #e8eaf2; font-family: system-ui, sans-serif; }
#app { height: 100vh; display: flex; flex-direction: column; }
.game-layout { flex: 1; display: flex; min-height: 0; }
.game-layout.mirrored { flex-direction: row-reverse; }
.highway-col { width: 46%; position: relative; }
.highway-col canvas { width: 100%; height: 100%; display: block; }
.side-col { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.video-box { aspect-ratio: 16/9; background: #000; border-radius: 8px; overflow: hidden; }
.video-box iframe { width: 100%; height: 100%; }
.stage-box { flex: 1; background: linear-gradient(180deg, #2a2236, #241c2e); border-radius: 8px;
             display: flex; align-items: flex-end; justify-content: space-around;
             font-size: 42px; padding: 10px; }
.hud { display: flex; justify-content: space-between; font-size: 18px; padding: 4px 8px; }
.overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
           flex-direction: column; gap: 8px; background: rgba(0,0,0,0.55); font-size: 28px;
           text-align: center; }
.overlay.hidden { display: none; }
button { background: #06d6a0; color: #08251c; border: 0; border-radius: 8px;
         padding: 8px 16px; font-weight: 700; cursor: pointer; }
.row { display: flex; align-items: center; gap: 10px; background: #1b1e2c;
       border-radius: 8px; padding: 8px 12px; margin: 6px 0; }
.row img { width: 64px; border-radius: 4px; }
.row .grow { flex: 1; }
.chip { border-radius: 6px; padding: 2px 8px; font-size: 12px; cursor: pointer; border: 0; }
.chip.easy { background: #06d6a033; color: #06d6a0; }
.chip.medium { background: #ffd16633; color: #ffd166; }
.chip.hard { background: #ff5e7a33; color: #ff5e7a; }
.topbar { display: flex; gap: 8px; padding: 12px; }
.topbar input { flex: 1; background: #1b1e2c; border: 1px solid #333a4f; color: inherit;
                border-radius: 8px; padding: 8px 12px; }
```

- [ ] **Step 2: Implement `game/src/screens/game.ts`**

```ts
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
  await yt.mount(root.querySelector('#yt-mount')!, videoIdOf(bm.songId));

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
  function frame(now: number): void {
    const dt = (now - last) / 1000; last = now;
    const snap = yt.snapshot();
    sync.tick(snap, dt);
    if (sync.state === 'live') clock.reconcile(snap.currentTime, now);

    const t = clock.time(now);
    if (sync.state === 'live') {
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
```

- [ ] **Step 3: Temporary `game/src/main.ts` to boot straight into the fixture**

```ts
import './style.css';
import fixtureHard from '@contracts/fixtures/fixture.beatmap.hard.json';
import { runGame } from './screens/game';
import type { Beatmap } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
runGame(app, fixtureHard as Beatmap, r => {
  app.innerHTML = `<pre style="padding:2rem">${JSON.stringify(r, null, 2)}</pre>`;
});
```

- [ ] **Step 4: PLAY IT** — `npm run dev`, open http://localhost:5173

Verify, in order: video loads and autoplays → overlay shows "waiting" until content actually plays (let an ad run if one appears — the overlay must hold through it) → 3-2-1 countdown → notes fall and line up with the beat feel → DFJK hits register with bursts/popups → wrong key breaks combo → holds track while held → pausing the video pauses the game, resuming counts back in → dragging the YouTube progress bar resyncs and the end screen says `"unranked": true`.

- [ ] **Step 5: Commit** `git add -A game && git commit -m "feat(game): playable game screen vs fixture" && git push`

### Task 10: API client, scores, library + results + settings screens

**Files:**
- Create: `game/src/api.ts`, `game/src/scores.ts`, `game/src/screens/library.ts`, `game/src/screens/results.ts`, `game/src/screens/settings.ts`
- Modify: `game/src/main.ts` (screen router)

- [ ] **Step 1: Implement `game/src/api.ts`**

```ts
import type { Beatmap, Difficulty, JobStatus, LibraryEntry, SearchCandidate } from './types';

const BASE = 'http://localhost:8000/api';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}
export const api = {
  search: (q: string) => get<{ candidates: SearchCandidate[] }>(`/search?q=${encodeURIComponent(q)}`),
  addSong: async (videoId: string) => {
    const r = await fetch(`${BASE}/songs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId }) });
    if (!r.ok) throw new Error(`addSong ${r.status}`);
    return r.json() as Promise<{ songId: string; jobId?: string; status: string }>;
  },
  job: (id: string) => get<JobStatus>(`/jobs/${id}`),
  songs: () => get<LibraryEntry[]>(`/songs`),
  beatmap: (songId: string, d: Difficulty) => get<Beatmap>(`/songs/${songId}/beatmaps/${d}`),
  /** true when the pipeline server is reachable */
  alive: async () => { try { await get('/songs'); return true; } catch { return false; } },
};
```

- [ ] **Step 2: Implement `game/src/scores.ts`**

```ts
export interface BestScore { score: number; maxCombo: number; grade: string; accuracy: number; }
const KEY = 'beatfall.scores';

function all(): Record<string, BestScore> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
export function bestFor(beatmapId: string): BestScore | null { return all()[beatmapId] ?? null; }
export function recordScore(beatmapId: string, s: BestScore): boolean {
  const scores = all();
  if (scores[beatmapId] && scores[beatmapId].score >= s.score) return false;
  scores[beatmapId] = s;
  localStorage.setItem(KEY, JSON.stringify(scores));
  return true;   // new personal best
}
```

- [ ] **Step 3: Implement `game/src/screens/library.ts`**

```ts
import { api } from '../api';
import { bestFor } from '../scores';
import type { Difficulty, LibraryEntry } from '../types';
import { videoIdOf } from '../types';

export function renderLibrary(root: HTMLElement,
                              onPlay: (songId: string, d: Difficulty) => void,
                              onSettings: () => void): void {
  root.innerHTML = `
    <div class="topbar">
      <input id="q" placeholder="🔍 Search a song or paste a YouTube link…">
      <button id="add">Add</button>
      <button id="settings">⚙</button>
    </div>
    <div id="banner" style="padding:0 12px;color:#ff5e7a"></div>
    <div id="list" style="padding:0 12px;overflow-y:auto"></div>`;

  const list = root.querySelector('#list') as HTMLElement;
  const banner = root.querySelector('#banner') as HTMLElement;
  root.querySelector('#settings')!.addEventListener('click', onSettings);

  async function refresh(): Promise<void> {
    let entries: LibraryEntry[] = [];
    try { entries = await api.songs(); banner.textContent = ''; }
    catch { banner.textContent = '⚠ pipeline server offline (start it on laptop A / localhost:8000)'; }
    list.innerHTML = entries.map(e => {
      const best = e.difficulties.map(d => bestFor(`${e.songId}/g1/${d}/standard`)).find(Boolean);
      const chips = e.status === 'ready'
        ? e.difficulties.map(d => `<button class="chip ${d}" data-song="${e.songId}" data-diff="${d}">${d[0].toUpperCase()}</button>`).join('')
        : e.status === 'error' ? `<span style="color:#ff5e7a">${e.error ?? 'failed'}</span> <button class="chip easy" data-retry="${e.songId}">retry</button>`
        : `<span style="color:#4cc9f0">⚙ processing…</span>`;
      return `<div class="row">
        <img src="${e.thumbnail}" alt="">
        <div class="grow">${e.title} <span style="color:#888">· ${e.channel} · ${Math.round(e.duration / 60)}:${String(Math.round(e.duration) % 60).padStart(2, '0')}${e.bpm ? ' · ' + Math.round(e.bpm) + ' BPM' : ''}</span>
          <div style="color:#777;font-size:12px">${best ? `best: ${best.grade} · ×${best.maxCombo}` : ''}</div></div>
        ${chips}</div>`;
    }).join('') || '<p style="padding:1rem;color:#888">No songs yet — search above to add one.</p>';
    list.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(b =>
      b.addEventListener('click', () => onPlay(b.dataset.song!, b.dataset.diff as Difficulty)));
    list.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach(b =>
      b.addEventListener('click', () => api.addSong(videoIdOf(b.dataset.retry!)).then(refresh)));
  }

  root.querySelector('#add')!.addEventListener('click', async () => {
    const q = (root.querySelector('#q') as HTMLInputElement).value.trim();
    if (!q) return;
    const { candidates } = await api.search(q);
    list.innerHTML = candidates.map(c => `
      <div class="row"><img src="${c.thumbnail}" alt="">
        <div class="grow">${c.title} <span style="color:#888">· ${c.channel}</span></div>
        <button class="chip easy" data-pick="${c.videoId}">map this</button></div>`).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b =>
      b.addEventListener('click', async () => { await api.addSong(b.dataset.pick!); refresh(); }));
  });

  refresh();
  const poll = setInterval(refresh, 3000);
  // crude but fine for hackathon: stop polling when screen replaced
  const obs = new MutationObserver(() => { if (!root.contains(list)) { clearInterval(poll); obs.disconnect(); } });
  obs.observe(root, { childList: true });
}
```

- [ ] **Step 4: Implement `game/src/screens/results.ts`**

```ts
import type { GameResult } from './game';
import { recordScore } from '../scores';

export function renderResults(root: HTMLElement, r: GameResult, onBack: () => void): void {
  const isPb = !r.unranked && recordScore(r.beatmapId,
    { score: r.score, maxCombo: r.maxCombo, grade: r.grade, accuracy: r.accuracy });
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding-top:8vh">
      <div style="font-size:96px;font-weight:800">${r.grade}</div>
      ${r.unranked ? '<div style="color:#ffd166">unranked (seeked during play)</div>' : ''}
      ${isPb ? '<div style="color:#06d6a0">★ new personal best</div>' : ''}
      <div style="font-size:32px">${r.score.toLocaleString()}</div>
      <div>accuracy ${(r.accuracy * 100).toFixed(1)}% · max combo ×${r.maxCombo}</div>
      <div style="color:#888">perfect ${r.counts.perfect} · great ${r.counts.great} · good ${r.counts.good} · miss ${r.counts.miss}</div>
      <button id="back">back to library</button>
    </div>`;
  root.querySelector('#back')!.addEventListener('click', onBack);
}
```

- [ ] **Step 5: Implement `game/src/screens/settings.ts`**

```ts
import { loadSettings, saveSettings } from '../settings-store';

export function renderSettings(root: HTMLElement, onBack: () => void): void {
  const s = loadSettings();
  root.innerHTML = `
    <div style="max-width:520px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:16px">
      <h2>Settings</h2>
      <div>Keys (click then press a key): ${[0, 1, 2, 3].map(i =>
        `<button class="chip medium" data-key="${i}">${s.keyCodes[i].replace('Key', '')}</button>`).join(' ')}</div>
      <label>Highway side:
        <select id="side"><option value="left">left</option><option value="right">right</option></select></label>
      <label>Theme:
        <select id="theme"><option value="stage">Dark Stage</option><option value="neon">Neon Arcade</option></select></label>
      <label>Scroll speed <input id="speed" type="range" min="300" max="1200" step="50" value="${s.scrollSpeed}"></label>
      <label>Input offset (ms) <input id="offset" type="number" value="${s.latencyOffsetMs}" step="5"></label>
      <p style="color:#888;font-size:13px">Calibration: play an easy song and watch the judgment bias —
        mostly EARLY hits → increase offset; mostly LATE → decrease. (±5 ms steps; proper metronome test is post-hackathon.)</p>
      <button id="back">save & back</button>
    </div>`;
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
    s.highwaySide = (root.querySelector('#side') as HTMLSelectElement).value as 'left' | 'right';
    s.theme = (root.querySelector('#theme') as HTMLSelectElement).value as 'stage' | 'neon';
    s.scrollSpeed = Number((root.querySelector('#speed') as HTMLInputElement).value);
    s.latencyOffsetMs = Number((root.querySelector('#offset') as HTMLInputElement).value);
    saveSettings(s);
    onBack();
  });
}
```

- [ ] **Step 6: Rewrite `game/src/main.ts` as the router**

```ts
import './style.css';
import { api } from './api';
import { renderLibrary } from './screens/library';
import { renderResults } from './screens/results';
import { renderSettings } from './screens/settings';
import { runGame } from './screens/game';
import type { Difficulty } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
let teardown: (() => void) | null = null;

function goLibrary(): void {
  teardown?.(); teardown = null;
  renderLibrary(app, goGame, () => renderSettings(app, goLibrary));
}
async function goGame(songId: string, d: Difficulty): Promise<void> {
  const bm = await api.beatmap(songId, d);
  teardown = await runGame(app, bm, r => { teardown = null; renderResults(app, r, goLibrary); });
}
goLibrary();
```

- [ ] **Step 7: Run all tests** `npm test` → all green. Manual: with the pipeline offline, library shows the offline banner; screens navigate; settings persist across reload (check localStorage).
- [ ] **Step 8: Commit** `git add -A game && git commit -m "feat(game): library/results/settings + router" && git push`

### Task 11: Live integration with Track A (both laptops together)

**Files:** none

- [ ] **Step 1:** Laptop A runs `uvicorn beatfall_pipeline.main:app --port 8000`. Laptop B `npm run dev`. Same machine? Then both on one laptop works identically. Different machines on hackathon wifi: run uvicorn with `--host 0.0.0.0` and change `BASE` in `game/src/api.ts` to laptop A's LAN IP **temporarily** (or run both halves on each laptop — simpler).
- [ ] **Step 2:** In the game UI: search "never gonna give you up" → map it → watch the row progress (processing → ready, ~1–2 min) → click **H** → play it through, including an ad if one shows.
- [ ] **Step 3:** Verify the full checklist: search→map→play loop, score recorded as personal best in the library row, retry on a deliberately broken id (paste an 11-char garbage id → error state → retry), non-embeddable flow (find a music video that blocks embedding; game shows the blocked overlay).
- [ ] **Step 4:** Commit, push, tag: `git tag mvp && git push --tags` — **this is the demo build.** Everything after this is polish on a working game.

---

**Definition of done (Track B):** all vitest green; fixture plays correctly with ads handled; after Task 11, any YouTube song goes search → map → play → score end-to-end.
