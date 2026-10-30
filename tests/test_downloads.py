"""No real Suno requests: check download safety and archive behavior."""
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import downloads as d

ID="550e8400-e29b-41d4-a716-446655440000"
SONG={"id":ID,"title":"Track / Version","created_at":"2026-10-14T12:30:00Z",
      "audio_url":f"https://cdn1.suno.ai/{ID}.mp3"}

class DummyResponse:
    def __init__(self, body):
        self.data = io.BytesIO(body)
        self.headers={"Content-Length":str(len(body)), "Content-Type":"audio/mpeg"}
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read(self,size): return self.data.read(size)
    def geturl(self): return SONG["audio_url"]

class DummyOpener:
    def __init__(self,data): self.data = data
    def open(self,request,timeout=None): return DummyResponse(self.data)

class Tests(unittest.TestCase):
    def test_url_enforcement(self):
        for url in ("https://127.0.0.1/a.mp3","http://cdn1.suno.ai/a.mp3",
                    "https://cdn1.suno.ai.evil.com/x", "file:///etc/passwd",
                    "https://u:p@cdn1.suno.ai/a.mp3", "https://cdn1.suno.ai:444/a.mp3",
                    "https://cdn1.suno.ai:0/a.mp3", "https://cdn1.suno.ai:invalid/a.mp3",
                    "https://[malformed/a.mp3"):
            with self.subTest(url=url),self.assertRaises(d.DownloadError): d.verified_url(url)
        self.assertEqual(d.verified_url(SONG["audio_url"]),SONG["audio_url"])

    def test_selection(self):
        self.assertEqual(d.validate_queue([ID,ID],"mp3",{ID:SONG}),[ID])
        for ids,fmt in (([],"mp3"),([ID],"flac"),(["../bad"],"mp3"),([ID]*251,"wav")):
            with self.assertRaises(ValueError): d.validate_queue(ids,fmt,{ID:SONG})

    def test_download_checksum_and_resume(self):
        data=b"ID3"+b"\0"*4096
        with tempfile.TemporaryDirectory() as base:
            root=Path(base)
            manifest={"files":{}}
            with patch.object(d,"OPENER",DummyOpener(data)):
                mode,record=d.export_one(None,SONG,"mp3",root,manifest)
            self.assertEqual(mode,"downloaded")
            self.assertEqual(record["bytes"],len(data))
            self.assertEqual(len(record["sha256"]),64)
            d.save_manifest(root/"manifest.json",manifest)
            self.assertEqual(d.read_manifest(root/"manifest.json")["files"][ID]["mp3"]["sha256"],record["sha256"])
            with patch.object(d,"stream_audio",side_effect=AssertionError("should not redownload")):
                mode,_=d.export_one(None,SONG,"mp3",root,manifest)
            self.assertEqual(mode,"already")

    def test_corrupt_manifest_entry_triggers_fresh_download(self):
        data = b"ID3" + b"\0" * 2048
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            manifest = {"files": {ID: {"mp3": "invalid manifest record"}}}
            self.assertFalse(d.verify_file(root / "missing.mp3", "invalid manifest record"))
            with patch.object(d, "OPENER", DummyOpener(data)):
                mode, record = d.export_one(None, SONG, "mp3", root, manifest)
            self.assertEqual(mode, "downloaded")
            self.assertEqual(record["bytes"], len(data))
            self.assertTrue(d.verify_file(root / record["file"], record))

    def test_invalid_audio_removed(self):
        with tempfile.TemporaryDirectory() as base:
            file=Path(base)/"song.mp3"
            with patch.object(d,"OPENER",DummyOpener(b"<html>"+b" "*5000)):
                with self.assertRaisesRegex(d.DownloadError,"MP3"): d.stream_audio(SONG["audio_url"],file)
            self.assertFalse(file.exists())
            self.assertFalse(Path(str(file)+".part").exists())

    def test_path_sanitizing(self):
        self.assertNotIn("/",d.safe_name(SONG,"mp3"))
        with self.assertRaises(d.DownloadError): d.safe_name({"id":"../../x","title":"x"},"mp3")

    def test_wav_requires_explicit_api_post(self):
        class Session:
            def __init__(self): self.called=[]
            def api(self,method,path,payload=None):
                self.called.append(method)
                return {"wav_file_url":f"https://cdn1.suno.ai/{ID}.wav"}
        s=Session()
        self.assertTrue(d.wav_url(s,ID).endswith(".wav"))
        self.assertEqual(s.called,["POST"])

if __name__=="__main__": unittest.main()
