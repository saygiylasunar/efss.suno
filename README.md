# Suno EFSS — Music Archiver / Library Inspector

**Özel, yerel, denetlenebilir Suno müzik arşivi yönetim arayüzü.**

![Version](https://img.shields.io/badge/version-0.2.0-AC95DA) ![Mode](https://img.shields.io/badge/mode-local--first-78C5B2)

## Çalıştırma

Bağımlılık, hesap girişi ve kurulum gerektirmez: **`index.html` dosyasını Vivaldi, Chrome veya Edge ile aç.** İstersen yerel HTTP sunucusuyla çalıştır: `python -m http.server 8080` → `http://localhost:8080`.

İlk açılışta **8 etiketli örnek eser** gösterilir. Bunlar gerçek hesabından çekilmiş kayıtlar değildir. **Katalog ekle** üzerinden gerçek dosyayı yüklediğinde örnekler kaldırılır.

## Desteklenen içe aktarma formatları

- `catalog.json`: `suno-dl` biçiminde ham Suno clip dizisi veya `{ "clips": [...] }`, `{ "songs": [...] }`.
- `catalog.csv`: `id` sütunu zorunlu, tırnaklı alanlar ve çok satırlı lyrics desteklenir.
- `sunoEFSS-backup-*.json`: Bu uygulamanın ürettiği tam arşiv yedeği; manuel flag'ler, notlar, çalışma alanları, işlem geçmişi dahil.
- `workspaces.json`: Çalışma alanlarını ayrı içe aktarmak için.

**Not:** Bu MVP Suno hesabına bağlanmaz, Suno çerezi istemez, API çağırmaz, URL yapıştırıldığında playlist içeriğini otomatik keşfetmez ve otomatik medya indirmez. Öncelik, elde edilen metadata'yı güvenli şekilde saklayıp arşivleme sürecini yönetmektir. Mevcut Suno indirme kotalarını aşmayı denemez. Uygulama, kapak görsellerini yalnızca metadata içindeki Suno HTTPS görsel URL'lerinden isteyebilir.

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
- Şifre, Suno cookie'si veya token istenmez. Uygulamanın kendisi Suno API'sini çağırmaz.
- Dosya okumaları tarayıcı File API üzerinden yalnızca kullanıcı seçimiyle.
- Kullanıcı metinleri HTML escape edilir, URL'ler protokol doğrulamasından geçer; resimler yalnızca Suno domainlerinde yüklenir.
- Yerel tarayıcı verileri kalıcı yedek sayılmamalı: **düzenli `Yedeği dışa aktar`**.
- JSON yedekler özel lyrics/prompt içerir; **Git'e eklemeyin.**

## Geliştirme ve test

Sade HTML/CSS/JavaScript; Node yalnızca testleri çalıştırmak için gerekir:

```bash
node --test tests/core.test.cjs
```

## Roadmap

- [x] Offline-first katalog ve flag MVP
- [x] Filtre/sıralama, metadata drawer, köken ilişkileri, tarihler
- [x] JSON/CSV içe aktarma ve JSON/CSV dışa aktarma
- [x] Local ID tabanlı ses dosyası eşleştirme
- [x] Şarkı/playlist URL kaydı, üyelik düzenleme ve playlist filtreleme
- [ ] Onaylı read-only Suno metadata çıkarma yöntemi (ayrı servis/eklenti; kimlik bilgileri repoya girmeyecek)
- [ ] Stem/cover/remix ilişki grafiği, manuel köken düzenleme
- [ ] Dosya hash doğrulaması, kalıcı klasör bağlama ve içerik doğrulama
- [ ] Sanallaştırılmış liste, çoklu seçimle işaretleme, timeline görselleştirme

## Mevcut kapsam sınırı

`İndirildi` manuel flag'i **gerçek ses dosyasının varlığına dair otomatik bir garanti değildir**. Klasör taraması yalnız dosya adına göre eşleştirme yapar; dosyanın sağlıklı ve eksiksiz olduğuna ilişkin hash/format kontrolü sonraki aşamadır.

---
{saygiylasunar} · EFSS
## Son geliştirme dalı

İndirilmemiş eserleri sırasıyla resmî Suno sayfasında açma düğmesi eklendi. Şarkı kartında Suno bağlantısı gösterilir. Suno katalog JSON içe aktarması playlist ilişkilerini ve remix etiketlerini korur. Otomatik ses indirme henüz yoktur. Suno hesabına bağlanan araç burada etkin değildir.
