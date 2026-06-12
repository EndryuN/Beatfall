export interface BestScore { score: number; maxCombo: number; grade: string; accuracy: number; }
const KEY = 'beatfall.scores';

function all(): Record<string, BestScore> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
export function bestFor(beatmapId: string): BestScore | null { return all()[beatmapId] ?? null; }
/** Best score for any map of a song: custom maps have a stable id, generated maps span versions. */
export function bestForMap(songId: string, key: string, mode: 'standard' | 'custom'): BestScore | null {
  if (mode === 'custom') return bestFor(`${songId}/custom/${key}`);
  return bestForSong(songId, key);
}

/** Best score for a song+difficulty across all generator versions (maps get regenerated over time). */
export function bestForSong(songId: string, difficulty: string): BestScore | null {
  const scores = all();
  let best: BestScore | null = null;
  for (const [id, s] of Object.entries(scores)) {
    if (!id.startsWith(`${songId}/g`) || !id.endsWith(`/${difficulty}/standard`)) continue;
    if (!best || s.score > best.score) best = s;
  }
  return best;
}
export function recordScore(beatmapId: string, s: BestScore): boolean {
  const scores = all();
  if (scores[beatmapId] && scores[beatmapId].score >= s.score) return false;
  scores[beatmapId] = s;
  localStorage.setItem(KEY, JSON.stringify(scores));
  return true;   // new personal best
}
