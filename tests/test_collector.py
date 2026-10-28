"""No real account/network requests; mock Suno API to check pagination and safety."""
import importlib.util
import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('efss_collector', ROOT / 'collector.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class FakeSuno:
    def __init__(self):
        self.calls = []
    def api(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path == '/api/feed/v3':
            cursor = payload['cursor']
            if not cursor:
                return {'clips': [{'id': 'one', 'title': '1'}], 'has_more': True, 'next_cursor':'second'}
            return {'clips': [{'id': 'two', 'title': '2'}], 'has_more': False}
        if path == '/api/playlist/abc/?page=1':
            return {'name': 'Test', 'num_total_results': 3,
                    'playlist_clips': [{'clip': {'id':'a'}, 'relative_index':2},
                                       {'clip': {'id':'b'}, 'relative_index':1}]}
        if path == '/api/playlist/abc/?page=2':
            return {'num_total_results': 3,
                    'playlist_clips': [{'clip': {'id':'c'}, 'relative_index':3}]}
        return {}


class CollectorTests(unittest.TestCase):
    def test_feed_pages_all(self):
        s = FakeSuno()
        result = collector.feed_pages(s, {})
        self.assertEqual(list(result), ['one', 'two'])
        self.assertEqual(len(s.calls), 2)

    def test_cursor_cycle_raises(self):
        class Repeat(FakeSuno):
            def api(self, method, path, payload=None):
                return {'clips':[{'id':'same'}], 'has_more': True, 'next_cursor':'repeat'}
        with self.assertRaises(collector.ApiError):
            collector.feed_pages(Repeat(), {})

    def test_playlist_full_pagination_and_order(self):
        d, songs, warning = collector.playlist_details(FakeSuno(), 'abc')
        self.assertEqual(d['name'], 'Test')
        self.assertEqual([s['id'] for s in songs], ['b', 'a', 'c'])
        self.assertIsNone(warning)

    def test_playlist_incomplete_warns(self):
        class Short(FakeSuno):
            def api(self, method, path, payload=None):
                return {'num_total_results': 8, 'playlist_clips': []}
        _, songs, warning = collector.playlist_details(Short(), 'abc')
        self.assertEqual(songs, [])
        self.assertIn('0/8', warning)

    def test_merge_preserves_rich_metadata(self):
        rec = collector.merge_record({'id':'x', 'metadata':{'tags':'Folk'}, '_workspaces':['One']},
                                     {'id':'x','metadata':{}, '_workspaces':['Two']})
        self.assertEqual(rec['metadata']['tags'], 'Folk')
        self.assertEqual(rec['_workspaces'], ['One', 'Two'])

    def test_cookie_validation(self):
        for c in ('', 'hello', 'password@example.com', '\nmalicious', 'x'*9000):
            with self.assertRaises(ValueError):
                collector.SunoSession(c)

    def test_local_server_origin_and_static_security(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), collector.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_port
        try:
            conn = HTTPConnection('127.0.0.1', port)
            conn.request('GET', '/api/status', headers={'Host': f'localhost:{port}'})
            r = conn.getresponse()
            self.assertEqual(r.status, 200)
            self.assertIn('connected', r.read().decode())
            conn.request('GET', '/collector.py', headers={'Host': f'localhost:{port}'})
            self.assertEqual(conn.getresponse().status, 404)
            conn.close()
            conn = HTTPConnection('127.0.0.1', port)
            conn.request('POST','/api/disconnect', body='{}',
                         headers={'Host':f'localhost:{port}','Content-Type':'application/json','Origin':'https://evil.example'})
            self.assertEqual(conn.getresponse().status, 403)
            conn.close()
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()