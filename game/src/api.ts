import type { AnalysisLite, Beatmap, Difficulty, JobStatus, LibraryEntry, SearchCandidate } from './types';

const BASE = 'http://localhost:8000/api';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}
export const api = {
  search: (q: string) => get<{ candidates: SearchCandidate[] }>(`/search?q=${encodeURIComponent(q)}`),
  addSong: async (videoId: string, force = false) => {
    const r = await fetch(`${BASE}/songs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId, force }) });
    if (!r.ok) throw new Error(`addSong ${r.status}`);
    return r.json() as Promise<{ songId: string; jobId?: string; status: string }>;
  },
  deleteSong: async (songId: string) => {
    const r = await fetch(`${BASE}/songs/${songId}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error(`deleteSong ${r.status}`);
  },
  job: (id: string) => get<JobStatus>(`/jobs/${id}`),
  songs: () => get<LibraryEntry[]>(`/songs`),
  beatmap: (songId: string, d: Difficulty) => get<Beatmap>(`/songs/${songId}/beatmaps/${d}`),
  analysis: (songId: string) => get<AnalysisLite>(`/songs/${songId}/analysis`),
  /** true when the pipeline server is reachable */
  alive: async () => { try { await get('/songs'); return true; } catch { return false; } },
};
