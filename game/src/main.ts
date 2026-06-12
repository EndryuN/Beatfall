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

async function goGame(songId: string, key: string): Promise<void> {
  teardown?.(); teardown = null;
  const [bm, analysis] = await Promise.all([
    api.beatmap(songId, key),
    api.analysis(songId).catch(() => null),   // band still grooves (default duo) without it
  ]);
  teardown = await runGame(app, bm,
    { onReplay: () => goGame(songId, key), onExit: goLibrary }, analysis);
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
