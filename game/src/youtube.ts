import type { PlayerSnapshot, PlayerState } from './engine/sync';

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady?: () => void; }
}

let apiReady: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (apiReady) return apiReady;
  apiReady = new Promise<void>(resolve => {
    if (window.YT?.Player) return resolve();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return apiReady;
}

const STATE_MAP: Record<number, PlayerState> = {
  [-1]: 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued',
};

export class YouTubePane {
  private player: any = null;
  /** error 101/150 = embedding disabled by uploader */
  onEmbedBlocked: (() => void) | null = null;

  async mount(el: HTMLElement, videoId: string): Promise<void> {
    await loadApi();
    await new Promise<void>(resolve => {
      this.player = new window.YT.Player(el, {
        videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => resolve(),
          onError: (e: any) => {
            if (e.data === 101 || e.data === 150) this.onEmbedBlocked?.();
          },
        },
      });
    });
  }
  snapshot(): PlayerSnapshot {
    if (!this.player?.getPlayerState) return { state: 'unstarted', currentTime: 0 };
    return {
      state: STATE_MAP[this.player.getPlayerState()] ?? 'unstarted',
      currentTime: this.player.getCurrentTime?.() ?? 0,
    };
  }
  play(): void { this.player?.playVideo?.(); }
  pause(): void { this.player?.pauseVideo?.(); }
  seekTo(seconds: number): void { this.player?.seekTo?.(seconds, true); }
  destroy(): void { this.player?.destroy?.(); this.player = null; }
}
