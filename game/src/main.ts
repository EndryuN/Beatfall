import './style.css';
import { api } from './api';
import { renderLibrary } from './screens/library';
import { renderResults } from './screens/results';
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
  const bm = await api.beatmap(songId, d);
  teardown = await runGame(app, bm, r => { teardown = null; renderResults(app, r, goLibrary); });
}
goLibrary();
