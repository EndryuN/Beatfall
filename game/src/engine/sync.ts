export type PlayerState = 'unstarted' | 'playing' | 'paused' | 'buffering' | 'ended' | 'cued';
export interface PlayerSnapshot { state: PlayerState; currentTime: number; }
export type SyncState = 'waiting' | 'countdown' | 'live' | 'paused' | 'ended';

export class SyncMachine {
  state: SyncState = 'waiting';
  unranked = false;
  countdownLeftS = 0;
  private lastTime = -1;
  private stallS = 0;

  constructor(private countdownS = 3, private stallThresholdS = 0.5, private seekJumpS = 1.5) {}

  forceLive(): void { this.state = 'live'; this.lastTime = -1; }

  private advancing(t: number): boolean {
    const adv = this.lastTime >= 0 && t > this.lastTime + 0.001;
    return adv;
  }

  tick(p: PlayerSnapshot, dtS: number): SyncState {
    const adv = this.advancing(p.currentTime);
    const jumped = this.lastTime >= 0 && Math.abs(p.currentTime - this.lastTime) > this.seekJumpS;

    switch (this.state) {
      case 'waiting':
        if (p.state === 'playing' && adv) { this.state = 'countdown'; this.countdownLeftS = this.countdownS; }
        break;
      case 'countdown':
        if (p.state === 'playing' && adv) {
          this.countdownLeftS -= dtS;
          if (this.countdownLeftS <= 0) this.state = 'live';
        } else if (p.state === 'paused') this.state = 'paused';
        break;
      case 'live':
        if (p.state === 'ended') this.state = 'ended';
        else if (p.state === 'paused') this.state = 'paused';
        else if (jumped && p.state === 'playing') { this.unranked = true; this.stallS = 0; }
        else if ((p.state === 'playing' || p.state === 'buffering') && !adv) {
          this.stallS += dtS;
          if (this.stallS > this.stallThresholdS) { this.state = 'waiting'; this.stallS = 0; }
        } else this.stallS = 0;
        break;
      case 'paused':
        if (p.state === 'playing' && adv) { this.state = 'countdown'; this.countdownLeftS = this.countdownS; }
        break;
      case 'ended':
        break;
    }
    this.lastTime = p.currentTime;
    return this.state;
  }
}
