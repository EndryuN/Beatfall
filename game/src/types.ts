export type Difficulty = 'easy' | 'medium' | 'hard';
export type Stem = 'drums' | 'bass' | 'vocals' | 'other';

export interface BeatmapNote { t: number; lane: number; type: 'tap' | 'hold'; dur?: number; }
export interface Beatmap {
  beatmapId: string; songId: string; generatorVersion: number;
  difficulty: Difficulty; mode: 'standard'; laneCount: 4; notes: BeatmapNote[];
}
export interface LibraryEntry {
  songId: string; title: string; channel: string; duration: number; thumbnail: string;
  bpm?: number; status: 'queued' | 'processing' | 'ready' | 'error';
  error?: string | null; difficulties: Difficulty[]; addedAt: string;
}
export interface JobStatus {
  jobId: string; songId: string;
  stage: 'queued' | 'downloading' | 'separating' | 'analyzing' | 'generating' | 'done' | 'error';
  progress: number; error?: string | null;
}
export interface SearchCandidate { videoId: string; title: string; channel: string; duration: number; thumbnail: string; }
export const videoIdOf = (songId: string): string => songId.replace(/^yt:/, '');
