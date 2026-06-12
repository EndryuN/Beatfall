export interface BestScore { score: number; maxCombo: number; grade: string; accuracy: number; }
const KEY = 'beatfall.scores';

function all(): Record<string, BestScore> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
export function bestFor(beatmapId: string): BestScore | null { return all()[beatmapId] ?? null; }
export function recordScore(beatmapId: string, s: BestScore): boolean {
  const scores = all();
  if (scores[beatmapId] && scores[beatmapId].score >= s.score) return false;
  scores[beatmapId] = s;
  localStorage.setItem(KEY, JSON.stringify(scores));
  return true;   // new personal best
}
