import type { GameResult } from './game';
import { recordScore } from '../scores';

export function renderResults(root: HTMLElement, r: GameResult, onBack: () => void): void {
  const isPb = !r.unranked && recordScore(r.beatmapId,
    { score: r.score, maxCombo: r.maxCombo, grade: r.grade, accuracy: r.accuracy });
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding-top:8vh">
      <div style="font-size:96px;font-weight:800">${r.grade}</div>
      ${r.unranked ? '<div style="color:#ffd166">unranked (seeked during play)</div>' : ''}
      ${isPb ? '<div style="color:#06d6a0">★ new personal best</div>' : ''}
      <div style="font-size:32px">${r.score.toLocaleString()}</div>
      <div>accuracy ${(r.accuracy * 100).toFixed(1)}% · max combo ×${r.maxCombo}</div>
      <div style="color:#888">perfect ${r.counts.perfect} · great ${r.counts.great} · good ${r.counts.good} · miss ${r.counts.miss}</div>
      <button id="back">back to library</button>
    </div>`;
  root.querySelector('#back')!.addEventListener('click', onBack);
}
