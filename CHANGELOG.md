## v0.4.0 — 2026-10-15
- Yerel Suno Collector GitHub'a eklendi: kişisel Library, Workspace, playlist ve metadata taraması.
- Tekil MP3/WAV indirme ve 250 kayıtlık onaylı kuyruk.
- Dosya formatı doğrulama, Suno CDN adres kontrolü, SHA-256 manifest ve tekrar indirmeme.
- Oturum yalnız yerel bilgisayarda; canlı hesap doğrulaması bekliyor.

## v0.3.0 — Read-only Catalog Collector (2026-10-14)

- Local Python loopback server, memory-only session authentication, strict Host/Origin checks.
- Cursor-paged library, workspace feeds, disliked/stem passes, playlist member pagination, progress/status.
- Local catalog JSON snapshot (credentials excluded), browser import preserves flags and notes.
- Per-song metadata refresh and open-in-Suno official download flow; next-pending-song shortcut.
- 7 Python mock/network-security tests + 12 existing JS core tests; no live Suno account verification.
- No automatic MP3/WAV export and no bypass of Pro download credits.

# Changelog

## v0.2.0 — 2026-10-14
- Suno şarkı veya playlist bağlantılarını ayrı kaynaklar olarak kaydetme (URL doğrulaması dahil).
- Playlist adı / ID / URL ve isteğe bağlı çoklu eser bağlantıları; tekil URL'yi playlist'e bağlama.
- Eser kartından playlist üyeliği ekleme/çıkarma, filtreler ve yan menüde playlistler.
- JSON yedek formatı v2: playlists / playlistMembers; eski v1 yedek uyumluluğu.
- Paylaşılan örnek playlist bağlantısı kayıt olarak destekleniyor. Uzaktan veri çekme yok; erişim doğrulanmadı.

# Changelog / Engineering Log

## 2026-10-14 — 0.1.0 Offline Library MVP

- Pure frontend UI; no Suno auth, no third-party executable.
- Clip ID normalization/dedupe; CSV and JSON import; IndexedDB + backup JSON.
- Download status/manual notes/history; filter/sort and detail inspector.
- Optional file-name matching for local audio files; tests for parser/normalization.

### Acceptance checklist
- [x] Unit tests pass for CSV, deduplication, flags, relational metadata, backup.
- [ ] Browser E2E (real browser + IndexedDB) on Windows.
- [ ] First real Suno catalog import and model/metadata mapping verified.
- [ ] Backups verified through export → reload → import on user's system.
- [ ] Confirm destination repository exists and create a feature branch/PR.

### Next slice
1. Import a real anonymized Suno catalog sample (no secrets), audit field mapping.
2. Harden file verification and batch marking UX.
3. Design an opt-in, read-only catalog acquisition path without exposing session cookies.