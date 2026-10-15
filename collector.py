"""EFSS Suno local read-only metadata collector.

Runs on loopback only. Holds a Suno __client session cookie in process memory,
never logs it and never writes credentials to disk. API endpoints are private and
may change; this client fails explicitly rather than manufacturing data.

IMPORTANT: Audio export is deliberately delegated to Suno's official download UI,
so this utility does not evade or misrepresent Suno's download credit accounting.
"""
from __future__ import annotations

import base64
import json
import os
import re
import secrets
import threading
import time
import uuid
from downloads import DownloadError, export_one, read_manifest, save_manifest, validate_queue
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / 'data'
API_URL = 'https://studio-api.prod.suno.com'
AUTH_URL = 'https://auth.suno.com'
AUTH_QUERY = '?__clerk_api_version=2025-11-10&_clerk_js_version=5.117.0'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36'
UUID_RE = re.compile(r'^[a-fA-F0-9]{8}-[a-fA-F0-9-]{27,40}$')
MAX_JSON_BODY = 16 * 1024
ALLOWED_STATIC = {'/', '/index.html', '/app.js', '/core.js', '/styles.css', '/connect.js'}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class ApiError(Exception):
    pass


def json_request(method: str, url: str, headers: dict, payload=None, retries=4):
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    request_headers = {'User-Agent': USER_AGENT, **headers}
    if data is not None:
        request_headers['Content-Type'] = 'application/json'
    for attempt in range(retries):
        req = Request(url, data=data, method=method, headers=request_headers)
        try:
            with urlopen(req, timeout=35) as response:
                raw = response.read(20 * 1024 * 1024)
                return json.loads(raw.decode('utf-8')) if raw.strip() else {}
        except HTTPError as exc:
            if exc.code == 429 or exc.code >= 500:
                if attempt < retries - 1:
                    retry_after = exc.headers.get('Retry-After', '')
                    sleep = min(float(retry_after), 60) if retry_after.replace('.', '', 1).isdigit() else min(2 ** (attempt + 1), 15)
                    time.sleep(sleep)
                    continue
            raise ApiError(f'Suno HTTP {exc.code} ({urlsplit(url).path})') from None
        except (URLError, TimeoutError, OSError) as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise ApiError(f'Ağ bağlantısı başarısız ({urlsplit(url).hostname})') from exc
    raise ApiError('API isteği başarısız')


class SunoSession:
    def __init__(self, client_cookie: str):
        cookie = client_cookie.strip()
        if cookie.startswith('__client='):
            cookie = cookie[len('__client='):].split(';', 1)[0]
        if not re.fullmatch(r'[A-Za-z0-9_\-\.]+', cookie) or len(cookie) < 30 or len(cookie) > 8192:
            raise ValueError('Geçerli __client oturum çerezi bulunamadı.')
        self.cookie = cookie
        self.session_id = None
        self.jwt = None
        self.token_time = 0
        self.lock = threading.RLock()
        self.device_id = str(uuid.uuid4())
        self._refresh(force=True)

    def _auth_headers(self):
        return {'Cookie': f'__client={self.cookie}', 'Authorization': self.cookie,
                'Origin': 'https://suno.com', 'Referer': 'https://suno.com/'}

    def _refresh(self, force=False):
        with self.lock:
            if not force and self.jwt and time.monotonic() - self.token_time < 35:
                return
            if not self.session_id:
                r = json_request('GET', AUTH_URL + '/v1/client' + AUTH_QUERY, self._auth_headers())
                data = r.get('response') or {}
                self.session_id = data.get('last_active_session_id')
                if not self.session_id:
                    self.session_id = next((s.get('id') for s in data.get('sessions') or []
                                            if s.get('status') in ('active', None) and s.get('id')), None)
                if not self.session_id:
                    raise ApiError('Suno oturumu aktif değil. Vivaldi üzerinden yeniden giriş yap.')
            r = json_request('POST', AUTH_URL + f'/v1/client/sessions/{self.session_id}/tokens' + AUTH_QUERY,
                             self._auth_headers(), {})
            self.jwt = r.get('jwt')
            if not self.jwt:
                raise ApiError('Suno oturum tokenı alınamadı.')
            self.token_time = time.monotonic()

    def api(self, method: str, path: str, payload=None):
        if not path.startswith('/api/') or '://' in path:
            raise ValueError('Unexpected API path')
        self._refresh()
        browser_token = base64.b64encode(json.dumps({'timestamp': int(time.time() * 1000)}).encode()).decode()
        headers = {'Authorization': f'Bearer {self.jwt}', 'Device-Id': self.device_id,
                   'browser-token': json.dumps({'token': browser_token}),
                   'Origin': 'https://suno.com', 'Referer': 'https://suno.com/'}
        return json_request(method, API_URL + path, headers, payload)


def feed_pages(session, filters, progress=lambda **kwargs: None, label='songs', limit=20):
    """Cursor pagination with looping-cursor protection. No mutation calls."""
    cursor = None
    seen = set()
    songs = {}
    for page in range(1000):
        response = session.api('POST', '/api/feed/v3', {'cursor': cursor, 'limit': limit, 'filters': filters})
        clips = response.get('clips') or []
        if not isinstance(clips, list):
            raise ApiError(f'{label}: Suno feed yanıtı değişmiş (clips liste değil).')
        for song in clips:
            if isinstance(song, dict) and song.get('id'):
                songs[song['id']] = song
        progress(stage=label, count=len(songs), page=page + 1)
        nxt = response.get('next_cursor', response.get('nextCursor'))
        if not response.get('has_more', response.get('hasMore', False)) or not clips:
            break
        if not nxt or nxt == cursor or nxt in seen:
            raise ApiError(f'{label}: sayfalama cursor tekrarlıyor; katalog eksik olabilir.')
        seen.add(nxt)
        cursor = nxt
        time.sleep(0.12)
    else:
        raise ApiError(f'{label}: sayfalama güvenlik sınırı aşıldı.')
    return songs


def workspace_list(session):
    workspaces = []
    ids = set()
    for page in range(1, 101):
        r = session.api('GET', f'/api/project/me?page={page}&sort=max_created_at_last_updated_clip&show_trashed=false&exclude_shared=false')
        batch = r.get('projects') or []
        if not batch:
            break
        found = 0
        for ws in batch:
            if ws.get('id') and ws['id'] not in ids:
                workspaces.append(ws)
                ids.add(ws['id'])
                found += 1
        if not found or not r.get('has_more'):
            break
        time.sleep(0.1)
    return workspaces


def playlist_details(session, playlist_id):
    """Read full playlist (page-by-page); preserve member order and detect truncation."""
    items, seen = [], set()
    expected, first = None, None
    warning = None
    for page in range(1, 101):
        r = session.api('GET', f'/api/playlist/{playlist_id}/?page={page}')
        if first is None:
            first = r
            expected = r.get('num_total_results')
        batch = r.get('playlist_clips') or []
        if not batch:
            break
        fresh = 0
        for wrapper in batch:
            clip = wrapper.get('clip') if isinstance(wrapper, dict) else None
            if not isinstance(clip, dict):
                clip = wrapper if isinstance(wrapper, dict) else None
            if not clip or not clip.get('id') or clip['id'] in seen:
                continue
            seen.add(clip['id'])
            items.append((wrapper.get('relative_index', len(items)) if isinstance(wrapper, dict) else len(items), clip))
            fresh += 1
        if not fresh or (isinstance(expected, int) and len(items) >= expected):
            break
        time.sleep(0.1)
    items.sort(key=lambda item: item[0] if isinstance(item[0], (int, float)) else 0)
    if isinstance(expected, int) and expected != len(items):
        warning = f'{playlist_id}: {len(items)}/{expected} şarkı okundu; liste eksik olabilir.'
    return first or {}, [x[1] for x in items], warning


def playlists_list(session):
    items, seen = [], set()
    for page in range(1, 101):
        r = session.api('GET', f'/api/playlist/me?page={page}&show_trashed=false&show_sharelist=false')
        batch = r.get('playlists') or []
        if not batch:
            break
        new = 0
        for p in batch:
            if isinstance(p, dict) and p.get('id') and p['id'] not in seen:
                items.append(p)
                seen.add(p['id'])
                new += 1
        if not new or (isinstance(r.get('num_total_results'), int) and len(items) >= r['num_total_results']):
            break
        time.sleep(0.1)
    return items


def merge_record(older, newer):
    if not older:
        return dict(newer)
    merged = {**older, **newer}
    merged['_workspaces'] = sorted(set((older.get('_workspaces') or []) + (newer.get('_workspaces') or [])))
    # Never replace a rich record with an empty metadata skeleton.
    if not newer.get('metadata') and older.get('metadata'):
        merged['metadata'] = older['metadata']
    return merged


def build_catalog(session, progress, extra_playlist_ids=()):
    warnings = []
    songs = feed_pages(session, {}, progress, 'Tüm eserler')
    # A separate pass gets reaction-only entries, where provided by the API.
    for name, filt in [('Disliked', {'disliked': 'True'}), ('Stem', {'stem': {'presence': 'True'}})]:
        try:
            more = feed_pages(session, filt, progress, name)
            for key, clip in more.items():
                songs[key] = merge_record(songs.get(key), clip)
        except ApiError as exc:
            warnings.append(f'{name}: {exc}')
    progress(stage='Workspaces', count=len(songs), page=0)
    try:
        workspaces = workspace_list(session)
        for ws in workspaces:
            name = ws.get('name') or ws.get('title') or ws['id']
            try:
                batch = feed_pages(session, {'workspace': {'presence': 'True', 'workspaceId': ws['id']}}, progress, name)
                for key, song in batch.items():
                    rec = dict(song)
                    rec['_workspaces'] = sorted(set((songs.get(key, {}).get('_workspaces') or []) + [name]))
                    songs[key] = merge_record(songs.get(key), rec)
            except ApiError as exc:
                warnings.append(f'Workspace {name}: {exc}')
    except ApiError as exc:
        workspaces = []
        warnings.append(f'Workspace listesi: {exc}')
    progress(stage='Playlistler', count=len(songs), page=0)
    try:
        playlists = playlists_list(session)
    except ApiError as exc:
        playlists = []
        warnings.append(f'Playlist listesi: {exc}')
    ids = {p.get('id') for p in playlists}
    for pid in extra_playlist_ids:
        if pid not in ids:
            playlists.append({'id': pid, 'name': f'Playlist {pid[:8]}'})
            ids.add(pid)
    result_playlists, members = [], {}
    for idx, playlist in enumerate(playlists):
        pid = playlist['id']
        try:
            detail, clips, warning = playlist_details(session, pid)
            if warning:
                warnings.append(warning)
            name = detail.get('name') or playlist.get('name') or f'Playlist {pid[:8]}'
            result_playlists.append({'id': pid, 'name': name, 'url': f'https://suno.com/playlist/{pid}',
                                     'addedAt': utc_now(), '_meta': detail or playlist})
            members[pid] = [x['id'] for x in clips]
            for clip in clips:
                key = clip['id']
                songs[key] = merge_record(songs.get(key), clip)
            progress(stage=f'Playlist {idx + 1}/{len(playlists)}', count=len(songs), page=0)
        except ApiError as exc:
            warnings.append(f'Playlist {pid}: {exc}')
    payload = {'format': 'sunoEFSS-collector-v1', 'collectedAt': utc_now(),
               'songs': list(songs.values()), 'workspaces': workspaces,
               'playlists': result_playlists, 'playlistMembers': members,
               'warnings': warnings}
    return payload


class Manager:
    def __init__(self):
        self.session = None
        self.syncing = False
        self.progress = {'stage': 'Hazır', 'count': 0, 'page': 0}
        self.last_error = None
        self.last_synced_at = None
        self.lock = threading.Lock()
        self.catalog = None
        self.download_busy = False
        self.download_progress = {'stage':'Hazır','done':0,'total':0,'failed':0,'current':'','errors':[]}
        self.download_manifest = read_manifest(DATA_DIR / 'download_manifest.json')
        path = DATA_DIR / 'catalog.json'
        if path.is_file():
            try:
                self.catalog = json.loads(path.read_text(encoding='utf-8'))
                self.last_synced_at = self.catalog.get('collectedAt')
            except (ValueError, OSError):
                pass

    def connect(self, cookie):
        session = SunoSession(cookie)
        with self.lock:
            self.session = session
        return {'connected': True}

    def status(self):
        with self.lock:
            return {'connected': self.session is not None, 'syncing': self.syncing,
                    'progress': dict(self.progress), 'error': self.last_error,
                    'lastSyncedAt': self.last_synced_at,
                    'catalogCount': len((self.catalog or {}).get('songs') or []),
                    'downloadBusy':self.download_busy,'downloadProgress':dict(self.download_progress)}

    def update_progress(self, **kwargs):
        with self.lock:
            self.progress = kwargs

    def sync(self, playlist_ids=()):
        with self.lock:
            if not self.session:
                raise ValueError('Önce Suno oturumunu bağla.')
            if self.syncing:
                raise ValueError('Senkronizasyon zaten devam ediyor.')
            self.syncing = True
            self.last_error = None
            session = self.session
        def worker():
            try:
                output = build_catalog(session, self.update_progress, playlist_ids)
                DATA_DIR.mkdir(exist_ok=True)
                file = DATA_DIR / 'catalog.json'
                tmp = DATA_DIR / 'catalog.json.tmp'
                tmp.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
                os.replace(tmp, file)
                with self.lock:
                    self.catalog = output
                    self.last_synced_at = output['collectedAt']
                    self.progress = {'stage': 'Tamamlandı', 'count': len(output['songs']), 'page': 0}
            except Exception as exc:
                with self.lock:
                    self.last_error = str(exc)
            finally:
                with self.lock:
                    self.syncing = False
        threading.Thread(target=worker, daemon=True).start()

    def download_manifest_view(self):
        # Read last atomically saved snapshot; never serialize mutable worker state.
        return read_manifest(DATA_DIR / 'download_manifest.json')

    def start_download(self, ids, fmt):
        with self.lock:
            if self.download_busy:
                raise ValueError('İndirme kuyruğu çalışıyor.')
            if self.syncing:
                raise ValueError('Katalog taraması sürerken indirme yapılamaz.')
            if not self.session:
                raise ValueError('Önce kendi Suno oturumunu bağla.')
            catalog = {c['id']:c for c in (self.catalog or {}).get('songs',[]) if isinstance(c,dict) and c.get('id')}
            targets = validate_queue(ids,fmt,catalog)
            session = self.session
            self.download_busy = True
            self.download_progress = {'stage':'İndiriliyor','done':0,'total':len(targets),'failed':0,
                                      'current':'','errors':[],'format':fmt}
        def worker():
            manifest_path = DATA_DIR / 'download_manifest.json'
            try:
                for index,clip_id in enumerate(targets):
                    with self.lock:
                        self.download_progress['current'] = catalog[clip_id].get('title') or clip_id
                    try:
                        export_one(session,catalog[clip_id],fmt,DATA_DIR/'audio',self.download_manifest)
                        save_manifest(manifest_path,self.download_manifest)
                    except (DownloadError, ApiError, ValueError, OSError) as exc:
                        with self.lock:
                            self.download_progress['failed'] += 1
                            self.download_progress['errors'].append({'id':clip_id,'error':str(exc)[:180]})
                        if '403' in str(exc) or '429' in str(exc):
                            with self.lock:
                                self.download_progress['stage'] = 'Suno indirmeyi reddetti; kuyruk durdu'
                            break
                    finally:
                        with self.lock:
                            self.download_progress['done'] = index + 1
                    time.sleep(1)
            except Exception as exc:
                with self.lock:
                    self.download_progress['stage'] = 'Kuyruk hatası'
                    self.download_progress['errors'].append({'id':'queue','error':str(exc)[:180]})
            finally:
                with self.lock:
                    if self.download_progress['stage'] == 'İndiriliyor':
                        self.download_progress['stage'] = 'Tamamlandı'
                    self.download_busy = False
        threading.Thread(target=worker,daemon=True).start()

    def single(self, clip_id):
        with self.lock:
            session = self.session
        if not session:
            raise ValueError('Önce Suno oturumunu bağla.')
        if not UUID_RE.fullmatch(clip_id):
            raise ValueError('Geçersiz eser ID.')
        data = session.api('GET', f'/api/clip/{clip_id}')
        clip = data.get('clip') if isinstance(data.get('clip'), dict) else data
        if not isinstance(clip, dict) or not clip.get('id'):
            raise ApiError('Şarkı bilgisi alınamadı.')
        return {'songs': [clip]}


manager = Manager()


class Handler(SimpleHTTPRequestHandler):
    server_version = 'EFSS-Local/0.3'

    def log_message(self, fmt, *args):
        # No path/body/credential logging; use generic status reports only.
        return

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'none'")
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def guard(self, changing=False):
        port = self.server.server_port
        valid = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if self.headers.get('Host') not in valid:
            self.send_json({'error': 'Geçersiz Host.'}, 403)
            return False
        if changing and self.headers.get('Origin') not in {f'http://{s}' for s in valid}:
            self.send_json({'error': 'Geçersiz Origin.'}, 403)
            return False
        return True

    def do_GET(self):
        if not self.guard():
            return
        path = urlsplit(self.path).path
        if path == '/api/status':
            return self.send_json(manager.status())
        if path == '/api/downloads':
            return self.send_json(manager.download_manifest_view())
        if path == '/api/catalog':
            if manager.catalog is None:
                return self.send_json({'error': 'Henüz katalog toplanmadı.'}, 404)
            return self.send_json(manager.catalog)
        if path.startswith('/api/song/'):
            try:
                return self.send_json(manager.single(path.rsplit('/', 1)[-1]))
            except (ApiError, ValueError) as exc:
                return self.send_json({'error': str(exc)}, 400)
        if path not in ALLOWED_STATIC:
            self.send_error(404)
            return
        self.path = '/index.html' if path == '/' else path
        self.directory = str(BASE)
        super().do_GET()

    def do_POST(self):
        if not self.guard(changing=True):
            return
        path = urlsplit(self.path).path
        if path not in ('/api/connect', '/api/disconnect', '/api/sync', '/api/download'):
            return self.send_json({'error': 'Bilinmeyen işlem.'}, 404)
        if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            return self.send_json({'error': 'JSON gerekli.'}, 415)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > MAX_JSON_BODY:
                return self.send_json({'error': 'İstek çok büyük.'}, 413)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('JSON nesnesi bekleniyor.')
            if path == '/api/connect':
                manager.connect(str(body.get('cookie') or ''))
                return self.send_json({'connected': True})
            if path == '/api/disconnect':
                with manager.lock:
                    manager.session = None
                return self.send_json({'connected': False})
            if path == '/api/download':
                manager.start_download(body.get('ids'),body.get('format'))
                return self.send_json({'started':True},202)
            ids = body.get('playlistIds') or []
            if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(i, str) or not UUID_RE.fullmatch(i) for i in ids):
                raise ValueError('Playlist ID listesi geçersiz.')
            manager.sync(list(dict.fromkeys(ids)))
            return self.send_json({'started': True}, 202)
        except (ApiError, ValueError, json.JSONDecodeError) as exc:
            return self.send_json({'error': str(exc)}, 400)


def run_server(port=8080):
    if port < 1024 or port > 65535:
        raise ValueError('Port 1024-65535 arasında olmalı.')
    with ThreadingHTTPServer(('127.0.0.1', port), Handler) as server:
        print(f'EFSS Suno Collector: http://localhost:{port} [127.0.0.1 only]')
        print('Oturum bilgileri yalnızca RAM içinde. İndirmeler kullanıcı onayıyla ve Suno kota/erişim kurallarına tabidir.')
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nSunucu kapatıldı.')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='EFSS Suno local read-only catalog collector')
    parser.add_argument('--port', type=int, default=8080)
    run_server(parser.parse_args().port)