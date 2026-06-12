import { api } from '../api';
import { bestForMap } from '../scores';
import type { LibraryEntry, MapInfo } from '../types';
import { videoIdOf } from '../types';

const STAGE_LABEL: Record<string, string> = {
  queued: 'queued…',
  downloading: 'downloading audio',
  separating: 'separating stems',
  analyzing: 'analyzing beats',
  generating: 'generating beatmaps',
};
const STD_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
const STD_CLASS: Record<string, string> = { easy: 'easy', medium: 'medium', hard: 'hard' };

export interface LibraryHandlers {
  onPlay: (songId: string, key: string) => void;
  onEdit: (songId: string, name: string, baseKey: string | null) => void;
  onSettings: () => void;
}

export function renderLibrary(root: HTMLElement, h: LibraryHandlers): void {
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
  root.querySelector('#settings')!.addEventListener('click', h.onSettings);

  let showingResults = false;
  const expanded = new Set<string>();
  const activeJobs = new Map<string, string>();                       // jobId -> songId
  const failedJobs = new Map<string, { songId: string; error: string }>();
  let lastEntries: LibraryEntry[] = [];

  function sortedMaps(e: LibraryEntry): MapInfo[] {
    const maps = e.maps ?? e.difficulties.map(d => (
      { key: d, mode: 'standard' as const, notes: 0, holds: 0, generatorVersion: 0 }));
    return [...maps].sort((a, b) =>
      (a.mode === b.mode ? 0 : a.mode === 'standard' ? -1 : 1) ||
      (STD_ORDER[a.key] ?? 99) - (STD_ORDER[b.key] ?? 99) || a.key.localeCompare(b.key));
  }

  function mapRow(e: LibraryEntry, m: MapInfo): string {
    const best = bestForMap(e.songId, m.key, m.mode);
    const cls = m.mode === 'custom' ? 'medium' : (STD_CLASS[m.key] ?? 'medium');
    const label = m.mode === 'custom' ? `★ ${m.key}` : m.key.toUpperCase();
    return `<div class="map-row">
      <span class="chip ${cls}" style="cursor:default">${label}</span>
      <span class="grow" style="color:#9aa0b0;font-size:12.5px">
        ${m.notes ? `${m.notes} notes · ${m.holds} holds` : ''}
        ${m.mode === 'standard' && m.generatorVersion ? ` · gen v${m.generatorVersion}` : ''}
        ${best ? ` · best ${best.grade} ×${best.maxCombo}` : ''}
      </span>
      <button class="chip easy" data-play="${e.songId}|${m.key}">▶ play</button>
      <button class="chip medium" data-edit="${e.songId}|${m.key}|${m.mode}">✎ edit</button>
      ${m.mode === 'custom' ? `<button class="chip hard" data-delmap="${e.songId}|${m.key}">🗑</button>` : ''}
    </div>`;
  }

  function detailsPanel(e: LibraryEntry): string {
    const maps = sortedMaps(e).map(m => mapRow(e, m)).join('');
    return `<div class="song-details">
      <div class="map-list">${maps || '<div style="color:#777;padding:6px">no maps yet</div>'}</div>
      <div class="song-actions">
        <input id="nm-${videoIdOf(e.songId)}" placeholder="new map name…" style="flex:1">
        <select id="nb-${videoIdOf(e.songId)}">
          <option value="">blank</option>
          ${sortedMaps(e).map(m => `<option value="${m.key}">copy of ${m.key}</option>`).join('')}
        </select>
        <button class="chip easy" data-newmap="${e.songId}">＋ create</button>
        <span class="grow"></span>
        <button class="chip medium" data-remap="${e.songId}" title="re-analyze with the current generator">⟳ remap</button>
        <button class="chip hard" data-delete="${e.songId}" title="remove from library">✕ delete</button>
      </div>
    </div>`;
  }

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

  async function startAdd(videoId: string, force = false): Promise<void> {
    const r = await api.addSong(videoId, force);
    if (r.jobId) activeJobs.set(r.jobId, r.songId);
    showingResults = false;
    await refresh();
  }

  let lastRenderKey = '';
  function render(): void {
    // never yank the DOM out from under someone typing a map name (the poll re-renders)
    const ae = document.activeElement as HTMLElement | null;
    if (ae && list.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return;
    const entryHtml = lastEntries.map(e => {
      const status = e.status === 'ready'
        ? `<span style="color:#666;font-size:12px">${expanded.has(e.songId) ? '▾' : '▸'} ${sortedMaps(e).length} maps</span>`
        : e.status === 'error' ? `<span style="color:#ff5e7a">${e.error ?? 'failed'}</span> <button class="chip easy" data-retry="${e.songId}">retry</button>`
        : e.status === 'outdated' ? `<span style="color:#ffd166">map outdated</span> <button class="chip medium" data-retry="${e.songId}">remap</button> <span style="color:#666;font-size:12px">${expanded.has(e.songId) ? '▾' : '▸'}</span>`
        : `<span style="color:#4cc9f0">⚙ processing…</span>`;
      return `<div class="row song-row" data-song="${e.songId}" style="display:block">
        <div class="song-head" data-toggle="${e.songId}">
          <img src="${e.thumbnail}" alt="">
          <div class="grow">${e.title} <span style="color:#888">· ${e.channel} · ${Math.round(e.duration / 60)}:${String(Math.round(e.duration) % 60).padStart(2, '0')}${e.bpm ? ' · ' + Math.round(e.bpm) + ' BPM' : ''}</span></div>
          ${status}
        </div>
        ${expanded.has(e.songId) && (e.status === 'ready' || e.status === 'outdated') ? detailsPanel(e) : ''}
      </div>`;
    }).join('');
    const key = jobHtmlCache + entryHtml;
    if (key === lastRenderKey) return;     // identical content: keep the DOM (and its input state)
    lastRenderKey = key;
    renderInto(entryHtml);
  }

  let jobHtmlCache = '';
  function renderInto(entryHtml: string): void {
    list.innerHTML = (jobHtmlCache + entryHtml) || '<p style="padding:1rem;color:#888">No songs yet — search above to add one.</p>';
    wire();
  }

  function wire(): void {
    list.querySelectorAll<HTMLElement>('[data-toggle]').forEach(el =>
      el.addEventListener('click', ev => {
        if ((ev.target as HTMLElement).closest('button')) return;   // buttons act, not toggle
        const id = el.dataset.toggle!;
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        render();
      }));
    list.querySelectorAll<HTMLButtonElement>('[data-play]').forEach(b =>
      b.addEventListener('click', () => {
        const [songId, key] = b.dataset.play!.split('|');
        h.onPlay(songId, key);
      }));
    list.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(b =>
      b.addEventListener('click', () => {
        const [songId, key, mode] = b.dataset.edit!.split('|');
        if (mode === 'custom') h.onEdit(songId, key, key);
        else {
          const name = prompt('Name for your custom map (edits a copy):', `${key}-custom`);
          if (name) h.onEdit(songId, name, key);
        }
      }));
    list.querySelectorAll<HTMLButtonElement>('[data-delmap]').forEach(b =>
      b.addEventListener('click', async () => {
        const [songId, key] = b.dataset.delmap!.split('|');
        if (!confirm(`Delete custom map "${key}"?`)) return;
        await api.deleteCustom(songId, key);
        refresh();
      }));
    list.querySelectorAll<HTMLButtonElement>('[data-newmap]').forEach(b =>
      b.addEventListener('click', () => {
        const songId = b.dataset.newmap!;
        const vid = videoIdOf(songId);
        const name = (list.querySelector(`#nm-${vid}`) as HTMLInputElement)?.value.trim();
        const base = (list.querySelector(`#nb-${vid}`) as HTMLSelectElement)?.value || null;
        if (!name) { banner.textContent = '⚠ give the new map a name'; return; }
        h.onEdit(songId, name, base);
      }));
    list.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach(b =>
      b.addEventListener('click', () => startAdd(videoIdOf(b.dataset.retry!))));
    list.querySelectorAll<HTMLButtonElement>('[data-remap]').forEach(b =>
      b.addEventListener('click', () => startAdd(videoIdOf(b.dataset.remap!), true)));
    list.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Remove this song from the library? (Scores stay; remapping re-adds it.)')) return;
        await api.deleteSong(b.dataset.delete!);
        refresh();
      }));
    list.querySelectorAll<HTMLButtonElement>('[data-job-retry]').forEach(b =>
      b.addEventListener('click', () => {
        const f = failedJobs.get(b.dataset.jobRetry!);
        failedJobs.delete(b.dataset.jobRetry!);
        if (f) startAdd(videoIdOf(f.songId));
      }));
    list.querySelectorAll<HTMLButtonElement>('[data-job-dismiss]').forEach(b =>
      b.addEventListener('click', () => { failedJobs.delete(b.dataset.jobDismiss!); refresh(); }));
  }

  async function refresh(): Promise<void> {
    if (showingResults) return;
    jobHtmlCache = await jobRowsHtml();   // poll jobs first so a just-finished song shows as a real row
    try { lastEntries = await api.songs(); banner.textContent = ''; }
    catch { banner.textContent = '⚠ pipeline server offline (start it on laptop A / localhost:8000)'; }
    render();
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
