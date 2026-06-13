import type { Band, MemberState } from './band';
import { POSE_DUR } from './band';

const SHIRT: Record<string, string> = {
  drummer: '#ff5e7a', guitarist: '#06d6a0', bassist: '#4cc9f0', singer: '#ffd166',
  violinist: '#b14cff', pianist: '#4895ef',
};
const SKIN = '#f1c9a5';
const OUTLINE = '#1b1226';

/** Draw the whole band into its stage canvas. Pure drawing — all state lives in Band. */
export function drawBand(ctx: CanvasRenderingContext2D, band: Band, songTime: number): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const floorY = h * 0.88;
  const n = band.members.length;
  if (n === 0) return;

  // stage floor + spotlights pulsing with the drums
  const drumsE = band.members[0] ? band.energyOf(band.members[0], songTime) : 0.5;
  ctx.fillStyle = `rgba(255,255,255,${0.04 + drumsE * 0.05})`;
  ctx.fillRect(0, floorY, w, h - floorY);
  for (let i = 0; i < n; i++) {
    const cx = (w / (n + 1)) * (i + 1);
    const g = ctx.createRadialGradient(cx, floorY, 4, cx, floorY, w / (n + 2));
    g.addColorStop(0, `rgba(255,240,200,${0.10 + drumsE * 0.10})`);
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, floorY, w / (n + 2), 14, 0, 0, Math.PI * 2); ctx.fill();
  }

  band.members.forEach((m, i) => {
    const cx = (w / (n + 1)) * (i + 1);
    const scale = Math.min(h / 150, w / (n * 130));
    drawMember(ctx, band, m, songTime, cx, floorY, Math.max(0.6, scale), i);
  });
}

function drawMember(ctx: CanvasRenderingContext2D, band: Band, m: MemberState,
                    songTime: number, cx: number, floorY: number, s: number, idx: number): void {
  const e = band.energyOf(m, songTime);
  const groovePhase = band.t * (3 + e * 5) + idx * 1.7;
  let bob = Math.sin(groovePhase) * e * 6 * s;   // bounce with the stem's energy
  let tilt = Math.sin(groovePhase * 0.5) * e * 0.08;
  let rot = 0;                                    // whole-body rotation (falls)
  let jump = 0;
  let frozen = false;

  if (m.pose === 'stumble') {
    const p = m.poseT / POSE_DUR.stumble;
    tilt = Math.sin(m.poseT * 28) * 0.4 * (1 - p);
    bob = 0;
  } else if (m.pose === 'fall') {
    const p = m.poseT / POSE_DUR.fall;
    if (p < 0.22) rot = (p / 0.22) * (Math.PI / 2);            // swing past vertical, timber!
    else if (p < 0.8) rot = Math.PI / 2;                       // flat on the floor
    else rot = (1 - (p - 0.8) / 0.2) * (Math.PI / 2);          // sheepishly get up
    bob = 0; tilt = 0;
  } else if (m.pose === 'hype') {
    jump = -Math.abs(Math.sin(m.poseT * 12)) * 16 * s;
    bob = 0;
  } else if (m.pose === 'frozen') {
    frozen = true; bob = 0; tilt = 0;
  }

  ctx.save();
  ctx.translate(cx, floorY + jump);
  ctx.rotate(rot + tilt);

  const bodyH = 46 * s, bodyW = 30 * s, headR = 13 * s;
  const shirt = SHIRT[m.role] ?? '#999';

  // legs
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-7 * s, -bodyH * 0.35); ctx.lineTo(-9 * s, 0);
  ctx.moveTo(7 * s, -bodyH * 0.35); ctx.lineTo(9 * s, 0);
  ctx.stroke();

  // blob torso
  ctx.fillStyle = shirt; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.ellipse(0, -bodyH * 0.62, bodyW * 0.55, bodyH * 0.42, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // head
  const headY = -bodyH * 1.08 + bob * 0.3;
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(0, headY, headR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // face: dizzy X-eyes when flat, dot eyes otherwise; mouth by mood
  const flat = m.pose === 'fall' && m.poseT / POSE_DUR.fall >= 0.22 && m.poseT / POSE_DUR.fall < 0.8;
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.8 * s;
  if (flat) {
    for (const ex of [-4.5 * s, 4.5 * s]) {
      ctx.beginPath();
      ctx.moveTo(ex - 2 * s, headY - 3 * s); ctx.lineTo(ex + 2 * s, headY + 1 * s);
      ctx.moveTo(ex + 2 * s, headY - 3 * s); ctx.lineTo(ex - 2 * s, headY + 1 * s);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = OUTLINE;
    ctx.beginPath(); ctx.arc(-4.5 * s, headY - 2 * s, 1.7 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4.5 * s, headY - 2 * s, 1.7 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath();
  if (m.pose === 'hype' || (m.role === 'singer' && e > 0.5 && !frozen)) {
    ctx.arc(0, headY + 4 * s, 3.5 * s, 0, Math.PI);            // open-mouth wail
  } else if (frozen || flat) {
    ctx.moveTo(-3 * s, headY + 6 * s); ctx.lineTo(3 * s, headY + 6 * s);  // grim line
  } else {
    ctx.arc(0, headY + 3.5 * s, 3 * s, 0.15 * Math.PI, 0.85 * Math.PI);   // smile
  }
  ctx.stroke();

  // arms + instrument by role
  drawRolePropAndArms(ctx, m, band, e, s, bodyH, headY, frozen);

  ctx.restore();

  // orbiting dizzy stars while flat on the floor
  if (flat) {
    ctx.fillStyle = '#ffd166';
    ctx.font = `${Math.round(10 * s)}px system-ui`;
    for (let k = 0; k < 3; k++) {
      const a = band.t * 4 + (k * Math.PI * 2) / 3;
      ctx.fillText('★', cx + Math.cos(a) * 22 * s + 14 * s, floorY - 10 * s + Math.sin(a) * 6 * s);
    }
  }
  // exclamation when frozen (record-scratch moment)
  if (frozen) {
    ctx.fillStyle = '#ffd166';
    ctx.font = `bold ${Math.round(14 * s)}px system-ui`;
    ctx.fillText('!', cx + 16 * s, floorY - 80 * s);
  }
}

function drawRolePropAndArms(ctx: CanvasRenderingContext2D, m: MemberState, band: Band,
                             e: number, s: number, bodyH: number, headY: number, frozen: boolean): void {
  const armY = -bodyH * 0.72;
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3.5 * s; ctx.lineCap = 'round';
  const swing = frozen ? 0 : Math.sin(band.t * (6 + e * 10)) * e;

  if (m.pose === 'hype') {                       // everyone: arms straight up
    ctx.beginPath();
    ctx.moveTo(-bodyW2(s), armY); ctx.lineTo(-20 * s, headY - 12 * s);
    ctx.moveTo(bodyW2(s), armY); ctx.lineTo(20 * s, headY - 12 * s);
    ctx.stroke();
    return;
  }

  switch (m.role) {
    case 'drummer': {
      // a little kit: two cymbals on stands flanking him, a snare in front
      ctx.strokeStyle = '#4a4a55'; ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.moveTo(-18 * s, 0); ctx.lineTo(-18 * s, -22 * s);     // left cymbal stand
      ctx.moveTo(18 * s, 0); ctx.lineTo(18 * s, -24 * s);       // right cymbal stand
      ctx.stroke();
      ctx.fillStyle = '#e8c45a';                                 // cymbals
      ctx.beginPath(); ctx.ellipse(-18 * s, -23 * s, 8 * s, 2.2 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(18 * s, -25 * s, 8 * s, 2.2 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // snare drum in front (legs → shell → head), drawn over the body
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(-7 * s, 0); ctx.lineTo(-6 * s, -8 * s);
      ctx.moveTo(7 * s, 0); ctx.lineTo(6 * s, -8 * s); ctx.stroke();
      ctx.fillStyle = '#c23b4c';
      ctx.fillRect(-12 * s, -14 * s, 24 * s, 6 * s); ctx.strokeRect(-12 * s, -14 * s, 24 * s, 6 * s);
      ctx.fillStyle = '#d9d9e8';
      ctx.beginPath(); ctx.ellipse(0, -14 * s, 12 * s, 3.6 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // arms + sticks, alternating with the music
      const lift = swing * 10 * s;
      ctx.lineWidth = 3.5 * s;
      ctx.beginPath();
      ctx.moveTo(-bodyW2(s), armY); ctx.lineTo(-11 * s, -19 * s - Math.max(0, lift));
      ctx.moveTo(bodyW2(s), armY); ctx.lineTo(11 * s, -19 * s - Math.max(0, -lift));
      ctx.stroke();
      ctx.lineWidth = 2 * s;                                     // sticks tip toward the snare
      ctx.beginPath();
      ctx.moveTo(-11 * s, -19 * s - Math.max(0, lift)); ctx.lineTo(-3 * s, -15 * s);
      ctx.moveTo(11 * s, -19 * s - Math.max(0, -lift)); ctx.lineTo(3 * s, -15 * s);
      ctx.stroke();
      break;
    }
    case 'guitarist':
    case 'bassist': {
      const long = m.role === 'bassist' ? 1.3 : 1;
      ctx.save();
      ctx.rotate(-0.35);
      ctx.fillStyle = m.role === 'bassist' ? '#8a5a2b' : '#b5432e';
      ctx.beginPath(); ctx.ellipse(2 * s, -bodyH * 0.5, 11 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 3 * s;                      // neck
      ctx.beginPath(); ctx.moveTo(8 * s, -bodyH * 0.56); ctx.lineTo((30 * long) * s, -bodyH * 0.85); ctx.stroke();
      ctx.restore();
      ctx.lineWidth = 3.5 * s;                    // strum arm + fret arm
      ctx.beginPath();
      ctx.moveTo(-bodyW2(s), armY); ctx.lineTo(-16 * s, -bodyH * 0.78);
      ctx.moveTo(bodyW2(s), armY); ctx.lineTo(6 * s + swing * 4 * s, -bodyH * 0.42);
      ctx.stroke();
      break;
    }
    case 'pianist': {
      // a keyboard slab in front, both hands bouncing on the keys with the music
      ctx.fillStyle = '#1b1226';
      ctx.fillRect(-22 * s, -6 * s, 44 * s, 9 * s); ctx.strokeRect(-22 * s, -6 * s, 44 * s, 9 * s);
      ctx.fillStyle = '#f0f0f5';
      for (let k = -5; k <= 5; k++) {
        ctx.fillRect(k * 4 * s - 1.4 * s, -5 * s, 2.8 * s, 6 * s);
      }
      ctx.lineWidth = 3.5 * s;
      const lh = swing * 4 * s, rh = -swing * 4 * s;
      ctx.beginPath();
      ctx.moveTo(-bodyW2(s), armY); ctx.lineTo(-12 * s, -6 * s + lh);
      ctx.moveTo(bodyW2(s), armY); ctx.lineTo(12 * s, -6 * s + rh);
      ctx.stroke();
      break;
    }
    case 'violinist': {
      // violin tucked at the shoulder, bow sawing with the music
      ctx.save();
      ctx.rotate(-0.45);
      ctx.fillStyle = '#8a5a2b';
      ctx.beginPath(); ctx.ellipse(7 * s, headY + 14 * s, 9 * s, 5.5 * s, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2.5 * s;                    // violin neck
      ctx.beginPath(); ctx.moveTo(14 * s, headY + 12 * s); ctx.lineTo(24 * s, headY + 8 * s); ctx.stroke();
      ctx.restore();
      const saw = swing * 8 * s;                  // bow stroke
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(-2 * s + saw, headY + 2 * s);
      ctx.lineTo(18 * s + saw, headY + 16 * s);
      ctx.stroke();
      ctx.lineWidth = 3.5 * s;                    // arms: short fingering hand + bow hand
      ctx.beginPath();
      ctx.moveTo(-bodyW2(s), armY); ctx.lineTo(2 * s, headY + 13 * s);   // shortened, no body-cross
      ctx.moveTo(bodyW2(s), armY); ctx.lineTo(10 * s + saw, headY + 10 * s);
      ctx.stroke();
      break;
    }
    case 'singer': {
      // mic stand + lean-in on loud vocals
      const lean = e * 6 * s;
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath(); ctx.moveTo(18 * s, 0); ctx.lineTo(18 * s, headY + 6 * s); ctx.stroke();
      ctx.fillStyle = '#444a5e';
      ctx.beginPath(); ctx.arc(18 * s - lean * 0.3, headY + 4 * s, 4 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 3.5 * s;
      ctx.beginPath();
      ctx.moveTo(-bodyW2(s), armY); ctx.lineTo(-14 * s - swing * 5 * s, armY - 8 * s);  // free arm waves
      ctx.moveTo(bodyW2(s), armY); ctx.lineTo(14 * s, headY + 6 * s);                   // mic hand
      ctx.stroke();
      break;
    }
  }
}

function bodyW2(s: number): number { return 15 * s; }
