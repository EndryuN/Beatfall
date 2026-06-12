import type { RuntimeNote } from '../engine/chart';
import type { Theme } from './theme';
import { Effects } from './effects';

export class Highway {
  readonly effects = new Effects();
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement, private theme: Theme,
              private laneCount = 4, private hitLineFrac = 0.85) {
    this.ctx = canvas.getContext('2d')!;
  }
  laneX(lane: number): number {
    const w = this.canvas.width / this.laneCount;
    return w * lane + w / 2;
  }
  get hitY(): number { return this.canvas.height * this.hitLineFrac; }

  /** y position for a note at time t when song is at songTime */
  noteY(t: number, songTime: number, scrollSpeed: number): number {
    return this.hitY - (t - songTime) * scrollSpeed;
  }

  draw(notes: RuntimeNote[], songTime: number, scrollSpeed: number, pressed: boolean[], dt: number): void {
    const { ctx, canvas, theme } = this;
    const laneW = canvas.width / this.laneCount;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < this.laneCount; i++) {
      ctx.fillStyle = pressed[i] ? 'rgba(255,255,255,0.14)' : theme.laneFill;
      ctx.fillRect(i * laneW + 2, 0, laneW - 4, canvas.height);
      ctx.strokeStyle = theme.laneBorder;
      ctx.strokeRect(i * laneW + 2, 0, laneW - 4, canvas.height);
    }
    // hit line
    ctx.fillStyle = theme.hitLine;
    ctx.shadowColor = theme.hitLine; ctx.shadowBlur = 12;
    ctx.fillRect(8, this.hitY - 2, canvas.width - 16, 4);
    ctx.shadowBlur = 0;
    // notes
    const r = Math.min(26, laneW * 0.32);
    for (const n of notes) {
      const x = this.laneX(n.lane);
      const y = this.noteY(n.t, songTime, scrollSpeed);
      const color = theme.noteColors[n.lane];
      if (n.type === 'hold' && n.dur) {
        const yEnd = this.noteY(n.t + n.dur, songTime, scrollSpeed);
        ctx.globalAlpha = theme.holdAlpha;
        ctx.fillStyle = color;
        ctx.fillRect(x - r * 0.5, yEnd, r, y - yEnd);
        ctx.globalAlpha = 1;
      }
      const headY = n.state === 'holding' ? this.hitY : y;   // active hold head sticks to the hit line
      ctx.fillStyle = n.state === 'holding' ? '#ffffff' : color;
      ctx.beginPath(); ctx.arc(x, headY, r, 0, Math.PI * 2); ctx.fill();
    }
    this.effects.update(dt);
    this.effects.draw(ctx);
  }
}
