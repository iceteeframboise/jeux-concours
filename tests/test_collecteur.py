"""Tests du script Python (python -m unittest discover -s tests)."""
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
import collecteur  # noqa: E402

RSS = (Path(__file__).parent / "fixtures" / "flux.xml").read_text(encoding="utf-8")
HITS = []


class Site(BaseHTTPRequestHandler):
    pages = {}

    def do_GET(self):  # noqa: N802
        HITS.append(self.path)
        if self.path not in self.pages:
            self.send_error(404)
            return
        body = self.pages[self.path].encode()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class CollecteurTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), Site)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_port}"
        Site.pages = {
            "/robots.txt": "User-agent: *\nDisallow: /interdit\n",
            "/": '<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head>'
                 '<a href="/mentions">Mentions légales</a><a href="/jeux-concours">Nos jeux</a></html>',
            "/mentions": "<h1>Mentions légales</h1><p>Toute extraction automatisée du contenu par des robots est interdite. Contact.</p>",
            "/feed": RSS,
            "/interdit": "<a href='/x'>Gagnez une voiture neuve</a>",
            "/page": "<a href='/jeux/1'>Gagnez un séjour en Alsace pour deux</a><a href='/contact'>Contact</a>"
                     "<a href='/concours-instagram'>Concours Instagram</a><a href='https://facebook.com/x'>Facebook</a>",
        }

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        collecteur.SOURCES_FILE = self.tmp / "sources.json"
        collecteur.STATE_FILE = self.tmp / "etat.json"
        collecteur.OUTPUT_FILE = self.tmp / "concours.json"
        collecteur.SOURCES_FILE.write_text(json.dumps([
            {"id": "rss", "name": "RSS", "url": self.base + "/", "kind": "auto", "enabled": True},
            {"id": "non", "name": "Interdit", "url": self.base + "/interdit", "kind": "page", "enabled": True},
            {"id": "page", "name": "Page", "url": self.base + "/page", "kind": "page", "enabled": True},
        ]))
        HITS.clear()

    def test_collecte_et_rythme(self):
        out = collecteur.run_collect(collecteur.Fetcher(pause=0), now=1_000_000)
        ids = [i["sourceId"] for i in out["items"]]
        self.assertEqual(ids.count("rss"), 5)
        self.assertEqual(ids.count("page"), 1)
        self.assertNotIn("non", ids)
        self.assertNotIn("/interdit", HITS, "page interdite par robots.txt jamais téléchargée")
        etat = json.loads(collecteur.STATE_FILE.read_text())
        self.assertFalse(etat["non"]["ok"])
        self.assertEqual(etat["non"]["note"], "interdit par robots.txt")
        self.assertEqual(out["items"][0]["title"], "Jeu concours Sony : gagnez une PS5 et 2 manettes")
        etat = json.loads(collecteur.STATE_FILE.read_text())
        self.assertIn(self.base + "/concours-instagram", etat["page"]["note"])
        self.assertNotIn("facebook.com", etat["page"]["note"])
        # 2e passage 1 h plus tard : rien n'est re-téléchargé, les éléments sont conservés
        HITS.clear()
        out2 = collecteur.run_collect(collecteur.Fetcher(pause=0), now=1_000_000 + 3600)
        self.assertEqual(len(out2["items"]), 6)
        self.assertEqual([h for h in HITS if h != "/robots.txt"], [])

    def test_verifier(self):
        rep = collecteur.run_verify(collecteur.Fetcher(pause=0))
        self.assertEqual(rep[0]["rss"], self.base + "/feed")
        self.assertTrue(rep[0]["cgu"].endswith("/mentions"))
        self.assertEqual(rep[1]["robots"], "interdit par robots.txt")


    def test_decouvrir(self):
        rep = collecteur.run_discover(None, collecteur.Fetcher(pause=0))
        self.assertEqual(rep[0]["rss"], [self.base + "/feed"])
        self.assertIn(self.base + "/jeux-concours", rep[0]["pages_jeux"])
        self.assertIn("extraction automatisée", rep[0]["cgu_extraits"][0])
        self.assertEqual(rep[1]["robots"], "interdit par robots.txt")

    def test_un_passage_par_jour_calendaire(self):
        soir = 1_700_000_000  # 14/11/2023 23:13 à Paris
        self.assertTrue(collecteur.same_day(soir - 3600, soir))
        self.assertFalse(collecteur.same_day(soir, soir + 3600))


if __name__ == "__main__":
    unittest.main()
