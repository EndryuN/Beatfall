import './style.css';
import fixtureHard from '@contracts/fixtures/fixture.beatmap.hard.json';
import { runGame } from './screens/game';
import type { Beatmap } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
runGame(app, fixtureHard as Beatmap, r => {
  app.innerHTML = `<pre style="padding:2rem">${JSON.stringify(r, null, 2)}</pre>`;
});
