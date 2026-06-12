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
