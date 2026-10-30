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

def source_host(value):
    """Safe media diagnostic: never include signed query strings or file paths."""
    if not isinstance(value, str) or not value.strip():
        return "(eksik)"
    try:
        hostname = (urlsplit(value).hostname or "").lower()
    except ValueError:
        return "(gecersiz)"
    return hostname if re.fullmatch(r"[a-z0-9.-]{1,120}", hostname) else "(gecersiz)"


def media_inventory(songs):
    """Catalog media-field inventory; no outgoing network calls or direct URLs."""
    fields = {"mp3": ("audio_url",), "m4a": ("m4a_url",),
              "wav": ("wav_url",), "mp4": ("video_url", "mp4_url")}
    result = {fmt: {"present": 0, "hosts": {}} for fmt in fields}
    for song in songs:
        if not isinstance(song, dict):
            continue
        meta = song.get("metadata") if isinstance(song.get("metadata"), dict) else {}
        for fmt, names in fields.items():
            value = next((v for field in names for v in (song.get(field), meta.get(field))
                          if isinstance(v, str) and v.strip()), None)
            if not value:
                continue
            host = source_host(value)
            entry = result[fmt]
            entry["present"] += 1
            entry["hosts"][host] = entry["hosts"].get(host, 0) + 1
    return {"totalSongs": len(songs), "formats": result,
            "notice": "Oynatma adresi resmi indirme yetkisi degildir; indirmek icin Suno indirme menusunu kullanin."}


def preflight_sources(ids, fmt, catalog):
    """Fail the batch before any media request when all MP3 sources are unsupported."""
    if fmt != "mp3":
        return list(ids), []
    eligible, unsupported = [], []
    for ident in ids:
        try:
            verified_url(catalog[ident].get("audio_url"))
            eligible.append(ident)
        except DownloadError:
            unsupported.append(ident)
    return eligible, unsupported


def verified_url(value):
    if not isinstance(value, str):
        raise DownloadError("Ses URL bulunamadı.")
    try:
        parsed = urlsplit(value)
        allowed = (parsed.scheme == "https" and parsed.port is None and
                   not parsed.username and not parsed.password and
                   bool(HOST.fullmatch(parsed.hostname or "")))
    except ValueError:
        allowed = False
    if not allowed:
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

def stream_audio(url, target, cancel_event=None):
    verified_url(url)
    temp = target.with_name(target.name + ".part")
    digest = hashlib.sha256()
    size = 0
    try:
        for hop in range(5):
            verified_url(url)
            if cancel_event is not None and cancel_event.is_set():
                raise DownloadError("Kullanici tarafindan durduruldu.")
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
                        if cancel_event is not None and cancel_event.is_set():
                            raise DownloadError("Kullanici tarafindan durduruldu.")
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

def wav_url(session, clip_id, cancel_event=None):
    if not ID.fullmatch(clip_id):
        raise DownloadError("Geçersiz eser ID.")
    # Conversion is explicitly requested by a WAV action. Reject 403/429.
    if cancel_event is not None and cancel_event.is_set():
        raise DownloadError("Kullanici tarafindan durduruldu.")
    response = session.api("POST", f"/api/gen/{clip_id}/convert_wav/", {})
    url = response.get("wav_file_url") or response.get("url")
    for _ in range(30):
        if cancel_event is not None and cancel_event.is_set():
            raise DownloadError("Kullanici tarafindan durduruldu.")
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
    if not isinstance(record, dict) or not path.is_file() or path.stat().st_size != record.get("bytes"):
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

def export_one(session, song, fmt, audio_dir, manifest, cancel_event=None):
    name = safe_name(song, fmt)
    if cancel_event is not None and cancel_event.is_set():
        raise DownloadError("Kullanici tarafindan durduruldu.")
    item = manifest.setdefault("files",{}).setdefault(song["id"],{})
    previous = item.get(fmt)
    if isinstance(previous, dict) and isinstance(previous.get("file"),str):
        fname = previous["file"]
        if Path(fname).name == fname and verify_file(audio_dir / fname,previous):
            return "already",previous
    url = verified_url(song.get("audio_url")) if fmt == "mp3" else wav_url(session,song["id"], cancel_event)
    record = stream_audio(url,audio_dir/name,cancel_event)
    item[fmt] = record
    return "downloaded",record
