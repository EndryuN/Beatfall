import type { GameResult } from './game';
import { recordScore } from '../scores';

const GRADE_COLOR: Record<string, string> = {
  S: '#ffd166', A: '#06d6a0', B: '#4cc9f0', C: '#b14cff', D: '#ff5e7a',
};
const GRADE_LINE: Record<string, string> = {
  S: 'FLAWLESS! The band loves you.', A: 'Great show!', B: 'Solid set.',
  C: 'Rough gig…', D: 'The band wants a word.',
};

/** Glass results card overlaid on the still-running game screen. */
export function showResultsOverlay(container: HTMLElement, r: GameResult,
                                   onReplay: () => void, onExit: () => void): void {
  const isPb = !r.unranked && recordScore(r.beatmapId,
    { score: r.score, maxCombo: r.maxCombo, grade: r.grade, accuracy: r.accuracy });
  const color = GRADE_COLOR[r.grade] ?? '#fff';
  const total = Math.max(1, r.counts.perfect + r.counts.great + r.counts.good + r.counts.miss);
  const seg = (n: number, c: string) =>
    `<div style="width:${(n / total) * 100}%;background:${c}" title="${n}"></div>`;

  const el = document.createElement('div');
  el.className = 'results-overlay';
  el.innerHTML = `
    <div class="results-card">
      <div class="grade" style="color:${color};text-shadow:0 0 32px ${color}88">${r.grade}</div>
      <div class="grade-line">${GRADE_LINE[r.grade] ?? ''}</div>
      ${r.unranked ? '<div class="tag" style="color:#ffd166">unranked — seeked during play</div>' : ''}
      ${isPb ? '<div class="tag" style="color:#06d6a0">★ new personal best</div>' : ''}
      <div class="big-score" id="score-counter">0</div>
      <div class="stat-row"><span>accuracy</span><b>${(r.accuracy * 100).toFixed(1)}%</b></div>
      <div class="stat-row"><span>max combo</span><b>×${r.maxCombo}</b></div>
      <div class="judgebar">${seg(r.counts.perfect, '#ffd166')}${seg(r.counts.great, '#06d6a0')}${seg(r.counts.good, '#9aa0b0')}${seg(r.counts.miss, '#ff5e7a')}</div>
      <div class="judgebar-legend">
        <span style="color:#ffd166">${r.counts.perfect} perfect</span>
        <span style="color:#06d6a0">${r.counts.great} great</span>
        <span style="color:#9aa0b0">${r.counts.good} good</span>
        <span style="color:#ff5e7a">${r.counts.miss} miss</span>
      </div>
      <div class="results-buttons">
        <button id="res-replay">↻ play again</button>
        <button id="res-exit" class="ghost">library</button>
      </div>
    </div>`;
  container.appendChild(el);
  el.querySelector('#res-replay')!.addEventListener('click', onReplay);
  el.querySelector('#res-exit')!.addEventListener('click', onExit);

  // score counts up with an ease-out over ~1.2s
  const counter = el.querySelector('#score-counter') as HTMLElement;
  const t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / 1200);
    const eased = 1 - Math.pow(1 - p, 3);
    counter.textContent = Math.round(r.score * eased).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
