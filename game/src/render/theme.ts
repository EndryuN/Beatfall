export interface Theme {
  bg: string; laneFill: string; laneBorder: string; hitLine: string;
  noteColors: string[];               // per lane
  holdAlpha: number;
  judgeColors: Record<string, string>;
}
export const THEMES: Record<'stage' | 'neon', Theme> = {
  stage: {
    bg: '#12141f', laneFill: 'rgba(255,255,255,0.06)', laneBorder: 'rgba(255,255,255,0.15)',
    hitLine: '#ffffff', noteColors: ['#ff5e7a', '#ffd166', '#06d6a0', '#4cc9f0'],
    holdAlpha: 0.45,
    judgeColors: { perfect: '#ffd166', great: '#06d6a0', good: '#9aa0b0', miss: '#ff5e7a' },
  },
  neon: {
    bg: '#0d0221', laneFill: 'rgba(255,0,229,0.07)', laneBorder: 'rgba(0,229,255,0.35)',
    hitLine: '#ffffff', noteColors: ['#ff2ee6', '#00e5ff', '#b14cff', '#00ffb3'],
    holdAlpha: 0.5,
    judgeColors: { perfect: '#00ffb3', great: '#00e5ff', good: '#b14cff', miss: '#ff2ee6' },
  },
};
