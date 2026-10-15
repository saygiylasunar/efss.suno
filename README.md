# EFSS Suno — Local Music Archive

A local-first Suno library collector and archive manager. The interface starts empty. The repository contains no seeded songs, sample workspaces or personal playlist references.

## Run

```powershell
py collector.py
```

Open `http://localhost:8080`. In the **Oturumlar** panel you may connect your own Suno session and synchronize library metadata. No credentials, account sessions or catalog contents belong in GitHub. The session is held in the local Python process memory only.

## Features

- Local library, workspace and playlist metadata collector (private undocumented Suno endpoints).
- Song metadata filters, notes, playlist membership and download status.
- Manual song/playlist URL registration and metadata import.
- Local IndexedDB storage, CSV status reports and JSON backups.
- MP3/WAV queue prototype with source preflight, cancellation, circuit breaker and hash manifest.
- Read-only detection of MP3/M4A/WAV/MP4 media metadata fields and aggregate hostnames.

## Privacy

- Source ships with **zero** music records and zero personal workspace names.
- Local data is ignored by Git under `data/`.
- Do not commit audio files, Suno clips or playlist IDs, credentials, tokens, cookies, exports or user archives.
- No personal project names in input placeholders, documentation, or fixtures.
- Backups and downloaded audio remain on the user's own device.

## Limitations

API endpoints are undocumented and may change. Passing unit tests does not guarantee real Suno API compatibility or successful media export. A playback URL does not establish download permission; observe Suno's supported export options and applicable rights.

## Tests

```powershell
node --test tests/*.test.cjs
py -m unittest discover -s tests -p 'test_*.py' -v
```

**Canonical repository branch:** `main`.

---
EFSS
