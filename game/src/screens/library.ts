import { api } from '../api';
import { bestFor } from '../scores';
import type { Difficulty, LibraryEntry } from '../types';
import { videoIdOf } from '../types';

const STAGE_LABEL: Record<string, string> = {
  queued: 'queued…',
  downloading: 'downloading audio',
  separating: 'separating stems',
  analyzing: 'analyzing beats',
  generating: 'generating beatmaps',
};

export function renderLibrary(root: HTMLElement,
                              onPlay: (songId: string, d: Difficulty) => void,
                              onSettings: () => void): void {
  root.innerHTML = `
    <div class="topbar">
      <input id="q" placeholder="🔍 Search a song or paste a YouTube link…">
      <button id="add">Add</button>
      <button id="settings">⚙</button>
    </div>
    <div id="banner" style="padding:0 12px;color:#ff5e7a"></div>
    <div id="list" style="padding:0 12px;overflow-y:auto"></div>`;

  const list = root.querySelector('#list') as HTMLElement;
  const banner = root.querySelector('#banner') as HTMLElement;
  root.querySelector('#settings')!.addEventListener('click', onSettings);

  // While search results are shown, the 3 s poll must not clobber them.
  let showingResults = false;
  // Songs being processed aren't in the library index yet — track their jobs here.
  const activeJobs = new Map<string, string>();                       // jobId -> songId
  const failedJobs = new Map<string, { songId: string; error: string }>();

  async function jobRowsHtml(): Promise<string> {
    const rows: string[] = [];
    for (const [jobId, songId] of [...activeJobs]) {
      try {
        const j = await api.job(jobId);
        if (j.stage === 'done') { activeJobs.delete(jobId); continue; }
        if (j.stage === 'error') {
          activeJobs.delete(jobId);
          failedJobs.set(jobId, { songId: j.songId, error: j.error ?? 'failed' });
          continue;
        }
        const pct = Math.round((j.progress ?? 0) * 100);
        rows.push(`
          <div class="row">
            <div class="grow">${videoIdOf(songId)}
              <div style="color:#4cc9f0;font-size:12px">⚙ ${STAGE_LABEL[j.stage] ?? j.stage} · ${pct}%</div>
              <div style="height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;margin-top:4px;max-width:420px">
                <div style="width:${pct}%;height:100%;background:#4cc9f0"></div>
              </div>
            </div>
          </div>`);
      } catch { /* pipeline unreachable — offline banner already covers it */ }
    }
    for (const [jobId, f] of failedJobs) {
      rows.push(`
        <div class="row">
          <div class="grow">${videoIdOf(f.songId)} <span style="color:#ff5e7a">⚠ ${f.error}</span></div>
          <button class="chip easy" data-job-retry="${jobId}">retry</button>
          <button class="chip hard" data-job-dismiss="${jobId}">✕</button>
        </div>`);
    }
    return rows.join('');
  }

  async function startAdd(videoId: string): Promise<void> {
    const r = await api.addSong(videoId);
    if (r.jobId) activeJobs.set(r.jobId, r.songId);
    showingResults = false;
    await refresh();
  }

  async function refresh(): Promise<void> {
    if (showingResults) return;
    const jobs = await jobRowsHtml();   // poll jobs first so a just-finished song shows as a real row below
    let entries: LibraryEntry[] = [];
    try { entries = await api.songs(); banner.textContent = ''; }
    catch { banner.textContent = '⚠ pipeline server offline (start it on laptop A / localhost:8000)'; }
    const entryHtml = entries.map(e => {
      const best = e.difficulties.map(d => bestFor(`${e.songId}/g1/${d}/standard`)).find(Boolean);
      const chips = e.status === 'ready'
        ? e.difficulties.map(d => `<button class="chip ${d}" data-song="${e.songId}" data-diff="${d}">${d[0].toUpperCase()}</button>`).join('')
        : e.status === 'error' ? `<span style="color:#ff5e7a">${e.error ?? 'failed'}</span> <button class="chip easy" data-retry="${e.songId}">retry</button>`
        : `<span style="color:#4cc9f0">⚙ processing…</span>`;
      return `<div class="row">
        <img src="${e.thumbnail}" alt="">
        <div class="grow">${e.title} <span style="color:#888">· ${e.channel} · ${Math.round(e.duration / 60)}:${String(Math.round(e.duration) % 60).padStart(2, '0')}${e.bpm ? ' · ' + Math.round(e.bpm) + ' BPM' : ''}</span>
          <div style="color:#777;font-size:12px">${best ? `best: ${best.grade} · ×${best.maxCombo}` : ''}</div></div>
        ${chips}</div>`;
    }).join('');
    list.innerHTML = (jobs + entryHtml) || '<p style="padding:1rem;color:#888">No songs yet — search above to add one.</p>';
    list.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(b =>
      b.addEventListener('click', () => onPlay(b.dataset.song!, b.dataset.diff as Difficulty)));
    list.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach(b =>
      b.addEventListener('click', () => startAdd(videoIdOf(b.dataset.retry!))));
    list.querySelectorAll<HTMLButtonElement>('[data-job-retry]').forEach(b =>
      b.addEventListener('click', () => {
        const f = failedJobs.get(b.dataset.jobRetry!);
        failedJobs.delete(b.dataset.jobRetry!);
        if (f) startAdd(videoIdOf(f.songId));
      }));
    list.querySelectorAll<HTMLButtonElement>('[data-job-dismiss]').forEach(b =>
      b.addEventListener('click', () => { failedJobs.delete(b.dataset.jobDismiss!); refresh(); }));
  }

  // A pasted YouTube link (or bare 11-char id) skips search and maps immediately.
  function extractVideoId(q: string): string | null {
    if (/^[A-Za-z0-9_-]{11}$/.test(q)) return q;
    const m = q.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  const input = root.querySelector('#q') as HTMLInputElement;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') (root.querySelector('#add') as HTMLButtonElement).click();
  });

  root.querySelector('#add')!.addEventListener('click', async () => {
    const q = input.value.trim();
    if (!q) return;
    banner.textContent = '';
    try {
      const videoId = extractVideoId(q);
      if (videoId) {                       // direct add: paste link → pipeline starts now
        input.value = '';
        await startAdd(videoId);
        return;
      }
      showingResults = true;
      list.innerHTML = '<p style="padding:1rem;color:#888">searching…</p>';
      const { candidates } = await api.search(q);
      list.innerHTML =
        `<div class="row" style="background:none"><button class="chip medium" id="back-to-library">← back to library</button></div>` +
        candidates.map(c => `
        <div class="row"><img src="${c.thumbnail}" alt="">
          <div class="grow">${c.title} <span style="color:#888">· ${c.channel}</span></div>
          <button class="chip easy" data-pick="${c.videoId}">map this</button></div>`).join('');
      list.querySelector('#back-to-library')!.addEventListener('click', () => {
        showingResults = false;
        refresh();
      });
      list.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b =>
        b.addEventListener('click', async () => {
          input.value = '';
          await startAdd(b.dataset.pick!);
        }));
    } catch (err) {
      banner.textContent = `⚠ ${err instanceof Error ? err.message : err}`;
      showingResults = false;
      refresh();
    }
  });

  refresh();
  const poll = setInterval(refresh, 3000);
  // crude but fine for hackathon: stop polling when screen replaced
  const obs = new MutationObserver(() => { if (!root.contains(list)) { clearInterval(poll); obs.disconnect(); } });
  obs.observe(root, { childList: true });
}
