import type { AnalysisLite } from '../types';

const STEM_STYLE: [string, string, number][] = [
  ['drums', '#ff5e7a', 1.0],
  ['other', '#06d6a0', 0.85],
  ['vocals', '#ffd166', 0.9],
  ['bass', '#4cc9f0', 0.7],
];
const SPAN_S = 8;            // seconds of audio visible
const PLAYHEAD_FRAC = 0.3;   // playhead sits left of center: the future streams in from the right

/** Scrolling per-stem energy waveform with a fixed playhead — the audio timeline.
    (Also the backbone of the future edit/record mode.) */
export function drawVisualizer(ctx: CanvasRenderingContext2D,
                               curves: AnalysisLite['energyCurves'] | null,
                               songTime: number): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#13141d';
  ctx.fillRect(0, 0, w, h);
  const mid = h / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, mid - 0.5, w, 1);
  if (!curves) return;

  const rate = curves.sampleRateHz;
  const step = 4;                                   // bar width in px
  for (let x = 0; x < w; x += step) {
    const t = songTime + ((x / w) - PLAYHEAD_FRAC) * SPAN_S;
    const past = t < songTime;
    for (const [stem, color, weight] of STEM_STYLE) {
      const curve = curves.stems[stem];
      if (!curve) continue;
      const i = Math.round(t * rate);
      const v = i >= 0 && i < curve.length ? curve[i] : 0;
      if (v <= 0.02) continue;
      const bar = v * weight * (mid - 2);
      ctx.globalAlpha = past ? 0.22 : 0.55;
      ctx.fillStyle = color;
      ctx.fillRect(x, mid - bar, step - 1, bar * 2);  // mirrored around the midline
    }
  }
  ctx.globalAlpha = 1;

  // playhead
  const px = w * PLAYHEAD_FRAC;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 8;
  ctx.fillRect(px - 1, 0, 2, h);
  ctx.shadowBlur = 0;
}
