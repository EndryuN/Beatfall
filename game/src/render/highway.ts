import type { RuntimeNote } from '../engine/chart';
import type { Theme } from './theme';
import { Effects } from './effects';

export interface HudState { score: number; combo: number; accuracy: number; hits: number; misses: number; }

export class Highway {
  readonly effects = new Effects();
  private ctx: CanvasRenderingContext2D;
  private time = 0;
  private lastCombo = 0;
  private comboPulse = 0;
  private lastHits = 0;
  private hitPulse = 0;
  private lastMisses = 0;
  private missPulse = 0;

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

  draw(notes: RuntimeNote[], songTime: number, scrollSpeed: number,
       pressed: boolean[], dt: number, hud: HudState): void {
    const { ctx, canvas, theme } = this;
    const w = canvas.width, h = canvas.height;
    const laneW = w / this.laneCount;
    this.time += dt;
    if (hud.combo > this.lastCombo) this.comboPulse = 1;
    this.comboPulse = Math.max(0, this.comboPulse - dt * 5);
    this.lastCombo = hud.combo;
    if (hud.hits > this.lastHits) this.hitPulse = 1;
    this.hitPulse = Math.max(0, this.hitPulse - dt * 4);
    this.lastHits = hud.hits;
    if (hud.misses > this.lastMisses) this.missPulse = 1;
    this.missPulse = Math.max(0, this.missPulse - dt * 3);
    this.lastMisses = hud.misses;

    // backdrop: theme base + a soft glow pooling around the hit line
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
    const pool = ctx.createRadialGradient(w / 2, this.hitY, 10, w / 2, this.hitY, w * 0.75);
    pool.addColorStop(0, 'rgba(255,255,255,0.05)');
    pool.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, w, h);

    // lanes (+ rising glow under pressed keys)
    for (let i = 0; i < this.laneCount; i++) {
      ctx.fillStyle = theme.laneFill;
      ctx.fillRect(i * laneW + 2, 0, laneW - 4, h);
      ctx.strokeStyle = theme.laneBorder;
      ctx.strokeRect(i * laneW + 2, 0, laneW - 4, h);
      if (pressed[i]) {
        const g = ctx.createLinearGradient(0, this.hitY, 0, this.hitY - h * 0.4);
        g.addColorStop(0, 'rgba(255,255,255,0.18)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(i * laneW + 2, this.hitY - h * 0.4, laneW - 4, h * 0.4);
      }
    }

    // hit line: breathing glow, swells with combo pops
    ctx.fillStyle = theme.hitLine;
    ctx.shadowColor = theme.hitLine;
    ctx.shadowBlur = 12 + Math.sin(this.time * 3) * 4 + this.comboPulse * 14;
    ctx.fillRect(8, this.hitY - 2, w - 16, 4);
    ctx.shadowBlur = 0;

    // notes
    const r = Math.min(26, laneW * 0.32);
    for (const n of notes) {
      const x = this.laneX(n.lane);
      const y = this.noteY(n.t, songTime, scrollSpeed);
      const color = theme.noteColors[n.lane];
      if (n.type === 'hold' && n.dur) {
        const yEnd = this.noteY(n.t + n.dur, songTime, scrollSpeed);
        const yHead = n.state === 'holding' ? this.hitY : y;
        const beam = ctx.createLinearGradient(0, yEnd, 0, yHead);
        beam.addColorStop(0, this.rgba(color, n.state === 'holding' ? 0.25 : 0.15));
        beam.addColorStop(1, this.rgba(color, n.state === 'holding' ? 0.85 : theme.holdAlpha));
        ctx.strokeStyle = beam;
        ctx.lineWidth = r * 1.05;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, yEnd); ctx.lineTo(x, yHead); ctx.stroke();
        if (n.state === 'holding') {                       // bright core while held
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = r * 0.3;
          ctx.beginPath(); ctx.moveTo(x, yEnd); ctx.lineTo(x, yHead); ctx.stroke();
        }
      }
      const headY = n.state === 'holding' ? this.hitY : y;  // active hold head sticks to the hit line
      const grad = ctx.createRadialGradient(x - r * 0.3, headY - r * 0.3, r * 0.1, x, headY, r);
      grad.addColorStop(0, n.state === 'holding' ? '#ffffff' : this.lighten(color));
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ctx.shadowColor = color;
      ctx.shadowBlur = n.state === 'holding' ? 22 : 12;
      ctx.beginPath(); ctx.arc(x, headY, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, headY, r, 0, Math.PI * 2); ctx.stroke();
    }

    this.effects.update(dt);
    this.effects.draw(ctx);
    this.drawHud(hud);
  }

  private drawHud(hud: HudState): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    // score — top center
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255,255,255,0.6)'; ctx.shadowBlur = 8;
    ctx.font = `bold ${Math.round(Math.min(34, w * 0.07))}px system-ui`;
    ctx.fillText(Math.round(hud.score).toLocaleString(), w / 2, 40);
    ctx.shadowBlur = 0;
    // top-right cluster: accuracy, then hits (green) and misses (red) popping as they change
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `600 ${Math.round(Math.min(15, w * 0.035))}px system-ui`;
    ctx.fillText(`${(hud.accuracy * 100).toFixed(1)}%`, w - 12, 24);
    const counter = (text: string, color: string, y: number, pulse: number) => {
      const size = Math.min(15, w * 0.035) * (1 + pulse * 0.5);
      ctx.save();
      ctx.translate(w - 12, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = color;
      ctx.shadowColor = color; ctx.shadowBlur = 4 + pulse * 14;
      ctx.font = `bold ${Math.round(size)}px system-ui`;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    counter(`✓ ${hud.hits}`, '#06d6a0', 46, this.hitPulse);
    counter(`✗ ${hud.misses}`, '#ff5e7a', 68, this.missPulse);
    // combo — large, mid-highway, pops on every hit
    if (hud.combo >= 2) {
      const scale = 1 + this.comboPulse * 0.35;
      ctx.save();
      ctx.translate(w / 2, canvas.height * 0.3);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.fillStyle = this.theme.judgeColors.perfect;
      ctx.shadowColor = this.theme.judgeColors.perfect; ctx.shadowBlur = 16;
      ctx.font = `bold ${Math.round(Math.min(46, w * 0.10))}px system-ui`;
      ctx.fillText(`×${hud.combo}`, 0, 0);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `600 ${Math.round(Math.min(13, w * 0.03))}px system-ui`;
      ctx.fillText('COMBO', 0, 20);
      ctx.restore();
    }
  }

  private rgba(hex: string, a: number): string {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }
  private lighten(hex: string): string {
    const v = parseInt(hex.slice(1), 16);
    const f = (c: number) => Math.min(255, c + 90);
    return `rgb(${f((v >> 16) & 255)},${f((v >> 8) & 255)},${f(v & 255)})`;
  }
}
