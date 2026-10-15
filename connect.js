/* EFSS Suno — optional local collector UI. No credentials stored in browser storage. */
(function () {
  'use strict';
  const bar = document.querySelector('.top-actions');
  if (!bar) return;
  const button = document.createElement('button');
  button.className = 'btn btn-soft';
  button.type = 'button';
  button.textContent = '⇄ Oturumlar / Suno';
  bar.prepend(button);

  const dialog = document.createElement('dialog');
  dialog.id = 'collectorDialog';
  dialog.className = 'link-dialog';
  dialog.innerHTML = `<div class="dialog-head"><h2>⇄ Suno Oturumları &amp; Senkronizasyon</h2><button type="button" class="close-btn" id="collectorClose">✕</button></div>
  <div class="guide-body">
   <p><strong>Yerel oturum:</strong> Terminalde <code>py collector.py</code> çalışmalı. Vivaldi'deki Suno oturumu <code>localhost</code>'a otomatik taşınmaz. Collector bir adet aktif oturumu RAM'de tutar; uygulama kapandığında bağlantı kaybolur.</p>
   <details class="session-steps" open><summary><strong>Oturumu nereden bulurum? — Vivaldi</strong></summary>
   <ol><li><a href="https://suno.com" target="_blank" rel="noopener noreferrer">Suno'ya git</a> ve kendi hesabınla giriş yap.</li>
   <li>Suno sekmesinde <kbd>F12</kbd> → <b>Application / Uygulama</b> → <b>Cookies / Çerezler</b>.</li>
   <li><code>https://auth.suno.com</code> veya <code>https://clerk.suno.com</code> altında <code>__client</code> isimli satırın <b>Value</b> değerini bul.</li>
   <li>Değeri yalnızca alttaki <b>Oturumu bağla</b> alanına yapıştır. ChatGPT'ye, GitHub'a veya başka bir kişiye gönderme.</li></ol>
   <p class="help-caption"><b>Güvenlik:</b> __client bir parolaya eşdeğerdir. Yerel Collector kaynak koduna güvenmiyorsan bağlama. <b>Oturumu kapat</b> yalnızca Collector bağlantısını keser; Suno web oturumunu kapatmaz.</p>
   </details>
   <div id="collectorStatus" class="text-panel" role="status">Bağlantı kontrol ediliyor…</div>
   <label class="field-label">Suno <code>__client</code> çerezi (yalnız yerel uygulamaya)
     <input type="password" id="collectorCookie" autocomplete="off" placeholder="Tarayıcı → Developer Tools → Application → Cookies" />
   </label>
   <button class="btn btn-outline" type="button" id="collectorConnect">Oturumu bağla</button>
   <button class="btn btn-outline" type="button" id="collectorDisconnect">Oturumu kapat</button>
   <label class="field-label">İsteğe bağlı playlist URL'leri (satır başına 1)
     <textarea id="collectorPlaylistUrls" rows="3" placeholder="https://suno.com/playlist/e4fc5b93-d19b-4ce0-ae4a-668b7c059187"></textarea>
   </label>
   <button class="btn btn-primary full" type="button" id="collectorSync">Tüm Library + Workspace + Playlist'leri Tara</button>
   <button class="btn btn-outline full" type="button" id="collectorImport">Toplanan kataloğu arşive aktar</button>
   <hr><h3>↓ Yerel MP3 / WAV dışa aktarımı</h3>
   <p class="help-caption">İndirme başarısızlıklarını 250 eser boyunca tekrarlamamak için kaynak ön kontrolü ve durdurma eklendi. Suno oynatma bağlantıları yetkili indirme bağlantısı anlamına gelmez; izinli formatları resmî Suno İndir menüsünde kontrol et.</p>
   <label class="field-label">Format <select id="collectorFormat"><option value="mp3">MP3</option><option value="wav">WAV</option></select></label>
   <button class="btn btn-outline full" type="button" id="collectorBatch">Filtredeki ilk 250 eksik eseri indir (ön denetimli)</button>
   <button class="btn btn-outline full" type="button" id="collectorStop" disabled>■ İndirmeyi durdur</button>
   <button class="btn btn-outline full" type="button" id="collectorInspectMedia">♫ Medya alanlarını denetle (MP3/M4A/WAV/MP4)</button>
   <div class="text-panel" id="collectorMediaResult">Yalnızca katalogdaki alanları ve kaynak alan adlarını gösterir; dosya indirmez.</div>
   <div class="text-panel" id="collectorDownloadStatus">Henüz indirme yapılmadı.</div>
  </div>`;
  document.body.appendChild(dialog);
  const $ = id => document.getElementById(id);
  let timer = null;
  let canConnect = false;
  let latestCompleted = '';
  function setSessionUI(mode) {
    const badge = $('sessionBadge');
    const footer = $('sessionFooter');
    const captions = {
      online: ['Bağlı', 'Suno oturumu RAM içinde bağlı'],
      disconnected: ['Bağlı değil', 'Collector açık · Suno oturumu bekleniyor'],
      offline: ['Çevrimdışı', 'Collector kapalı · py collector.py çalıştır']
    };
    const [short, full] = captions[mode] || captions.offline;
    if (badge) badge.textContent = short;
    if (footer) footer.textContent = full;
    button.textContent = mode === 'online' ? '● Suno Bağlı' : '⇄ Oturumlar / Suno';
    button.setAttribute('aria-label', 'Suno oturumlarını ve Collector bağlantısını yönet');
  }
  function say(message) { $('collectorStatus').textContent = message; }
  async function api(path, method = 'GET', body) {
    const response = await fetch(path, {method, headers: body ? {'Content-Type':'application/json'} : {},
                                      body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  async function status() {
    try {
      const current = await api('/api/status');
      canConnect = true;
      setSessionUI(current.connected ? 'online' : 'disconnected');
      $('collectorConnect').disabled = false;
      $('collectorDisconnect').disabled = !current.connected;
      const p = current.progress || {};
      let msg = `Yerel sunucu çalışıyor · Oturum: ${current.connected ? 'Bağlı' : 'Bağlı değil'} · Katalog: ${current.catalogCount} eser`;
      if (current.syncing) msg += ` · Tarama: ${p.stage || '?'} — ${p.count || 0} eser, sayfa ${p.page || 0}`;
      if (current.lastSyncedAt) msg += ` · Son: ${new Date(current.lastSyncedAt).toLocaleString('tr-TR')}`;
      if (current.error) msg += ` · HATA: ${current.error}`;
      say(msg);
      $('collectorSync').disabled = !current.connected || current.syncing;
      $('collectorImport').disabled = !current.catalogCount;
      $('collectorBatch').disabled = !current.connected || !current.catalogCount || current.downloadBusy || current.syncing;
      $('collectorStop').disabled = !current.downloadBusy;
      const skipped = current.downloadProgress?.skipped || 0;
      const progress=current.downloadProgress||{};
      const last=(progress.errors||[]).slice(-2).map(x=>x.id.slice(0,8)+': '+x.error).join(' · ');
      $('collectorDownloadStatus').textContent=`${progress.stage||'Hazır'} · ${progress.done||0}/${progress.total||0} · Hata ${progress.failed||0} · Ön denetimde atlanan ${skipped} · ${progress.current||''} ${last}`;
      const fingerprint=[progress.stage,progress.done,progress.total,progress.failed].join(':');
      if (!current.downloadBusy && progress.done && latestCompleted !== fingerprint) {
        latestCompleted=fingerprint;
        await applyManifest();
      }
    } catch (_) {
      canConnect = false;
      setSessionUI('offline');
      $('collectorConnect').disabled = true;
      $('collectorDisconnect').disabled = true;
      say('Collector çevrimdışı. Terminalde “python collector.py” çalıştır ve sayfayı http://localhost:8080 üzerinden aç. Normal http.server veya dosya:// modunda Suno bağlantısı yok.');
      $('collectorSync').disabled = true;
      $('collectorImport').disabled = true;
      $('collectorBatch').disabled = true;
      $('collectorStop').disabled = true;
    }
  }
  async function manifest(){return api('/api/downloads');}
  async function applyManifest() {
    try {window.SunoEFSSApplyManifest?.((await manifest()).files||{});}catch(_){/* offline */}
  }
  async function formatLabels() {
    const box=document.getElementById('efssFormatStatus');
    const btn=document.querySelector('[data-efss-download][data-song-id]');
    if (!box||!btn)return;
    try {
      const files=(await manifest()).files?.[btn.dataset.songId]||{};
      box.textContent=['mp3','wav'].map(fmt=>files[fmt]?
        fmt.toUpperCase()+': ✓ '+files[fmt].bytes+' B · SHA-256 '+files[fmt].sha256.slice(0,12)+'…':
        fmt.toUpperCase()+': indirilmedi').join('   |   ');
    }catch(_){box.textContent='Collector bağlantısı yok; bu bilgi alınamadı.';}
  }
  async function queue(ids,fmt){
    if(!ids.length)throw Error('İndirilecek kayıt yok. Önce Suno kataloğunu içe aktar.');
    if(!confirm(ids.length+' eser için '+fmt.toUpperCase()+' indirilsin mi? Suno kotanı etkileyebilir.'))return;
    await api('/api/download','POST',{ids,format:fmt});await status();
  }
  document.addEventListener('click',async e=>{
    const btn=e.target.closest?.('[data-efss-download][data-song-id]');
    if(!btn)return;
    if(!/^[a-f0-9-]{36}$/i.test(btn.dataset.songId)){alert('Önce gerçek Suno eserini içe aktar.');return;}
    try {await queue([btn.dataset.songId],btn.dataset.efssDownload);}catch(error){alert('İndirme başlatılamadı: '+error.message);}
  });
  new MutationObserver(()=>{if(document.getElementById('efssFormatStatus'))formatLabels();})
    .observe(document.getElementById('detailBody'),{childList:true});
  $('collectorStop').addEventListener('click', async () => {
    try {
      const result = await api('/api/download/stop', 'POST', {});
      $('collectorDownloadStatus').textContent = result.message || 'Durdurma istendi.';
      await status();
    } catch (error) {say('İndirmeyi durdurma hatası: '+error.message);}
  });
  $('collectorInspectMedia').addEventListener('click', async () => {
    try {
      const report = await api('/api/media-inventory');
      const rows = Object.entries(report.formats).map(([fmt,item]) => {
        const hosts = Object.entries(item.hosts).map(([host,num])=>host+' ('+num+')').join(', ') || '—';
        return fmt.toUpperCase() + ': ' + item.present + ' kayıtta · host: ' + hosts;
      });
      $('collectorMediaResult').textContent = 'Toplam '+report.totalSongs+' eser. '+rows.join(' | ')+'\nNot: Bu dosya alanları indirme izni anlamına gelmez.';
    } catch (error) {$('collectorMediaResult').textContent = 'Tanılama hatası: '+error.message;}
  });
  $('collectorBatch').addEventListener('click',async()=>{
    try{
      const fmt=$('collectorFormat').value;
      const files=(await manifest()).files||{};
      const ids=(window.SunoEFSSFilteredIds?.()||[]).filter(id=>!files[id]?.[fmt]).slice(0,250);
      await queue(ids,fmt);
    }catch(error){say('Kuyruk başlatılamadı: '+error.message);}
  });
  function open() {if (!dialog.open) dialog.showModal(); status(); if (timer) window.clearInterval(timer); timer = window.setInterval(status, 2400);}
  function close() {dialog.close(); window.clearInterval(timer); timer = null; $('collectorCookie').value = '';}
  button.addEventListener('click', open);
  $('openSessionPanel')?.addEventListener('click', open);
  status(); // Sidebar status is visible without opening the modal.
  $('collectorClose').addEventListener('click', close);
  dialog.addEventListener('close', () => {if (timer) window.clearInterval(timer); timer = null; $('collectorCookie').value='';});
  $('collectorConnect').addEventListener('click', async () => {
    if (!canConnect) return status();
    const cookie = $('collectorCookie').value.trim();
    if (!cookie) return say('Lütfen kendi tarayıcındaki __client çerezini gir.');
    try { await api('/api/connect','POST',{cookie}); $('collectorCookie').value=''; await status(); }
    catch (error) { $('collectorCookie').value=''; say(`Bağlantı hatası: ${error.message}`); }
  });
  $('collectorDisconnect').addEventListener('click', async () => {
    try { await api('/api/disconnect','POST',{}); await status(); } catch (error) {say(error.message);}
  });
  $('collectorSync').addEventListener('click', async () => {
    try {
      const ids = [...new Set($('collectorPlaylistUrls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(value => {
        const u=window.SunoCore.parseSunoLink(value);
        if(u.type!=='playlist' || !/^[a-fA-F0-9-]{36}$/.test(u.id))throw Error('Geçerli playlist UUID gereklidir.');
        return u.id;
      }))];
      await api('/api/sync','POST',{playlistIds:ids}); await status();
    }catch(error){say(`Tarama başlatılamadı: ${error.message}`);}
  });
  window.SunoEFSSFetchSong = async (id) => {
    try {
      const payload = await api('/api/song/' + encodeURIComponent(id));
      if (typeof window.SunoEFSSImport !== 'function') throw new Error('İçe aktarma işlevi bulunamadı.');
      await window.SunoEFSSImport(new File([JSON.stringify(payload)], 'sunoEFSS-song.json', {type:'application/json'}));
      say('Eser bilgisi güncellendi: ' + id);
    }catch(error) { say(error.message); alert('Suno metadata alınamadı: ' + error.message); }
  };
  $('collectorImport').addEventListener('click',async () => {
    try {
      const catalog = await api('/api/catalog');
      const file = new File([JSON.stringify(catalog)], 'sunoEFSS-synced-catalog.json', {type:'application/json'});
      // Use existing import pipeline so personal flags, notes, and playlists survive.
      if (typeof window.SunoEFSSImport !== 'function') throw new Error('İçe aktarma işlevi bulunamadı.');
      await window.SunoEFSSImport(file);
      say(`${catalog.songs.length} eserin metadata kataloğu içe aktarıldı. İndirme işaretleri korundu.`);
    }catch(error){say(`İçe aktarma başarısız: ${error.message}`);}
  });
})();