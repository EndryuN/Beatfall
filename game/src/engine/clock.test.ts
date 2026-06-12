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
  it('ignores stale repeated samples instead of being dragged backward', () => {
    const c = new SongClock();
    c.reconcile(10.0, 1000);
    c.reconcile(10.0, 1400);            // YouTube hasn't produced a fresh sample yet
    expect(c.time(1400)).toBeCloseTo(10.4, 3);   // free-runs, not dragged toward stale 10.0
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
