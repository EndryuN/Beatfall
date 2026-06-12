interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; }
interface Popup { x: number; y: number; text: string; color: string; life: number; }

export class Effects {
  private particles: Particle[] = [];
  private popups: Popup[] = [];

  burst(x: number, y: number, color: string, n = 14): void {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const sp = 120 + Math.random() * 160;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.5, color });
    }
  }
  popup(x: number, y: number, text: string, color: string): void {
    this.popups.push({ x, y, text, color, life: 0.6 });
  }
  update(dt: number): void {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; p.life -= dt; }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.popups) { p.y -= 40 * dt; p.life -= dt; }
    this.popups = this.popups.filter(p => p.life > 0);
  }
  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / 0.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px system-ui';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.max(0, p.life / 0.6);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text.toUpperCase(), p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}
