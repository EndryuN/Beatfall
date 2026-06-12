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
