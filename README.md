# Suno EFSS — Music Archiver / Library Inspector

**Özel, yerel, denetlenebilir Suno müzik arşivi yönetim arayüzü.**

![Version](https://img.shields.io/badge/version-0.2.0-AC95DA) ![Mode](https://img.shields.io/badge/mode-local--first-78C5B2)


## v0.3 — Gerçek Suno metadata senkronizasyonu (deneysel)

**Kurulum (Windows / Vivaldi):**

```powershell
cd $HOME\Desktop\efss.suno
python collector.py
```

Ardından **http://localhost:8080** adresinde **⇄ Suno Senkronize** butonunu aç. Bu sürüm `python -m http.server` yerine kendi salt-okunur yerel sunucusunu kullanır; `pip install` gerekmez. Python 3.10+ önerilir.

1. Suno hesabına Vivaldi'de giriş yap. F12 → Application → Cookies → `https://auth.suno.com` veya `clerk.suno.com` → `__client` değerini bul. Çerezi **yalnızca yerel arayüze** gir; şifreyi veya çerezi GitHub'a, ChatGPT'ye, sohbet mesajlarına göndermemelisin.
2. **Oturumu bağla** ile doğrula. `__client` bu Python sürecinin RAM'inde tutulur, asla diske yazılmaz. **Oturumu kapat** veya sunucuyu kapatınca yeni bağlantılarda kullanılmaz.
3. İstersen `https://suno.com/playlist/<uuid>` adreslerini satır satır gir, **Tüm Library + Workspace + Playlist'leri Tara** ile metadata topla. İşlem uzun sürebilir; ilerleme panelde görünür.
4. **Toplanan kataloğu arşive aktar** ile taramayı IndexedDB envanterine içe al. Var olan `İndirdim/İndirmedim` işaretleri, notlar ve arşiv geçmişi korunur.
5. Tekil eser kartındaki **↻ Bu şarkının metadata bilgisini Suno'dan getir** ile o şarkıyı ayrıca sorgula. **↗ Suno'da Aç / Resmî Download** veya **↗ Sıradaki indirilmeyen** ile resmî indirme işlemini başlat; dosyaları indirdikten sonra işaretleyip yerel klasörü kontrol et.

**İşleyiş / sınırlamalar:** Otomatik veri kaynağı olarak Suno'nun **belgelenmemiş/özel** `feed/v3`, `project/me`, `playlist/me`, `playlist/<id>` ve `clip/<id>` uçları kullanılır. Suno bu uçları değiştirebilir. Kullanıcı hesabıyla canlı uçtan uca doğrulama yapılmadı; örnek verilerle otomatik test edildi. Yalnızca katalog bilgisi çekilir. **MP3/WAV indirme işlemi bu sürümde otomatik değildir**; Suno Pro'nun 20 yeni şarkı/ay kotasını aşacak yöntem yoktur. Playlistlerin tüm sayfaları elde edilemezse uygulama eksiklik uyarısı verir. Suno dışındaki API adreslerine istek gönderilmez.

**Veri koruma:** Koleksiyonun yerel `data/catalog.json` dosyasına kaydedilir ve `.gitignore` içindedir. Kendi Suno verilerini ve `.env`/cookie dosyalarını hiçbir zaman public GitHub reposuna ekleme. Ayrıca uygulama içinden **Yedeği dışa aktar** kullan. Yerel HTTP sunucusu sadece `127.0.0.1` arayüzünde çalışır; listeleme, indirme ve kötü niyetli ağ kökenli yazmalar kapalıdır. Sunucu çalışırken gelen Origin kontrolü yapılır.

## Çalıştırma

Bağımlılık, hesap girişi ve kurulum gerektirmez: **`index.html` dosyasını Vivaldi, Chrome veya Edge ile aç.** İstersen yerel HTTP sunucusuyla çalıştır: `python -m http.server 8080` → `http://localhost:8080`.

İlk açılışta **8 etiketli örnek eser** gösterilir. Bunlar gerçek hesabından çekilmiş kayıtlar değildir. **Katalog ekle** üzerinden gerçek dosyayı yüklediğinde örnekler kaldırılır.

## Desteklenen içe aktarma formatları

- `catalog.json`: `suno-dl` biçiminde ham Suno clip dizisi veya `{ "clips": [...] }`, `{ "songs": [...] }`.
- `catalog.csv`: `id` sütunu zorunlu, tırnaklı alanlar ve çok satırlı lyrics desteklenir.
- `sunoEFSS-backup-*.json`: Bu uygulamanın ürettiği tam arşiv yedeği; manuel flag'ler, notlar, çalışma alanları, işlem geçmişi dahil.
- `workspaces.json`: Çalışma alanlarını ayrı içe aktarmak için.

**Not:** Statik HTML modunda Suno hesabına bağlanmaz; v0.3 yerel Collector sunucusu ile kullanıcının tarayıcısından sağladığı oturum çerezini yalnız RAM üzerinde tutarak metadata toplayabilir. Statik URL ekleme hâlâ yalnızca manuel referans oluşturur. Otomatik medya indirmez. Öncelik, elde edilen metadata'yı güvenli şekilde saklayıp arşivleme sürecini yönetmektir. Mevcut Suno indirme kotalarını aşmayı denemez. Uygulama, kapak görsellerini yalnızca metadata içindeki Suno HTTPS görsel URL'lerinden isteyebilir.

## Suno URL ekleme (v0.2)

Üstteki **⌁ Link ekle** ile `https://suno.com/song/<id>` veya `https://suno.com/playlist/<id>` bağlantısı girilebilir. Suno playlistini özel adıyla kaydetmek, tekil şarkı URL'lerini listelemek (satır başına bir bağlantı), detay kartından playlist üyeliği işaretlemek ve **Playlist** filtresinde kayıtları görmek mümkündür.

**Örnek test playlisti:** `https://suno.com/playlist/e4fc5b93-d19b-4ce0-ae4a-668b7c059187` — bağlantı olarak kaydedilir; içerik erişimi başarıyla test edilmediği için içeriğini otomatik okuduğu iddia edilmez.

Playlist ilişkileri, manuel şarkı bağlantıları ve notlar IndexedDB ve **v2 JSON yedek** içine girer. Önceki `sunoEFSS-archive-v1` yedekleri de açılır. Playlist URL'leri salt okunur referans olarak tutulur; kullanıcıdan parola, cookie veya token istenmez.

## İşlevler

- Tekil Suno `id` ile mükerrer kayıtları birleştirir; workspace üyeliklerini korur.
- Zamana göre eskiden yeniye / yeniden eskiye sıralama, tarih aralığı ve başlık–söz–style–prompt araması.
- Workspace, model, indirme durumu, liked / disliked / stem / remix / cover / instrumental filtreleri.
- Satırdan açılan detay paneli: tam oluşturulma tarihi, dinleme sayısı, model, style, excluded styles, prompt, lyrics, süre, köken/orijinal parça bağlantıları, ham metadata JSON.
- **İndirdim / İndirmedim / Belirsiz** durumları, kişisel notlar, zaman damgalı işlem geçmişi.
- Ses klasörü taraması: dosya adında en az 8 karakter uzunluğunda Suno ID ile eşleştirip onayla işaretleme. Dosyaların içeriğini okumaz ve hiçbirini sunucuya göndermez.
- İçe aktarılan veri ve flag'ler tarayıcı **IndexedDB** üzerinde; toplu **JSON yedek** ve **CSV** durum raporu.

## Gizlilik / güvenlik

- Üçüncü taraf binary yok, çalışma sırasında dış bağımlılık yok.
- Statik modda şifre veya cookie istenmez. Collector modunda __client çerezi yalnız yerel loopback sunucusunun RAM'ine girilir; şifre istenmez ve kimlik bilgisi kaydedilmez.
- Dosya okumaları tarayıcı File API üzerinden yalnızca kullanıcı seçimiyle.
- Kullanıcı metinleri HTML escape edilir, URL'ler protokol doğrulamasından geçer; resimler yalnızca Suno domainlerinde yüklenir.
- Yerel tarayıcı verileri kalıcı yedek sayılmamalı: **düzenli `Yedeği dışa aktar`**.
- JSON yedekler özel lyrics/prompt içerir; **Git'e eklemeyin.**

## Geliştirme ve test

Sade HTML/CSS/JavaScript; Node yalnızca testleri çalıştırmak için gerekir:

```bash
node --test tests/core.test.cjs
python -m unittest discover -s tests -p 'test_collector.py' -v
```

## Roadmap

- [x] Offline-first katalog ve flag MVP
- [x] Filtre/sıralama, metadata drawer, köken ilişkileri, tarihler
- [x] JSON/CSV içe aktarma ve JSON/CSV dışa aktarma
- [x] Local ID tabanlı ses dosyası eşleştirme
- [x] Şarkı/playlist URL kaydı, üyelik düzenleme ve playlist filtreleme
- [x] Yerel read-only Suno metadata toplayıcı (özel API: canlı kullanıcı doğrulaması bekliyor; kimlik bilgileri repoya girmeyecek)
- [ ] Stem/cover/remix ilişki grafiği, manuel köken düzenleme
- [ ] Dosya hash doğrulaması, kalıcı klasör bağlama ve içerik doğrulama
- [ ] Sanallaştırılmış liste, çoklu seçimle işaretleme, timeline görselleştirme

## Mevcut kapsam sınırı

`İndirildi` manuel flag'i **gerçek ses dosyasının varlığına dair otomatik bir garanti değildir**. Klasör taraması yalnız dosya adına göre eşleştirme yapar; dosyanın sağlıklı ve eksiksiz olduğuna ilişkin hash/format kontrolü sonraki aşamadır.

---
{saygiylasunar} · EFSS