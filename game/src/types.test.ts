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
