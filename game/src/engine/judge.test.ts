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
  it('holding accrues points over time', () => {
    const s = new Scoreboard();
    const before = s.score;
    s.holdTick(0.5);
    s.holdTick(0.5);
    expect(s.score - before).toBeCloseTo(60, 0);   // 1s held at base multiplier
  });
  it('accuracy and grade', () => {
    const s = new Scoreboard();
    for (let i = 0; i < 95; i++) s.hit('perfect');
    for (let i = 0; i < 5; i++) s.miss();
    expect(s.accuracy).toBeCloseTo(0.95, 2);
    expect(s.grade()).toBe('A');     // S ≥ 0.98 > A ≥ 0.92 > B ≥ 0.85 > C ≥ 0.7 > D
  });
});
