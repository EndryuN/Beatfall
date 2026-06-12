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
    // 0.25s window so the next note (1.2, 200ms away) is reachable; without
    // consumption the nearer 1.0 note would still win, so this tests consumption.
    expect(c.findHittable(0, 1.0, 0.25)?.t).toBe(1.2);
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
