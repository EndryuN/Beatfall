export type Difficulty = 'easy' | 'medium' | 'hard';
export type Stem = 'drums' | 'bass' | 'vocals' | 'other';

export interface BeatmapNote { t: number; lane: number; type: 'tap' | 'hold'; dur?: number; }
export interface Beatmap {
  beatmapId: string; songId: string; generatorVersion: number;
  difficulty: string; mode: 'standard' | 'custom'; laneCount: 4; notes: BeatmapNote[];
}
export interface MapInfo {
  key: string; mode: 'standard' | 'custom';
  notes: number; holds: number; generatorVersion: number;
}
export interface LibraryEntry {
  songId: string; title: string; channel: string; duration: number; thumbnail: string;
  bpm?: number; status: 'queued' | 'processing' | 'ready' | 'error' | 'outdated';
  error?: string | null; difficulties: Difficulty[]; maps?: MapInfo[]; addedAt: string;
}
export interface JobStatus {
  jobId: string; songId: string;
  stage: 'queued' | 'downloading' | 'separating' | 'analyzing' | 'generating' | 'done' | 'error';
  progress: number; error?: string | null;
}
export interface SearchCandidate { videoId: string; title: string; channel: string; duration: number; thumbnail: string; }
export type RosterMember = 'drummer' | 'bassist' | 'singer' | 'guitarist' | 'violinist';
/** The slice of analysis.json the game consumes (band layer). */
export interface AnalysisLite {
  bpm: number;
  duration: number;
  beatGrid: number[];
  roster: RosterMember[];
  leadInstrument?: 'strings' | 'guitar' | 'piano' | 'synth' | 'brass' | null;
  energyCurves: { sampleRateHz: number; stems: Record<string, number[]> };
}
export const videoIdOf = (songId: string): string => songId.replace(/^yt:/, '');
