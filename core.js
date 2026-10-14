/* Suno EFSS — pure library parsing and normalization helpers (no network access). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SunoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function string(value) { return value == null ? '' : String(value); }
  function truthy(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return ['true', '1', 'yes', 'liked', 'on'].includes(string(value).trim().toLowerCase());
  }
  function toNumber(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      try { const arr = JSON.parse(value); if (Array.isArray(arr)) return arr; } catch (_) { /* CSV value */ }
      return value.split(/\s*[,;|]\s*/).filter(Boolean);
    }
    return [];
  }
  function unique(items) { return [...new Set(items.map(string).map(s => s.trim()).filter(Boolean))]; }
  function parseCsv(content) {
    const text = string(content).replace(/^\uFEFF/, '');
    const rows = []; let row = []; let current = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') { current += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { row.push(current); current = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(current); current = '';
        if (row.some(cell => cell.trim())) rows.push(row);
        row = [];
      } else current += ch;
    }
    if (quoted) throw new Error('CSV içinde kapanmamış tırnak bulundu.');
    row.push(current);
    if (row.some(cell => cell.trim())) rows.push(row);
    if (!rows.length) return [];
    const headings = rows.shift().map(x => x.trim());
    if (!headings.includes('id')) throw new Error('CSV içinde "id" sütunu yok.');
    return rows.map(values => Object.fromEntries(headings.map((heading, i) => [heading, values[i] || ''])));
  }
  function fromImport(json) {
    if (Array.isArray(json)) return { songs: json, workspaces: [], flags: {}, activity: [] };
    if (!json || typeof json !== 'object') throw new Error('Geçerli bir JSON dizi veya katalog bekleniyor.');
    if (['sunoEFSS-archive-v1', 'sunoEFSS-archive-v2'].includes(json.format) && Array.isArray(json.songs)) {
      return { songs: json.songs, workspaces: json.workspaces || [], flags: json.flags || {}, activity: json.activity || [], playlists: json.playlists || [], playlistMembers: json.playlistMembers || {} };
    }
    const songs = json.clips || json.songs || json.catalog || json.items || json.data;
    if (Array.isArray(songs)) return { songs, workspaces: json.workspaces || [], flags: {}, activity: [] };
    throw new Error('Şarkı listesi bulunamadı. catalog.json ya da CSV yükle.');
  }
  function uniqueSongs(songs) {
    const out = new Map();
    for (const candidate of songs) {
      if (!candidate || typeof candidate !== 'object') continue;
      const id = string(candidate.id || candidate.clip_id || candidate.clipId).trim();
      if (!id) continue;
      const row = { ...candidate, id };
      const existing = out.get(id);
      if (!existing) { out.set(id, row); continue; }
      const ws = unique([...toArray(existing._workspaces), ...toArray(row._workspaces)]);
      out.set(id, { ...existing, ...row, _workspaces: ws });
    }
    return [...out.values()];
  }
  function normalizeSong(song) {
    const meta = song.metadata && typeof song.metadata === 'object' ? song.metadata : {};
    const id = string(song.id || song.clip_id || song.clipId).trim();
    const mergedWorkspaces = unique([
      ...toArray(song._workspaces), ...toArray(song.workspaces),
      typeof song.project === 'string' ? song.project : song.project?.name,
      song.workspace_name,
    ]);
    const task = string(song.task || meta.task || song.type || meta.type);
    const stem = truthy(song.is_stem) || truthy(song.stem) || /stem/i.test(task) || !!meta.stem_from_id || !!song.stem_from_id;
    const referenceIds = unique([
      song.cover_clip_id, song.edited_clip_id, song.stem_from_id, song.upsample_clip_id,
      meta.cover_clip_id, meta.edited_clip_id, meta.stem_from_id, meta.upsample_clip_id,
      ...(Array.isArray(meta.history) ? meta.history.flatMap(x => [x?.id, x?.clip_id]) : []),
      ...(Array.isArray(song.clip_roots?.clips) ? song.clip_roots.clips.map(c => c.id || c.clip_id) : []),
    ]).filter(x => x !== id);
    const isRemix = truthy(song.is_remix) || /remix/i.test(task);
    const isCover = /cover/i.test(task) || !!meta.cover_clip_id || !!song.cover_clip_id;
    const liked = truthy(song.is_liked) || truthy(song.liked);
    const disliked = truthy(song.is_disliked) || truthy(song.disliked);
    const date = string(song.created_at || song.createdAt || song.date);
    return {
      id,
      title: string(song.title || song.name || 'Başlıksız eser'),
      date, timestamp: Number.isFinite(Date.parse(date)) ? Date.parse(date) : null,
      model: string(song.model_name || song.major_model_version || meta.model_name || meta.major_model_version),
      duration: toNumber(song.duration_s ?? song.duration ?? meta.duration),
      plays: toNumber(song.play_count ?? song.playCount ?? song.plays),
      liked, disliked, stem, isRemix, isCover,
      instrumental: truthy(song.instrumental) || truthy(meta.make_instrumental),
      workspaces: mergedWorkspaces,
      style: string(song.style_prompt || meta.tags || song.style),
      negativeStyle: string(song.negative_style || meta.negative_tags),
      prompt: string(song.description_prompt || meta.gpt_description_prompt || song.prompt),
      lyrics: string(song.lyrics || meta.prompt || ''),
      task, refs: referenceIds,
      image: string(song.image_large_url || song.image_url || song.cover_url),
      audio: string(song.audio_url || ''),
      link: `https://suno.com/song/${encodeURIComponent(id)}`,
      raw: song,
    };
  }
  // The archive never requests URLs itself: links become local references only.
  function parseSunoLink(value) {
    let url;
    try { url = new URL(string(value).trim()); } catch (_) { throw new Error('Geçerli bir Suno bağlantısı gir.'); }
    if (url.protocol !== 'https:' || !['suno.com','www.suno.com'].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password) {
      throw new Error('Yalnızca güvenli https://suno.com bağlantıları kabul ediliyor.');
    }
    const match = url.pathname.match(/^\/(song|s|playlist)\/([a-zA-Z0-9_-]+)\/?$/);
    if (!match) throw new Error('Desteklenen bağlantılar: /song/ID, /s/ID veya /playlist/ID.');
    const type = match[1] === 'playlist' ? 'playlist' : 'song';
    const id = match[2];
    return {type, id, url:`https://suno.com/${type === 'playlist' ? 'playlist' : 'song'}/${encodeURIComponent(id)}`};
  }
  function parseSongLines(value) {
    const lines = string(value).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const out = new Map();
    for (const line of lines) {
      const link = parseSunoLink(line);
      if (link.type !== 'song') throw new Error('Playlist eser listesine yalnızca şarkı bağlantıları eklenebilir.');
      out.set(link.id, link);
    }
    return [...out.values()];
  }
  function validPlaylists(data) {
    const out = new Map();
    for (const p of Array.isArray(data) ? data : []) {
      if (!p || typeof p !== 'object') continue;
      try {
        const link = parseSunoLink(p.url || `https://suno.com/playlist/${p.id || ''}`);
        if (link.type !== 'playlist') continue;
        out.set(link.id, {id:link.id, name:string(p.name || 'Başlıksız playlist').slice(0,150), url:link.url, addedAt:string(p.addedAt)});
      } catch (_) { /* invalid references are discarded */ }
    }
    return [...out.values()];
  }
  function validPlaylistMembers(data, playlists, ids) {
    const allowed = new Set(ids), playlistIds = new Set(playlists.map(p => p.id)), output = {};
    for (const [id, songIds] of Object.entries(data && typeof data === 'object' ? data : {})) {
      if (!playlistIds.has(id)) continue;
      output[id] = [...new Set(toArray(songIds).filter(songId => allowed.has(songId)))];
    }
    return output;
  }
  function validFlags(source, ids) {
    const allowed = new Set(ids);
    const output = {};
    for (const [id, flag] of Object.entries(source || {})) {
      if (!allowed.has(id) || !flag || typeof flag !== 'object') continue;
      const status = ['downloaded', 'missing', 'unknown'].includes(flag.status) ? flag.status : 'unknown';
      output[id] = { status, note: string(flag.note), updatedAt: string(flag.updatedAt), source: string(flag.source || 'manual') };
    }
    return output;
  }
  function csvEscape(v) {
    let s = string(v);
    // Prevent formula injection when user data is opened in Excel/Sheets.
    if (/^[\t\r\n ]*[=+\-@]/.test(s)) s = '\'' + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function flagsCsv(songs, flags, playlists = [], playlistMembers = {}) {
    const rows = [['id','title','created_at','model','workspaces','playlist_names','suno_link','download_status','source','updated_at','note']];
    for (const song of songs) {
      const n = normalizeSong(song), f = flags[n.id] || {};
      const names=playlists.filter(p => (playlistMembers[p.id] || []).includes(n.id)).map(p => p.name).join(' | ');
      rows.push([n.id,n.title,n.date,n.model,n.workspaces.join(' | '),names,n.link,f.status || 'unknown',f.source || '',f.updatedAt || '',f.note || '']);
    }
    return '\uFEFF' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
  }
  return { string, truthy, parseCsv, fromImport, uniqueSongs, normalizeSong, parseSunoLink, parseSongLines, validPlaylists, validPlaylistMembers, validFlags, flagsCsv };
});