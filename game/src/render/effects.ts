interface Particle {
  kind: 'dot' | 'spark' | 'confetti';
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number;
  life: number; maxLife: number;
  color: string; size: number;
}
interface Popup { x: number; y: number; text: string; color: string; life: number; }

export class Effects {
  private ps: Particle[] = [];
  private popups: Popup[] = [];
  private flashColor = '#fff';
  private flashA = 0;

  /** Ring of glowing dots + radial sparks — note hits. */
  burst(x: number, y: number, color: string, n = 14): void {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const sp = 140 + Math.random() * 180;
      this.ps.push({ kind: i % 2 ? 'spark' : 'dot', x, y,
                     vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
                     rot: a, vr: 0, life: 0.5, maxLife: 0.5, color,
                     size: i % 2 ? 10 + Math.random() * 8 : 2.5 + Math.random() * 2 });
    }
  }

  /** Gentle upward embers while a hold is being held — call every frame. */
  holdSpark(x: number, y: number, color: string): void {
    if (Math.random() < 0.6) {
      this.ps.push({ kind: 'dot', x: x + (Math.random() - 0.5) * 18, y,
                     vx: (Math.random() - 0.5) * 30, vy: -90 - Math.random() * 70,
                     rot: 0, vr: 0, life: 0.45, maxLife: 0.45, color,
                     size: 1.8 + Math.random() * 1.8 });
    }
  }

  /** Full-canvas tint that decays fast — red on miss, gold on milestones. */
  flash(color: string, alpha: number): void {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, alpha);
  }

  /** Confetti rain from the canvas top — combo milestones. */
  confetti(width: number, colors: string[]): void {
    for (let i = 0; i < 40; i++) {
      this.ps.push({ kind: 'confetti', x: Math.random() * width, y: -10 - Math.random() * 40,
                     vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160,
                     rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 10,
                     life: 1.6, maxLife: 1.6,
                     color: colors[i % colors.length], size: 4 + Math.random() * 4 });
    }
  }

  popup(x: number, y: number, text: string, color: string): void {
    this.popups.push({ x, y, text, color, life: 0.6 });
  }

  update(dt: number): void {
    for (const p of this.ps) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.kind === 'confetti' ? 60 : 500) * dt;
      p.rot += p.vr * dt;
      p.life -= dt;
    }
    this.ps = this.ps.filter(p => p.life > 0);
    for (const p of this.popups) { p.y -= 46 * dt; p.life -= dt; }
    this.popups = this.popups.filter(p => p.life > 0);
    this.flashA = Math.max(0, this.flashA - dt * 1.4);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.ps) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(p.rot) * p.size, p.y - Math.sin(p.rot) * p.size);
        ctx.stroke();
      } else if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = 'bold 24px system-ui';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.max(0, p.life / 0.6);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 14;
      ctx.fillText(p.text.toUpperCase(), p.x, p.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    if (this.flashA > 0) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalAlpha = 1;
    }
  }
}
