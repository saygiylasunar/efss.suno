import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from downloads import media_inventory, preflight_sources, source_host
from collector import Manager

class MediaInventoryTests(unittest.TestCase):
    def test_hostname_only_and_formats(self):
        songs=[{'audio_url':'https://other.example/media.mp3?token=SECRET','wav_url':'https://cdn1.suno.ai/a.wav'},
               {'audio_url':'https://audiopipe.suno.ai/stream?id=ABC','m4a_url':'https://media.example/a.m4a',
                'video_url':'https://videos.example/clip.mp4'}]
        inv=media_inventory(songs)
        self.assertEqual(inv['totalSongs'],2)
        self.assertEqual(inv['formats']['mp3']['present'],2)
        self.assertEqual(inv['formats']['m4a']['present'],1)
        self.assertEqual(inv['formats']['wav']['present'],1)
        self.assertEqual(inv['formats']['mp4']['present'],1)
        self.assertNotIn('SECRET', str(inv))
        self.assertNotIn('/stream', str(inv))
    def test_bad_hosts_rejected_before_batch(self):
        catalog={'song1':{'audio_url':'https://bad.example/a.mp3'},
                 'song2':{'audio_url':'https://cdn1.suno.ai/a.mp3'}}
        ok, bad=preflight_sources(['song1','song2'],'mp3',catalog)
        self.assertEqual(ok,['song2'])
        self.assertEqual(bad,['song1'])
        self.assertEqual(source_host('https://bad.example/a.mp3?secret'), 'bad.example')
    def test_stop_queue_flag(self):
        manager=Manager()
        manager.download_busy=True
        result=manager.cancel_download()
        self.assertTrue(result['requested'])
        self.assertTrue(manager.download_cancel.is_set())
        self.assertEqual(manager.status()['downloadProgress']['stage'],'Durduruluyor...')
if __name__=='__main__': unittest.main()
