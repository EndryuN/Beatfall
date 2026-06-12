import { describe, expect, it } from 'vitest';
import { Band } from './band';

const curves = { sampleRateHz: 2, stems: { drums: [0, 0.5, 1.0], other: [0.2, 0.2, 0.2] } };

describe('Band', () => {
  it('builds members from roster mapped to stems', () => {
    const b = new Band(['drummer', 'guitarist'], curves);
    expect(b.members.map(m => m.role)).toEqual(['drummer', 'guitarist']);
    expect(b.members.map(m => m.stem)).toEqual(['drums', 'other']);
  });

  it('samples energy curves at song time (with interpolation)', () => {
    const b = new Band(['drummer'], curves);
    expect(b.energyOf(b.members[0], 0)).toBeCloseTo(0, 2);
    expect(b.energyOf(b.members[0], 1.0)).toBeCloseTo(1.0, 2);   // index 2 at 2 Hz
    expect(b.energyOf(b.members[0], 0.25)).toBeCloseTo(0.25, 2); // halfway 0 -> 0.5
    expect(b.energyOf(b.members[0], 99)).toBeCloseTo(1.0, 2);    // clamps to end
  });

  it('defaults to mid energy without curves', () => {
    const b = new Band(['drummer'], null);
    expect(b.energyOf(b.members[0], 5)).toBe(0.5);
  });

  it('whiff fells one member, rate-limited to one fall per 2s', () => {
    const b = new Band(['drummer', 'guitarist'], curves);
    b.onWhiff();
    expect(b.members.filter(m => m.pose === 'fall')).toHaveLength(1);
    b.onWhiff();                                  // inside cooldown — ignored
    expect(b.members.filter(m => m.pose === 'fall')).toHaveLength(1);
    b.update(2.1);                                // past cooldown; first fall also recovered
    b.onWhiff();
    expect(b.members.filter(m => m.pose === 'fall')).toHaveLength(1); // a fresh victim fell
  });

  it('poses decay back to groove', () => {
    const b = new Band(['drummer'], curves);
    b.onMiss();
    expect(b.members[0].pose).toBe('stumble');
    b.update(0.6);
    expect(b.members[0].pose).toBe('groove');
  });

  it('milestone hypes everyone, big combo break freezes everyone', () => {
    const b = new Band(['drummer', 'guitarist'], curves);
    b.onMilestone();
    expect(b.members.every(m => m.pose === 'hype')).toBe(true);
    b.onComboBreak();
    expect(b.members.every(m => m.pose === 'frozen')).toBe(true);
  });

  it('empty roster never throws', () => {
    const b = new Band([], curves);
    b.onWhiff(); b.onMiss(); b.onMilestone(); b.onComboBreak(); b.update(1);
    expect(b.members).toHaveLength(0);
  });
});
