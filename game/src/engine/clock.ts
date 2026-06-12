export class SongClock {
  private offset = 0;      // songTime(s) - perfNow(s)
  private started = false;
  private lastSample = Number.NaN;
  constructor(private snapThresholdS = 0.08, private smoothing = 0.15) {}

  reconcile(playerTimeS: number, perfNowMs: number): void {
    // getCurrentTime() only refreshes a few times a second — a repeated value is a
    // stale sample, and correcting toward it would drag the clock backward (jitter).
    if (playerTimeS === this.lastSample) return;
    this.lastSample = playerTimeS;
    const nowS = perfNowMs / 1000;
    if (!this.started) { this.offset = playerTimeS - nowS; this.started = true; return; }
    const err = playerTimeS - (nowS + this.offset);
    this.offset += Math.abs(err) > this.snapThresholdS ? err : err * this.smoothing;
  }
  time(perfNowMs: number): number { return perfNowMs / 1000 + this.offset; }
  reset(): void { this.started = false; this.offset = 0; this.lastSample = Number.NaN; }
}
