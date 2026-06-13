import type { BeatmapNote } from '../types';

const MIN_GAP_S = 0.1;

/** Play-time projection of a stored 4-lane map onto a 3-lane highway.
    Lane 3 folds into lane 2 (outer chords become 0+2); collisions dedupe
    (holds beat taps), near-collisions nudge to a free lane or drop. */
export function projectTo3(notes: BeatmapNote[]): BeatmapNote[] {
  const out: BeatmapNote[] = [];
  const lastInLane = new Map<number, number>();   // lane -> last occupied end time

  const free = (lane: number, t: number): boolean =>
    t - (lastInLane.get(lane) ?? -10) >= MIN_GAP_S;

  for (const src of [...notes].sort((a, b) => a.t - b.t)) {
    const want = Math.min(2, src.lane);
    // exact-time duplicate in the target lane: keep one note, prefer the hold
    const dupe = out.find(n => n.lane === want && Math.abs(n.t - src.t) < 1e-3);
    if (dupe) {
      if (src.type === 'hold' && dupe.type === 'tap') {
        dupe.type = 'hold';
        dupe.dur = src.dur;
        lastInLane.set(want, src.t + (src.dur ?? 0));
      }
      continue;
    }
    let placed = false;
    for (const lane of [want, (want + 1) % 3, (want + 2) % 3]) {
      if (free(lane, src.t)) {
        out.push({ ...src, lane });
        lastInLane.set(lane, src.t + (src.dur ?? 0));
        placed = true;
        break;
      }
    }
    if (!placed) continue;                         // nowhere to go: drop the extra note
  }
  return out;
}
