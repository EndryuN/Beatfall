import './style.css';
import { api } from './api';
import { renderLibrary } from './screens/library';
import { renderSettings } from './screens/settings';
import { runGame } from './screens/game';
import type { Difficulty } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
let teardown: (() => void) | null = null;

function goLibrary(): void {
  teardown?.(); teardown = null;
  renderLibrary(app, goGame, () => renderSettings(app, goLibrary));
}
async function goGame(songId: string, d: Difficulty): Promise<void> {
  teardown?.(); teardown = null;
  const [bm, analysis] = await Promise.all([
    api.beatmap(songId, d),
    api.analysis(songId).catch(() => null),   // band still grooves (default duo) without it
  ]);
  teardown = await runGame(app, bm,
    { onReplay: () => goGame(songId, d), onExit: goLibrary }, analysis);
}
goLibrary();
