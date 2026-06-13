import { describe, expect, it } from 'vitest';
import { projectTo3 } from './project';
import type { BeatmapNote } from '../types';

describe('projectTo3', () => {
  it('folds lane 3 into lane 2, keeps others', () => {
    const notes: BeatmapNote[] = [
      { t: 1.0, lane: 0, type: 'tap' },
      { t: 2.0, lane: 1, type: 'tap' },
      { t: 3.0, lane: 2, type: 'tap' },
      { t: 4.0, lane: 3, type: 'tap' },
    ];
    expect(projectTo3(notes).map(n => n.lane)).toEqual([0, 1, 2, 2]);
  });

  it('outer chord D+K becomes D+J (lanes 0+2)', () => {
    const out = projectTo3([
      { t: 1.0, lane: 0, type: 'tap' },
      { t: 1.0, lane: 3, type: 'tap' },
    ]);
    expect(out.map(n => n.lane).sort()).toEqual([0, 2]);
  });

  it('collisions after folding dedupe (hold wins over tap)', () => {
    const out = projectTo3([
      { t: 1.0, lane: 2, type: 'tap' },
      { t: 1.0, lane: 3, type: 'hold', dur: 1.0 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('hold');
    expect(out[0].lane).toBe(2);
  });

  it('near-collisions in the folded lane shift to a free lane', () => {
    const out = projectTo3([
      { t: 1.0, lane: 2, type: 'tap' },
      { t: 1.05, lane: 3, type: 'tap' },   // would land 50ms behind in lane 2
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].lane).not.toBe(2);       // nudged to a free lane
  });

  it('drops a folded note when no lane is free', () => {
    const out = projectTo3([
      { t: 1.0, lane: 0, type: 'tap' },
      { t: 1.0, lane: 1, type: 'tap' },
      { t: 1.0, lane: 2, type: 'tap' },
      { t: 1.02, lane: 3, type: 'tap' },   // nowhere to go
    ]);
    expect(out).toHaveLength(3);
  });

  it('never emits lanes outside 0..2 and stays time-sorted', () => {
    const notes: BeatmapNote[] = Array.from({ length: 40 }, (_, i) => (
      { t: i * 0.25, lane: i % 4, type: 'tap' as const }));
    const out = projectTo3(notes);
    expect(out.every(n => n.lane >= 0 && n.lane <= 2)).toBe(true);
    expect([...out].sort((a, b) => a.t - b.t).map(n => n.t)).toEqual(out.map(n => n.t));
  });
});
