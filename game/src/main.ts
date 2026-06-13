import './style.css';
import { api } from './api';
import { renderLibrary } from './screens/library';
import { renderSettings } from './screens/settings';
import { runEditor } from './screens/editor';
import { runGame } from './screens/game';

const app = document.querySelector<HTMLDivElement>('#app')!;
let teardown: (() => void) | null = null;

function goLibrary(): void {
  teardown?.(); teardown = null;
  renderLibrary(app, {
    onPlay: goGame,
    onEdit: goEditor,
    onSettings: () => renderSettings(app, goLibrary),
  });
}

const STD_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

async function goGame(songId: string, key: string): Promise<void> {
  teardown?.(); teardown = null;
  const [bm, analysis, songs] = await Promise.all([
    api.beatmap(songId, key),
    api.analysis(songId).catch(() => null),   // band still grooves (default duo) without it
    api.songs().catch(() => []),              // for the pause-menu difficulty switcher
  ]);
  const entry = songs.find(e => e.songId === songId);
  const maps = (entry?.maps ?? [{ key, mode: 'standard' as const }])
    .map(m => ({ key: m.key, mode: m.mode }))
    .sort((a, b) =>
      (a.mode === b.mode ? 0 : a.mode === 'standard' ? -1 : 1) ||
      (STD_ORDER[a.key] ?? 9) - (STD_ORDER[b.key] ?? 9) || a.key.localeCompare(b.key));
  teardown = await runGame(app, bm, {
    onReplay: () => goGame(songId, key),
    onExit: goLibrary,
    currentKey: key,
    maps,
    onChangeDifficulty: (k: string) => goGame(songId, k),
  }, analysis);
}

async function goEditor(songId: string, name: string, baseKey: string | null): Promise<void> {
  teardown?.(); teardown = null;
  const [analysis, base] = await Promise.all([
    api.analysis(songId).catch(() => null),
    baseKey ? api.beatmap(songId, baseKey).catch(() => null) : Promise.resolve(null),
  ]);
  teardown = await runEditor(app, songId, name, base?.notes ?? [], analysis, {
    onExit: goLibrary,
    onTest: (key: string) => goGame(songId, key),
  });
}

goLibrary();
