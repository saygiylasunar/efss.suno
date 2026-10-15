/* EFSS Suno — optional local collector UI. No credentials stored in browser storage. */
(function () {
  'use strict';
  const bar = document.querySelector('.top-actions');
  if (!bar) return;
  const button = document.createElement('button');
  button.className = 'btn btn-soft';
  button.type = 'button';
  button.textContent = '⇄ Suno Senkronize';
  bar.prepend(button);

  const dialog = document.createElement('dialog');
  dialog.id = 'collectorDialog';
  dialog.className = 'link-dialog';
  dialog.innerHTML = `<div class="dialog-head"><h2>⇄ Suno Catalog Collector</h2><button type="button" class="close-btn" id="collectorClose">✕</button></div>
  <div class="guide-body">
   <p><strong>Yerel bağlantı:</strong> <code>python collector.py</code> ile başlat. Suno oturum bilgin yalnız bilgisayarındaki RAM'de tutulur; parola veya cookie'yi sohbete ya da GitHub'a gönderme.</p>
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
   <p class="help-caption">Senkronizasyon yalnız metadata toplar. MP3/WAV dosyalarını indirmek için her eserin Suno bağlantısındaki resmî Download seçeneğini kullan. Pro'da yeni eserler için aylık kota geçerlidir.</p>
  </div>`;
  document.body.appendChild(dialog);
  const $ = id => document.getElementById(id);
  let timer = null;
  let canConnect = false;
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
      const p = current.progress || {};
      let msg = `Yerel sunucu çalışıyor · Oturum: ${current.connected ? 'Bağlı' : 'Bağlı değil'} · Katalog: ${current.catalogCount} eser`;
      if (current.syncing) msg += ` · Tarama: ${p.stage || '?'} — ${p.count || 0} eser, sayfa ${p.page || 0}`;
      if (current.lastSyncedAt) msg += ` · Son: ${new Date(current.lastSyncedAt).toLocaleString('tr-TR')}`;
      if (current.error) msg += ` · HATA: ${current.error}`;
      say(msg);
      $('collectorSync').disabled = !current.connected || current.syncing;
      $('collectorImport').disabled = !current.catalogCount;
    } catch (_) {
      canConnect = false;
      say('Collector çevrimdışı. Terminalde “python collector.py” çalıştır ve sayfayı http://localhost:8080 üzerinden aç. Normal http.server veya dosya:// modunda Suno bağlantısı yok.');
      $('collectorSync').disabled = true;
      $('collectorImport').disabled = true;
    }
  }
  function open() {dialog.showModal(); status(); timer = window.setInterval(status, 2400);}
  function close() {dialog.close(); window.clearInterval(timer); timer = null; $('collectorCookie').value = '';}
  button.addEventListener('click', open);
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