"""Explicit Suno MP3/WAV exports selected by the user, with local checksums.

Respects Suno HTTP refusals and quotas. No credential sharing or bypasses.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

LIMIT = 300 * 1024 * 1024
ID = re.compile(r"^[a-fA-F0-9-]{36}$")
HOST = re.compile(r"^(?:cdn\d*\.)?suno\.(?:ai|com)$")
CHUNK = 256 * 1024

class DownloadError(Exception):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = build_opener(NoRedirect())

def verified_url(value):
    if not isinstance(value, str):
        raise DownloadError("Ses URL bulunamadı.")
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or parsed.port or parsed.username or
            parsed.password or not HOST.fullmatch(parsed.hostname or "")):
        raise DownloadError("Yalnızca güvenilir Suno HTTPS CDN adreslerine erişilebilir.")
    return value

def safe_name(song, fmt):
    clip_id = str(song.get("id") or "")
    if not ID.fullmatch(clip_id) or fmt not in ("mp3", "wav"):
        raise DownloadError("Geçersiz eser veya format.")
    title = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", str(song.get("title") or "untitled"))
    title = re.sub(r"\s+", " ", title).strip(" .")[:70] or "untitled"
    date = str(song.get("created_at") or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = "undated"
    return f"{date}_{title}_{clip_id}.{fmt}"

def stream_audio(url, target):
    verified_url(url)
    temp = target.with_name(target.name + ".part")
    digest = hashlib.sha256()
    size = 0
    try:
        for hop in range(5):
            verified_url(url)
            try:
                response = OPENER.open(Request(url, headers={"User-Agent": "EFSS-Suno-Archiver",
                                                             "Referer": "https://suno.com/"}), timeout=60)
            except HTTPError as error:
                if error.code in (301,302,303,307,308) and error.headers.get("Location"):
                    url = urljoin(url, error.headers["Location"])
                    continue
                raise DownloadError(f"Suno indirmeye izin vermedi: HTTP {error.code}") from None
            with response:
                verified_url(response.geturl())
                content_length = response.headers.get("Content-Length")
                if content_length and content_length.isdigit() and int(content_length) > LIMIT:
                    raise DownloadError("Dosya çok büyük.")
                content_type = response.headers.get("Content-Type", "").lower()
                if "text/html" in content_type or "application/json" in content_type:
                    raise DownloadError("Suno ses dosyası yerine hata döndürdü.")
                target.parent.mkdir(parents=True, exist_ok=True)
                with temp.open("wb") as out:
                    while True:
                        chunk = response.read(CHUNK)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > LIMIT:
                            raise DownloadError("Dosya boyut sınırı aşıldı.")
                        out.write(chunk)
                        digest.update(chunk)
            if size < 1024:
                raise DownloadError("Boş/eksik ses dosyası.")
            header = temp.open("rb").read(12)
            if target.suffix == ".wav" and (header[:4] != b"RIFF" or header[8:12] != b"WAVE"):
                raise DownloadError("İndirilen dosya WAV değil.")
            if target.suffix == ".mp3" and not (header.startswith(b"ID3") or
                                                 (header[0] == 255 and header[1] & 0xE0 == 0xE0)):
                raise DownloadError("İndirilen dosya MP3 değil.")
            os.replace(temp, target)
            return {"file": target.name, "bytes": size, "sha256": digest.hexdigest(),
                    "format":target.suffix[1:],"verifiedAt":datetime.now(timezone.utc).isoformat()}
        raise DownloadError("CDN yönlendirme sınırı aşıldı.")
    except (OSError, URLError, TimeoutError) as e:
        raise DownloadError("İndirme sırasında ağ/disk hatası.") from e
    finally:
        if temp.exists():
            temp.unlink()

def wav_url(session, clip_id):
    if not ID.fullmatch(clip_id):
        raise DownloadError("Geçersiz eser ID.")
    # Conversion is explicitly requested by a WAV action. Reject 403/429.
    response = session.api("POST", f"/api/gen/{clip_id}/convert_wav/", {})
    url = response.get("wav_file_url") or response.get("url")
    for _ in range(30):
        if url:
            return verified_url(url)
        time.sleep(2)
        response = session.api("GET", f"/api/gen/{clip_id}/wav_file/")
        url = response.get("wav_file_url") or response.get("url")
    raise DownloadError("WAV çıktısı hazırlanamadı.")

def read_manifest(path):
    if not path.exists():
        return {"format":"efss-downloads-v1","files":{}}
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
        return obj if isinstance(obj, dict) and isinstance(obj.get("files"), dict) else {"format":"efss-downloads-v1","files":{}}
    except (ValueError, OSError):
        return {"format":"efss-downloads-v1","files":{}}

def save_manifest(path, manifest):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temp,path)

def verify_file(path, record):
    if not path.is_file() or path.stat().st_size != record.get("bytes"):
        return False
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest() == record.get("sha256")

def validate_queue(ids, fmt, catalog):
    if fmt not in ("mp3", "wav"):
        raise ValueError("MP3 veya WAV seç.")
    if not isinstance(ids, list) or not 1 <= len(ids) <= 250:
        raise ValueError("1–250 eser seç.")
    if any(not isinstance(x, str) or not ID.fullmatch(x) or x not in catalog for x in ids):
        raise ValueError("Katalogda bulunmayan/geçersiz eser.")
    return list(dict.fromkeys(ids))

def export_one(session, song, fmt, audio_dir, manifest):
    name = safe_name(song, fmt)
    item = manifest.setdefault("files",{}).setdefault(song["id"],{})
    previous = item.get(fmt)
    if previous and isinstance(previous.get("file"),str):
        fname = previous["file"]
        if Path(fname).name == fname and verify_file(audio_dir / fname,previous):
            return "already",previous
    url = verified_url(song.get("audio_url")) if fmt == "mp3" else wav_url(session,song["id"])
    record = stream_audio(url,audio_dir/name)
    item[fmt] = record
    return "downloaded",record
