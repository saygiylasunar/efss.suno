/* Suno EFSS — offline-first browser application. No Suno authentication, fetch or cookies. */
(function () {
  'use strict';
  const C = window.SunoCore;
  const $ = id => document.getElementById(id);
  const fmtNumber = new Intl.NumberFormat('tr-TR');
  const fmtDate = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' });
  const fmtMoment = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  const demoSongs = [
    {id:'example-01',title:'Münzevi — Prelude (örnek)',created_at:'2024-09-12T09:30:00Z',model_name:'v3.5',_workspaces:['Münzevi - Enstrümental'],play_count:204,metadata:{tags:'Ambient, melancholic, cinematic',prompt:'[Instrumental]','make_instrumental':true}},
    {id:'example-02',title:'Sır Taşım (örnek)',created_at:'2025-01-18T11:30:00Z',model_name:'v4',_workspaces:['Sır Taşım'],play_count:412,is_liked:true,metadata:{tags:'Dark folk, Anatolian, strings',prompt:'[Verse]\nBu metin sadece bir örnektir.'}},
    {id:'example-03',title:'Zarar — Version II (örnek)',created_at:'2025-07-23T19:20:00Z',model_name:'v4.5',_workspaces:['Zarar'],play_count:53,is_disliked:true,metadata:{tags:'Industrial rock, dramatic vocals',prompt:'Demo lyrics'}},
    {id:'example-04',title:'Zarar — Remix (örnek)',created_at:'2025-07-27T19:20:00Z',model_name:'v4.5',_workspaces:['Zarar','Zarar_XPort'],is_remix:true,play_count:812,metadata:{tags:'Electronic rock, energetic',type:'remix',cover_clip_id:'example-03',prompt:'Bu bir demo remix örneğidir.'}},
    {id:'example-05',title:'Öcü (örnek)',created_at:'2025-11-04T12:00:00Z',model_name:'v5',_workspaces:['Öcü'],play_count:166,is_liked:true,metadata:{tags:'Alternative Turkish rock, heavy guitar',prompt:'Demo şarkı sözü'}},
    {id:'example-06',title:'Kal(ı)p — Vocals Stem (örnek)',created_at:'2026-02-14T05:30:00Z',model_name:'v5',_workspaces:['Kal(ı)p'],play_count:14,metadata:{type:'stem',stem_from_id:'example-05',tags:'Vocal stem'}},
    {id:'example-07',title:'Sindim İçine (örnek)',created_at:'2026-05-30T18:45:00Z',model_name:'v5.5',_workspaces:['Sindim İçine'],play_count:127,metadata:{tags:'Dream pop, atmospheric',prompt:'Only sample metadata.'}},
    {id:'example-08',title:'Çuvukverse Theme (örnek)',created_at:'2026-10-12T19:45:00Z',model_name:'v6',_workspaces:['Cuvukverse'],play_count:9,metadata:{tags:'8-bit, chip tune, cinematic',prompt:'Demo title music'}}
  ];
  const demoWorkspaces = ['Münzevi - Enstrümental','Sır Taşım','Zarar','Zarar_XPort','Öcü','Kal(ı)p','Sindim İçine','Cuvukverse'].map(name=>({name}));
  let state = {songs:demoSongs, workspaces:demoWorkspaces, playlists:[], playlistMembers:{}, flags:{}, activity:[], demo:true};
  let songs = [], filtered = [], page = 1, selectedId = null, db = null, saveTimer = null;
  const pageSize = 60;
  const h = value => C.string(value).replace(/[&<>"']/g, c=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const labelStatus = s => ({ downloaded:'İndirildi', missing:'İndirilmedi', unknown:'Belirsiz' })[s] || 'Belirsiz';
  const songStatus = id => state.flags[id]?.status || 'unknown';
  const safeUrl = u => { try { const url = new URL(u); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch (_) { return ''; } };
  const safeImage = u => { const address = safeUrl(u); if (!address) return ''; try { const url = new URL(address); return (url.protocol === 'https:' && (url.hostname === 'suno.ai' || url.hostname.endsWith('.suno.ai') || url.hostname === 'suno.com')) ? address : ''; } catch (_) { return ''; } };
  const prettyDate = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? fmtDate.format(d) : 'Tarih yok'; };
  const fullDate = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? fmtMoment.format(d) : '—'; };
  const val = v => v === null || v === undefined || v === '' ? '—' : h(v);
  const cover = (song, cls) => { const url = safeImage(song.image); return `<div class="${cls}">${url ? `<img src="${h(url)}" referrerpolicy="no-referrer" loading="lazy" alt="" onerror="this.remove()">` : '♫'}</div>`; };
  function toast(message) { const e = $('toast'); e.textContent = message; e.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(()=>e.classList.remove('visible'),4300); }

  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open('suno-efss-archive',1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function readState() {
    if (!db) return Promise.resolve(null);
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('kv','readonly'), req=tx.objectStore('kv').get('library');
      req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error);
    });
  }
  function saveNow() {
    if (!db || state.demo) return;
    try { const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(state,'library'); tx.onerror=()=>toast('Yerel kayıt yazılamadı; JSON yedeği al.'); }
    catch(e){ console.error(e);toast('Arşiv kaydedilemedi. JSON yedeği al.'); }
  }
  function persist() { if (state.demo) return; clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,180); }
  function noteEvent(id, action, detail) { state.activity.push({id,action,detail,at:new Date().toISOString()}); if(state.activity.length>10000) state.activity=state.activity.slice(-10000); }
  function download(blob, filename) { const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000); }
  function exportBackup() {
    const payload = {format:'sunoEFSS-archive-v2',exportedAt:new Date().toISOString(),songs:state.songs,workspaces:state.workspaces,playlists:state.playlists||[],playlistMembers:state.playlistMembers||{},flags:state.flags,activity:state.activity};
    download(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`sunoEFSS-backup-${new Date().toISOString().slice(0,10)}.json`);
    toast('Tam arşiv yedeği oluşturuldu. Güvenli bir klasörde sakla.');
  }
  function exportCsv() { download(new Blob([C.flagsCsv(state.songs,state.flags,state.playlists||[],state.playlistMembers||{})],{type:'text/csv;charset=utf-8'}),`sunoEFSS-flags-${new Date().toISOString().slice(0,10)}.csv`);toast('CSV dışa aktarıldı.'); }
  function setFlag(id, status, source='manual', note=null) {
    if (state.demo) { toast('Demo modundasın: işaretleme sadece bu oturumda geçerli. Gerçek arşivi içe aktar.'); }
    if (!state.songs.some(s=>s.id===id)) return;
    const before=state.flags[id] || {status:'unknown',note:''};
    const next = {status,note:note===null?before.note:C.string(note),source,updatedAt:new Date().toISOString()};
    if (before.status===status && before.note===next.note) return;
    state.flags[id]=next;
    noteEvent(id,before.status===status?'note':'status',before.status===status?'Not güncellendi':`${labelStatus(before.status)} → ${labelStatus(status)} (${source})`);
    persist();render();if(selectedId===id)renderDetail(id);
  }
  function renderOptions(selectId, options, placeholder) {
    const node=$(selectId), current=node.value;
    node.replaceChildren();
    const add=(value,label)=>{const op=document.createElement('option');op.value=value;op.textContent=label;node.appendChild(op);};
    add('all',placeholder);options.forEach(x=>add(x,x));node.value=options.includes(current)?current:'all';
  }
  function refreshData() {
    songs=C.uniqueSongs(state.songs).map(C.normalizeSong);
    const model=[...new Set(songs.map(x=>x.model).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
    const ws=[...new Set([...songs.flatMap(x=>x.workspaces),...state.workspaces.map(x=>typeof x==='string'?x:x.name||x.title).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'tr'));
    renderOptions('modelFilter',model,'Tüm modeller');renderOptions('workspaceFilter',ws,'Bütün koleksiyonlar');
    const playlists = state.playlists || [];
    const playlistSelect = $('playlistFilter'), currentPlaylist = playlistSelect.value;
    playlistSelect.replaceChildren(new Option('Tüm playlistler','all'));
    for (const p of playlists) playlistSelect.add(new Option(p.name,p.id));
    playlistSelect.value = playlists.some(p=>p.id===currentPlaylist)?currentPlaylist:'all';
    renderPlaylistNav();
    const selection=$('workspaceFilter').value;
    const nav=$('workspaceNav'); nav.replaceChildren();
    for(const name of ws){
      const count=songs.filter(s=>s.workspaces.includes(name)).length;
      const btn=document.createElement('button');btn.type='button';btn.className='nav-item'+(selection===name?' active':'');btn.title=name;
      const icon=document.createElement('span');icon.textContent='♬';const title=document.createElement('span');title.className='ws-name';title.textContent=name;const badge=document.createElement('span');badge.className='nav-count';badge.textContent=count;
      btn.append(icon,title,badge);btn.addEventListener('click',()=>{$('workspaceFilter').value=name;$('statusFilter').value='all';page=1;render();});nav.append(btn);
    }
    render();
  }
  function renderPlaylistNav() {
    const nav=$('playlistNav');nav.replaceChildren();
    for(const pl of state.playlists||[]) {
      const btn=document.createElement('button');btn.type='button';btn.className='nav-item';btn.title=pl.name;
      const icon=document.createElement('span');icon.textContent='▤';const title=document.createElement('span');title.className='ws-name';title.textContent=pl.name;const count=document.createElement('span');count.className='nav-count';count.textContent=(state.playlistMembers?.[pl.id]||[]).length;
      btn.append(icon,title,count);btn.addEventListener('click',()=>{$('playlistFilter').value=pl.id;page=1;render();});
      const row=document.createElement('div');row.className='playlist-nav-row';
      const open=document.createElement('a');open.className='playlist-open';open.href=pl.url;open.target='_blank';open.rel='noopener noreferrer';open.textContent='↗';open.title=`Suno'da aç: ${pl.name}`;
      row.append(btn,open);nav.append(row);
    }
  }
  function matches(song) {
    const search=$('search').value.toLocaleLowerCase('tr-TR').trim();
    if(search && ![song.title,song.id,song.style,song.prompt,song.lyrics,song.model,...song.workspaces].some(text=>text.toLocaleLowerCase('tr-TR').includes(search))) return false;
    const status=$('statusFilter').value; if(status!=='all' && songStatus(song.id)!==status)return false;
    const kind=$('kindFilter').value;if(kind!=='all' && !({liked:song.liked,disliked:song.disliked,stem:song.stem,remix:song.isRemix,cover:song.isCover,instrumental:song.instrumental})[kind])return false;
    if($('modelFilter').value!=='all' && song.model!==$('modelFilter').value)return false;
    if($('workspaceFilter').value!=='all' && !song.workspaces.includes($('workspaceFilter').value))return false;
    const pf=$('playlistFilter').value; if(pf!=='all' && !(state.playlistMembers?.[pf]||[]).includes(song.id))return false;
    const from=$('dateFrom').value, to=$('dateTo').value;
    if(from && (song.timestamp===null || song.timestamp<Date.parse(from+'T00:00:00Z')))return false;
    if(to && (song.timestamp===null || song.timestamp>Date.parse(to+'T23:59:59Z')))return false;
    return true;
  }
  function statusControls(song) {
    const st=songStatus(song.id);
    return `<div class="flag-control"><button type="button" class="${st==='downloaded'?'selected downloaded':''}" data-flag="downloaded" data-id="${h(song.id)}" title="İndirdim">✓ İndirdim</button><button type="button" class="${st==='missing'?'selected missing':''}" data-flag="missing" data-id="${h(song.id)}" title="İndirmedim">✕</button><button type="button" class="${st==='unknown'?'selected':''}" data-flag="unknown" data-id="${h(song.id)}" title="Belirsiz">?</button></div>`;
  }
  function tags(song) { let t='';if(song.liked)t+='<span class="small-tag pink">♥ Liked</span>';if(song.disliked)t+='<span class="small-tag">Disliked</span>';if(song.stem)t+='<span class="small-tag mint">Stem</span>';if(song.isRemix)t+='<span class="small-tag">Remix</span>';if(song.isCover)t+='<span class="small-tag">Cover</span>';if(song.instrumental)t+='<span class="small-tag">Instrumental</span>';return t||'<span class="small-tag">Original</span>'; }
  function render() {
    $('demoPill').textContent=state.demo?'DEMO DATA':'LOCAL LIBRARY';$('demoPill').classList.toggle('real',!state.demo);
    $('statTotal').textContent=fmtNumber.format(songs.length);
    $('statDownloaded').textContent=fmtNumber.format(songs.filter(s=>songStatus(s.id)==='downloaded').length);
    $('statMissing').textContent=fmtNumber.format(songs.filter(s=>songStatus(s.id)==='missing').length);
    $('statUnknown').textContent=fmtNumber.format(songs.filter(s=>songStatus(s.id)==='unknown').length);
    $('sidebarCount').textContent=fmtNumber.format(songs.length);
    filtered=songs.filter(matches);
    const activePlaylist=(state.playlists||[]).find(p=>p.id===$('playlistFilter').value);
    const banner=$('playlistBanner');banner.hidden=!activePlaylist;
    if(activePlaylist)banner.innerHTML=`<div><strong>${h(activePlaylist.name)}</strong><small>Playlist ID: ${h(activePlaylist.id)} · ${(state.playlistMembers?.[activePlaylist.id]||[]).length} kayıt bağlandı</small></div><a href="${h(activePlaylist.url)}" target="_blank" rel="noopener noreferrer">↗ Suno'da aç</a>`;
    const sort=$('sort').value;
    filtered.sort((a,b)=>{
      if(sort==='title') return a.title.localeCompare(b.title,'tr');
      if(sort==='plays') return (b.plays??-1)-(a.plays??-1);
      const da=a.timestamp,db=b.timestamp;if(da===null)return db===null?0:1;if(db===null)return -1;
      return sort==='oldest'?da-db:db-da;
    });
    $('filteredCount').textContent=`${fmtNumber.format(filtered.length)} eser`;
    const maxPage=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.max(1,Math.min(page,maxPage));
    const data=filtered.slice((page-1)*pageSize,page*pageSize);
    $('trackRows').innerHTML=data.map(song=>`<tr data-id="${h(song.id)}" tabindex="0" aria-label="${h(song.title)} ayrıntılarını göster"><td><div class="track-info">${cover(song,'cover')}<div><div class="track-title" title="${h(song.title)}">${h(song.title)}</div><div class="track-sub">${h(song.workspaces.join(', ')||'Koleksiyon belirtilmedi')}</div></div></div></td><td>${h(prettyDate(song.date))}</td><td>${song.model?`<span class="model-tag">${h(song.model)}</span>`:'—'}</td><td>${tags(song)}</td><td>${statusControls(song)}</td><td><span class="open-arrow">›</span></td></tr>`).join('');
    $('empty').hidden=filtered.length>0;
    $('pagingInfo').textContent=filtered.length?`${fmtNumber.format((page-1)*pageSize+1)}–${fmtNumber.format(Math.min(page*pageSize,filtered.length))} / ${fmtNumber.format(filtered.length)} eser`:'0 eser';
    $('pageDisplay').textContent=`${page} / ${maxPage}`;$('prevPage').disabled=page<=1;$('nextPage').disabled=page>=maxPage;
    $('workspaceNav').querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.title===$('workspaceFilter').value));
    $('playlistNav').querySelectorAll('.nav-item').forEach((b,i)=>b.classList.toggle('active',(state.playlists||[])[i]?.id===$('playlistFilter').value));
    $('resetNav').classList.toggle('active',$('statusFilter').value==='all' && $('workspaceFilter').value==='all');
  }
  function metaTile(label,value){return `<div class="meta-tile"><small>${h(label)}</small><strong>${val(value)}</strong></div>`;}
  function detailLink(url,label) {const href=safeUrl(url);return href?`<a href="${h(href)}" target="_blank" rel="noopener noreferrer">↗ ${h(label)}</a>`:'';}
  function renderDetail(id) {
    const song=songs.find(x=>x.id===id);if(!song)return;
    const st=songStatus(song.id),flag=state.flags[song.id]||{};
    const assignedPlaylists=(state.playlists||[]).filter(p=>(state.playlistMembers?.[p.id]||[]).includes(song.id));
    const sourceRefs=song.refs.map(ref=>{
      const original=songs.find(s=>s.id===ref);
      return detailLink(`https://suno.com/song/${encodeURIComponent(ref)}`,`${original?'↳ '+original.title+' — ':''}Orijinal / ilişkili eser: ${ref}`);
    }).join('');
    const raw=JSON.stringify(song.raw,null,2);
    const eventHistory=state.activity.filter(e=>e.id===id).slice(-20).reverse();
    $('detailBody').innerHTML=`<div class="detail-art">${cover(song,'detail-cover')}<div><div class="detail-title">${h(song.title)}</div><div class="detail-id">${h(song.id)}</div></div></div>
      <div class="detail-actions"><button type="button" data-detail-status="downloaded" class="${st==='downloaded'?'active downloaded':''}">✓ İndirdim</button><button type="button" data-detail-status="missing" class="${st==='missing'?'active missing':''}">✕ İndirmedim</button><button type="button" data-detail-status="unknown" class="${st==='unknown'?'active':''}">? Belirsiz</button></div>
      <div class="detail-section"><a href="${h(song.link)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">↗ Suno’da Aç / Resmî Download</a></div>
      <div class="detail-section"><h3>Metadata / Özellikler</h3><div class="meta-grid">${metaTile('Oluşturulma',fullDate(song.date))}${metaTile('Model',song.model)}${metaTile('Dinlenme',song.plays===null?'—':fmtNumber.format(song.plays))}${metaTile('Süre',song.duration===null?'—':`${Math.floor(song.duration/60)}:${String(Math.floor(song.duration%60)).padStart(2,'0')}`)}${metaTile('Koleksiyonlar',song.workspaces.join(', '))}${metaTile('Playlistler',assignedPlaylists.map(p=>p.name).join(', '))}${metaTile('İşlem / Type',song.task||'Original')}${metaTile('Beğeni',song.liked?'Liked':song.disliked?'Disliked':'—')}${metaTile('Özellikler',[song.stem?'Stem':'',song.isRemix?'Remix':'',song.isCover?'Cover':'',song.instrumental?'Instrumental':''].filter(Boolean).join(', '))}${metaTile('Son işaretleme',flag.updatedAt?fullDate(flag.updatedAt):'—')}${metaTile('Durum kaynağı',flag.source||'—')}</div></div>
      <div class="detail-section"><h3>Style of Music</h3><div class="text-panel">${val(song.style)}</div></div>
      ${song.negativeStyle?`<div class="detail-section"><h3>Excluded Styles</h3><div class="text-panel">${h(song.negativeStyle)}</div></div>`:''}
      <div class="detail-section"><h3>Prompt / Description</h3><div class="text-panel">${val(song.prompt)}</div></div>
      <div class="detail-section"><h3>Lyrics</h3><div class="text-panel">${val(song.lyrics)}</div></div>
      <div class="detail-section"><h3>Bağlantılar ve köken</h3><div class="detail-links">${detailLink(song.link,'Suno eser sayfasını aç')}${assignedPlaylists.map(p=>detailLink(p.url,`Playlist: ${p.name}`)).join('')}${sourceRefs||'<div class="text-panel">İlişkili orijinal parça bilgisi bulunamadı.</div>'}</div></div>
      <div class="detail-section"><h3>Playlist üyelikleri</h3>${(state.playlists||[]).length ? `<div class="playlist-members">${(state.playlists||[]).map(p=>`<label class="playlist-check"><input type="checkbox" data-toggle-playlist="${h(p.id)}" ${(state.playlistMembers?.[p.id]||[]).includes(song.id)?'checked':''} /> ${h(p.name)}</label>`).join('')}</div>` : '<div class="text-panel">Henüz playlist kaydetmedin. Üstteki “Link ekle” butonuyla ekleyebilirsin.</div>'}</div>
      <div class="detail-section"><h3>Arşiv notu</h3><textarea id="detailNote" class="note-box" placeholder="İndirme yeri, versiyon notu, yapılacaklar..." maxlength="2000">${h(flag.note||'')}</textarea><button type="button" class="btn btn-soft" id="saveNote" style="margin-top:9px">Notu kaydet</button></div>
      <div class="detail-section"><h3>İşlem geçmişi (${eventHistory.length})</h3>${eventHistory.length?eventHistory.map(event=>`<div class="activity-row">${h(event.detail)}<time>${h(fullDate(event.at))}</time></div>`).join(''):'<div class="text-panel">Bu esere ait işlem kaydı yok.</div>'}</div>
      <div class="detail-section"><h3>Raw metadata</h3><details><summary style="cursor:pointer;font-size:12px;color:#c4afe3">Ham JSON alanlarını görüntüle</summary><div class="text-panel" style="margin-top:10px;font-size:10px">${h(raw)}</div></details></div>`;
    $('detailBody').querySelectorAll('[data-detail-status]').forEach(b=>b.addEventListener('click',()=>setFlag(id,b.dataset.detailStatus)));
    $('saveNote').addEventListener('click',()=>setFlag(id,songStatus(id),'manual',$('detailNote').value));
    $('detailBody').querySelectorAll('[data-toggle-playlist]').forEach(input=>input.addEventListener('change',()=>togglePlaylistMember(input.dataset.togglePlaylist,id,input.checked)));
  }
  function openDetail(id) {selectedId=id;renderDetail(id);$('detail').hidden=false;$('overlay').hidden=false;$('closeDetail').focus();}
  function closeDetail() {selectedId=null;$('detail').hidden=true;$('overlay').hidden=true;}
  function resetFilters() { $('search').value='';$('statusFilter').value='all';$('kindFilter').value='all';$('modelFilter').value='all';$('workspaceFilter').value='all';$('playlistFilter').value='all';$('dateFrom').value='';$('dateTo').value='';$('sort').value='newest';page=1;render(); }
  window.SunoEFSSImport = importCatalog;
  async function importCatalog(file) {
    if(!file)return;
    try {
      const raw=await file.text();let imported;
      if(file.name.toLowerCase().endsWith('.csv'))imported={songs:C.parseCsv(raw),workspaces:[],flags:{},activity:[]};
      else imported=C.fromImport(JSON.parse(raw));
      const restore=raw.includes('"format"') && file.name.endsWith('.json') && (()=>{try{return ['sunoEFSS-archive-v1','sunoEFSS-archive-v2'].includes(JSON.parse(raw).format)}catch(_){return false}})();
      const existing=(state.demo||restore)?[]:state.songs;
      const merged=C.uniqueSongs([...existing,...imported.songs]);
      if(!merged.length && !(restore && (imported.playlists||[]).length))throw new Error('İçe aktarılabilir eser veya playlist bulunamadı.');
      const oldFlags=(state.demo||restore)?{}:state.flags;
      const pls=C.validPlaylists(restore?imported.playlists:[...(state.demo?[]:state.playlists||[]),...(imported.playlists||[])]);
      const memberSource=restore?imported.playlistMembers:{...(state.demo?{}:state.playlistMembers||{}),...(imported.playlistMembers||{})};
      state={songs:merged,workspaces:restore?imported.workspaces:[...(state.demo?[]:state.workspaces),...imported.workspaces],playlists:pls,playlistMembers:C.validPlaylistMembers(memberSource,pls,merged.map(s=>s.id)),flags:C.validFlags({...oldFlags,...imported.flags},merged.map(s=>s.id)),activity:restore?imported.activity:(state.demo?[]:state.activity),demo:false};
      if(restore){state.activity=Array.isArray(state.activity)?state.activity:[];}
      page=1;resetFilters();refreshData();saveNow();toast(`${fmtNumber.format(merged.length)} tekil eser kataloğa alındı. Tarayıcıya kaydedildi.`);
    } catch(err){console.error(err);toast(`İçe aktarma hatası: ${err.message}`);}
    finally{ $('catalogInput').value=''; }
  }
  async function importWorkspaces(file) {
    if(!file)return;
    try {
      const data=JSON.parse(await file.text());const list=Array.isArray(data)?data:data.workspaces||data.projects;
      if(!Array.isArray(list))throw new Error('Workspace listesi bulunamadı.');
      state.workspaces=[...(state.demo?[]:state.workspaces),...list].filter(Boolean);
      if(!state.demo){refreshData();persist();}else{refreshData();toast('Örnekler açık. Önce gerçek katalog dosyasını yükle.');return;}
      toast(`${list.length} çalışma alanı içe aktarıldı.`);
    }catch(err){toast(`Workspace hatası: ${err.message}`)}finally{$('workspaceInput').value='';}
  }
  async function scanFolder(fileList) {
    if(!fileList || !fileList.length)return;
    const extensions=/\.(wav|mp3|flac|m4a|aiff|ogg)$/i;
    const files=Array.from(fileList).filter(f=>extensions.test(f.name));
    const matches=[];
    for(const song of songs){
      if(song.id.length<8)continue;
      const needle=song.id.toLowerCase();const prefix=needle.slice(0,8);
      const match=files.find(f=>{const name=f.name.toLowerCase();return name.includes(needle)||name.includes(prefix);});
      if(match)matches.push({id:song.id,path:match.webkitRelativePath||match.name});
    }
    if(!matches.length){toast(`${files.length} ses dosyası tarandı; dosya adında Suno ID eşleşmesi bulunamadı.`);return;}
    const fresh=matches.filter(m=>songStatus(m.id)!=='downloaded');
    if(!confirm(`${files.length} ses dosyasından ${matches.length} Suno ID eşleşti. ${fresh.length} eseri “İndirildi” işaretle?\n\nDosyalar okunmaz/yüklenmez; yalnızca isimleri karşılaştırılır.`))return;
    for(const m of fresh){const previous=state.flags[m.id]||{};state.flags[m.id]={status:'downloaded',note:previous.note||'',source:'filename-scan',updatedAt:new Date().toISOString()};noteEvent(m.id,'scan',`Dosya adı eşleşti: ${m.path}`);}
    persist();render();toast(`${fresh.length} eser indirilmiş olarak işaretlendi (${matches.length} dosya eşleşmesi).`);
  }
  function initializeRealLibrary() {
    if (state.demo) state={songs:[],workspaces:[],playlists:[],playlistMembers:{},flags:{},activity:[],demo:false};
  }
  function ensureSong(link, title) {
    if(!state.songs.some(x=>x.id===link.id)) {
      state.songs.push({id:link.id,title:title||`Suno · ${link.id.slice(0,8)}`,created_at:'',_source:'link-only',_source_url:link.url});
    } else if(title) {
      const item=state.songs.find(x=>x.id===link.id);
      if(item._source==='link-only')item.title=title;
    }
  }
  function togglePlaylistMember(playlistId, songId, checked) {
    if(!(state.playlists||[]).some(p=>p.id===playlistId) || !state.songs.some(s=>s.id===songId))return;
    const existing=new Set(state.playlistMembers[playlistId]||[]);
    if(checked)existing.add(songId);else existing.delete(songId);
    state.playlistMembers[playlistId]=[...existing];
    noteEvent(songId,'playlist',`${checked?'Playliste eklendi':'Playlistten çıkarıldı'}: ${state.playlists.find(p=>p.id===playlistId).name}`);
    persist();renderPlaylistNav();render();if(selectedId===songId)renderDetail(songId);
  }
  function openLinkDialog() {
    $('linkForm').reset();
    const select=$('linkPlaylistSelect');select.replaceChildren(new Option('Playlist yok',''));
    for (const pl of state.playlists||[])select.add(new Option(pl.name,pl.id));
    updateLinkDialog();$('linkDialog').showModal();$('linkUrl').focus();
  }
  function updateLinkDialog() {
    let type=null;
    try { type=C.parseSunoLink($('linkUrl').value).type; } catch (_) { /* incomplete URL */ }
    $('linkTypeInfo').textContent=type==='playlist'?'✓ Playlist bağlantısı':type==='song'?'✓ Tekil eser bağlantısı':'Desteklenen: /song/ID, /s/ID, /playlist/ID';
    $('playlistSongLinks').hidden=type!=='playlist';
    $('songPlaylistSelector').hidden=type==='playlist';
  }
  function saveLinkFromDialog(event) {
    event.preventDefault();
    try {
      const link=C.parseSunoLink($('linkUrl').value);
      const title=$('linkTitle').value.trim();
      // Validate everything before modifying the user's current archive.
      const childLinks=link.type==='playlist'?C.parseSongLines($('playlistSongUrls').value):[];
      const selectedPlaylist=$('linkPlaylistSelect').value;
      if(link.type==='song' && selectedPlaylist && !(state.playlists||[]).some(p=>p.id===selectedPlaylist))throw new Error('Seçilen playlist artık mevcut değil.');
      initializeRealLibrary();
      if(link.type==='song'){
        ensureSong(link,title);
        if(selectedPlaylist){const members=new Set(state.playlistMembers[selectedPlaylist]||[]);members.add(link.id);state.playlistMembers[selectedPlaylist]=[...members];}
        noteEvent(link.id,'link','Tekil Suno bağlantısı kaydedildi');
        toast('Tekil eser bağlantısı kaydedildi. Metadata henüz alınmadı.');
      }else{
        if(!(state.playlists||[]).some(p=>p.id===link.id))state.playlists.push({id:link.id,name:title||`Playlist · ${link.id.slice(0,8)}`,url:link.url,addedAt:new Date().toISOString()});
        else if(title)state.playlists.find(p=>p.id===link.id).name=title;
        const members=new Set(state.playlistMembers[link.id]||[]);
        for(const child of childLinks){ensureSong(child,'');members.add(child.id);noteEvent(child.id,'playlist',`Bağlantıdan ilişkilendirildi: ${link.id}`);}
        state.playlistMembers[link.id]=[...members];
        toast(`Playlist bağlantısı kaydedildi; ${childLinks.length} eser linki ilişkilendirildi. İçerik otomatik çekilmedi.`);
      }
      $('linkDialog').close();page=1;refreshData();saveNow();
    }catch(err){toast(`Bağlantı hatası: ${err.message}`);}
  }
  function wireEvents(){
    $('catalogInput').addEventListener('change',e=>importCatalog(e.target.files?.[0]));
    $('workspaceInput').addEventListener('change',e=>importWorkspaces(e.target.files?.[0]));
    $('audioFolder').addEventListener('change',e=>{scanFolder(e.target.files);e.target.value='';});
    $('exportBackup').addEventListener('click',exportBackup);$('exportFlags').addEventListener('click',exportCsv);
    for(const id of ['search','statusFilter','kindFilter','modelFilter','workspaceFilter','playlistFilter','sort','dateFrom','dateTo']){
      $(id).addEventListener(id==='search'?'input':'change',()=>{page=1;render();});
    }
    $('openNextDownload').addEventListener('click',()=>{
      const next=filtered.find(x=>songStatus(x.id)!=='downloaded');
      if(!next){toast('Filtrede indirilecek başka eser bulunamadı.');return;}
      openDetail(next.id);
      window.open(next.link, '_blank', 'noopener,noreferrer');
      toast('Suno resmi Download menüsünden indir ve sonra bu eseri işaretle: '+next.title);
    });
    $('clearFilters').addEventListener('click',resetFilters);
    $('resetNav').addEventListener('click',resetFilters);
    $('showMissing').addEventListener('click',()=>{$('statusFilter').value='missing';$('workspaceFilter').value='all';page=1;render();});
    $('showDownloaded').addEventListener('click',()=>{$('statusFilter').value='downloaded';$('workspaceFilter').value='all';page=1;render();});
    $('prevPage').addEventListener('click',()=>{page--;render();});$('nextPage').addEventListener('click',()=>{page++;render();});
    $('trackRows').addEventListener('click',e=>{const flag=e.target.closest('[data-flag]');if(flag){e.stopPropagation();setFlag(flag.dataset.id,flag.dataset.flag);return;}const row=e.target.closest('tr[data-id]');if(row)openDetail(row.dataset.id);});
    $('trackRows').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ') && e.target.matches('tr[data-id]')){e.preventDefault();openDetail(e.target.dataset.id);}});
    $('closeDetail').addEventListener('click',closeDetail);$('overlay').addEventListener('click',closeDetail);
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && selectedId)closeDetail();});
    $('openGuide').addEventListener('click',()=>$('guideDialog').showModal());$('closeGuide').addEventListener('click',()=>$('guideDialog').close());$('doneGuide').addEventListener('click',()=>$('guideDialog').close());
    $('emptyImport').addEventListener('click',()=>$('catalogInput').click());
    $('openLinkDialog').addEventListener('click',openLinkDialog);
    $('closeLinkDialog').addEventListener('click',()=>$('linkDialog').close());
    $('linkUrl').addEventListener('input',updateLinkDialog);
    $('linkForm').addEventListener('submit',saveLinkFromDialog);
    window.addEventListener('pagehide',()=>{if(saveTimer){clearTimeout(saveTimer);saveNow();}});
  }
  async function boot(){
    wireEvents();
    try{db=await openDatabase();const saved=await readState();if(saved?.songs && Array.isArray(saved.songs)){state={...saved,playlists:C.validPlaylists(saved.playlists),playlistMembers:saved.playlistMembers||{},demo:false};}}
    catch(error){console.error(error);toast('IndexedDB kullanılamıyor. JSON yedeğini düzenli indir.');}
    refreshData();
    if(state.demo)toast('8 örnek eser gösteriliyor. Gerçek katalog için “Katalog ekle”yi kullan.');
  }
  boot();
})();