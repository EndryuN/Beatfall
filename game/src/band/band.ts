import type { RosterMember, Stem } from '../types';

export type Pose = 'groove' | 'stumble' | 'fall' | 'hype' | 'frozen';
export interface BandCurves { sampleRateHz: number; stems: Record<string, number[]>; }
export interface MemberState { role: RosterMember; stem: Stem; pose: Pose; poseT: number; }

const STEM_OF: Record<RosterMember, Stem> = {
  drummer: 'drums', bassist: 'bass', singer: 'vocals', guitarist: 'other',
  violinist: 'other', pianist: 'other',
};
export const POSE_DUR: Record<Exclude<Pose, 'groove'>, number> = {
  stumble: 0.5, fall: 1.6, hype: 0.9, frozen: 0.7,
};
const FALL_COOLDOWN_S = 2;

/** Pure band logic: who's on stage, how hard they groove, how they react.
    Rendering lives in render.ts; this class never touches the canvas. */
export class Band {
  readonly members: MemberState[];
  t = 0;                                  // wall-clock animation time
  private lastFallT = -Infinity;
  private victim = 0;

  constructor(roster: RosterMember[], private curves: BandCurves | null) {
    this.members = roster.map(role => ({
      role, stem: STEM_OF[role], pose: 'groove' as Pose, poseT: 0,
    }));
  }

  /** Groove intensity 0..1 for a member at a song position (linear interp on the stem curve). */
  energyOf(m: MemberState, songTime: number): number {
    const curve = this.curves?.stems[m.stem];
    if (!curve || curve.length === 0) return 0.5;
    const x = Math.max(0, Math.min(curve.length - 1, songTime * this.curves!.sampleRateHz));
    const i = Math.floor(x);
    const a = curve[i];
    const b = curve[Math.min(curve.length - 1, i + 1)];
    return a + (b - a) * (x - i);
  }

  private finaleMode: 'party' | 'defeat' | null = null;

  update(dt: number): void {
    this.t += dt;
    for (const m of this.members) {
      if (m.pose !== 'groove') {
        m.poseT += dt;
        if (m.poseT >= POSE_DUR[m.pose]) {
          // defeat finale: the fall settles into a permanent sulk
          if (this.finaleMode === 'defeat') { this.setPose(m, 'frozen'); m.poseT = -1e9; continue; }
          m.pose = 'groove'; m.poseT = 0;
        }
      }
      if (m.pose === 'groove' && this.finaleMode === 'party') this.setPose(m, 'hype');
    }
  }

  private setPose(m: MemberState, pose: Pose): void { m.pose = pose; m.poseT = 0; }
  private nextVictim(): MemberState {
    const m = this.members[this.victim % this.members.length];
    this.victim += 1;
    return m;
  }

  /** Wrong key: somebody swings at the air and eats stage. Rate-limited so a bad run is slapstick, not noise. */
  onWhiff(): void {
    if (this.members.length === 0 || this.t - this.lastFallT < FALL_COOLDOWN_S) return;
    this.lastFallT = this.t;
    this.setPose(this.nextVictim(), 'fall');
  }

  onMiss(): void {
    if (this.members.length === 0) return;
    const m = this.nextVictim();
    if (m.pose !== 'fall') this.setPose(m, 'stumble');
  }

  onMilestone(): void { for (const m of this.members) this.setPose(m, 'hype'); }
  onComboBreak(): void { for (const m of this.members) this.setPose(m, 'frozen'); }

  /** Song over: party hard on a good grade, collapse and sulk on a bad one. */
  finale(good: boolean): void {
    this.finaleMode = good ? 'party' : 'defeat';
    for (const m of this.members) this.setPose(m, good ? 'hype' : 'fall');
  }
}
