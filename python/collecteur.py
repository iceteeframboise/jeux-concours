#!/usr/bin/env python3
"""
Collecteur de jeux-concours (solution de secours si l'extension ne peut pas
lire une source directement).

Il n'utilise que Python 3 (aucune installation supplémentaire).

    python collecteur.py --verifier   # vérifie robots.txt, flux RSS et CGU de chaque source
    python collecteur.py              # collecte (1 passage par jour et par source maximum)
    python collecteur.py --serve      # collecte puis met concours.json à disposition de
                                      # l'extension sur http://127.0.0.1:8765/concours.json

Règles respectées :
  * robots.txt lu avant toute page (une source interdite n'est jamais téléchargée) ;
  * 1 passage par jour maximum par source, pause entre deux requêtes ;
  * le RSS est privilégié ; sinon lecture légère des liens d'une seule page.
Le fichier produit contient des éléments "bruts" (titre, lien, description) :
l'extension se charge du classement, des doublons et de l'exclusion des jeux payants.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from datetime import datetime
try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # Windows sans base de fuseaux : heure locale du PC
    PARIS = None
from html import unescape
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ICI = Path(__file__).resolve().parent
SOURCES_FILE = ICI / "sources.json"
STATE_FILE = ICI / "etat.json"
OUTPUT_FILE = ICI / "concours.json"
USER_AGENT = "JeuxConcoursPerso/0.3 (usage personnel, 1 passage par jour)"
ROBOT_NAME = "JeuxConcoursPerso"
MIN_INTERVAL = 20 * 3600     # ~1 passage par jour
RETRY_AFTER_ERROR = 3600
PAUSE = 2.0                  # secondes entre deux requêtes

DEFAULT_SOURCES = [
    {
        "id": "toutgagner",
        "name": "Toutgagner",
        "url": "https://www.toutgagner.com/",
        "kind": "auto",
        "enabled": True
    },
    {
        "id": "concours-fr",
        "name": "Concours.fr",
        "url": "https://www.concours.fr/feed/",
        "kind": "rss",
        "enabled": True
    },
    {
        "id": "concours-du-net",
        "name": "Concours du Net",
        "url": "https://www.concours-du-net.com/",
        "kind": "auto",
        "enabled": True
    },
    {
        "id": "concours-du-net-instagram",
        "name": "Concours du Net – Instagram",
        "url": "https://www.concours-du-net.com/concours-instagram",
        "kind": "page",
        "enabled": True
    },
    {
        "id": "lidl-plus",
        "name": "Lidl – jeux-concours Lidl Plus",
        "url": "https://www.lidl.fr/c/jeux-concours-lidl-plus/s10072468",
        "kind": "page",
        "enabled": True
    },
    {
        "id": "jeu-concours-biz",
        "name": "Jeu-Concours.biz",
        "url": "https://www.jeu-concours.biz/",
        "kind": "auto",
        "enabled": False
    },
    {
        "id": "coca-cola",
        "name": "Coca-Cola",
        "url": "https://www.coca-cola.com/fr/fr",
        "kind": "auto",
        "enabled": False
    },
    {
        "id": "dna",
        "name": "DNA",
        "url": "https://www.dna.fr/jeux-concours",
        "kind": "auto",
        "enabled": False
    },
    {
        "id": "estrepublicain",
        "name": "L'Est Républicain",
        "url": "https://www.estrepublicain.fr/jeux-concours",
        "kind": "auto",
        "enabled": False
    },
    {
        "id": "republicain-lorrain",
        "name": "Le Républicain Lorrain",
        "url": "https://www.republicain-lorrain.fr/jeux-concours",
        "kind": "auto",
        "enabled": False
    },
    {
        "id": "vosgesmatin",
        "name": "Vosges Matin",
        "url": "https://www.vosgesmatin.fr/jeux-concours",
        "kind": "auto",
        "enabled": False
    }
]


# ---------------------------------------------------------------- réseau
class Fetcher:
    def __init__(self, pause: float = PAUSE):
        self.pause = pause
        self.last_hit: dict[str, float] = {}
        self.robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    def get(self, url: str) -> tuple[int, str]:
        host = urllib.parse.urlsplit(url).netloc
        wait = self.last_hit.get(host, 0) + self.pause - time.time()
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "fr-FR,fr"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                charset = r.headers.get_content_charset() or "utf-8"
                return r.status, r.read().decode(charset, errors="replace")
        except urllib.error.HTTPError as e:
            return e.code, ""
        finally:
            self.last_hit[host] = time.time()

    def robots_allows(self, url: str) -> tuple[bool, str]:
        parts = urllib.parse.urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self.robots:
            try:
                status, text = self.get(origin + "/robots.txt")
            except Exception as e:  # réseau
                self.robots[origin] = None
                return False, f"robots.txt inaccessible ({e})"
            if 400 <= status < 500:
                rp = urllib.robotparser.RobotFileParser()
                rp.parse([])
            elif status >= 500 or status == 0:
                self.robots[origin] = None
                return False, f"robots.txt inaccessible ({status})"
            else:
                rp = urllib.robotparser.RobotFileParser()
                rp.parse(text.splitlines())
            self.robots[origin] = rp
            delay = rp.crawl_delay(ROBOT_NAME)
            if delay:
                self.pause = max(self.pause, float(delay))
        rp = self.robots[origin]
        if rp is None:
            return False, "robots.txt inaccessible"
        ok = rp.can_fetch(ROBOT_NAME, url)
        return ok, "autorisé par robots.txt" if ok else "interdit par robots.txt"


# ---------------------------------------------------------------- HTML / RSS
class LinkParser(HTMLParser):
    def __init__(self, base: str):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.feeds: list[str] = []
        self.anchors: list[dict] = []
        self._a: dict | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "link" and "alternate" in (a.get("rel") or "").lower() and \
                any(t in (a.get("type") or "").lower() for t in ("rss+xml", "atom+xml")):
            href = urllib.parse.urljoin(self.base, a.get("href") or "")
            if "comments" not in href:
                self.feeds.append(href)
        elif tag == "a" and a.get("href"):
            self._a = {"href": urllib.parse.urljoin(self.base, a["href"]), "text": ""}

    def handle_data(self, data):
        if self._a is not None:
            self._a["text"] += data

    def handle_endtag(self, tag):
        if tag == "a" and self._a is not None:
            self._a["text"] = " ".join(self._a["text"].split())
            self.anchors.append(self._a)
            self._a = None


def strip_tags(html: str) -> str:
    p = HTMLParser()
    out: list[str] = []
    p.handle_data = out.append  # type: ignore[method-assign]
    p.feed(html or "")
    return " ".join(" ".join(out).split())


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def parse_feed(xml_text: str, base: str) -> list[dict]:
    items = []
    root = ET.fromstring(xml_text.encode("utf-8"))
    for node in root.iter():
        if local(node.tag) not in ("item", "entry"):
            continue
        d = {"title": "", "link": "", "descriptionHtml": "", "pubDate": "", "categories": []}
        for child in node:
            name = local(child.tag)
            text = (child.text or "").strip()
            if name == "title":
                d["title"] = strip_tags(unescape(text))
            elif name == "link":
                href = child.get("href")
                if href and child.get("rel", "alternate") == "alternate":
                    d["link"] = d["link"] or href
                elif text:
                    d["link"] = d["link"] or text
            elif name in ("encoded", "description", "summary", "content") and not d["descriptionHtml"]:
                d["descriptionHtml"] = text
            elif name in ("pubdate", "published", "updated", "date") and not d["pubDate"]:
                d["pubDate"] = text
            elif name == "category":
                c = text or child.get("term") or ""
                if c:
                    d["categories"].append(c)
        if d["title"] and d["link"]:
            d["link"] = urllib.parse.urljoin(base, d["link"])
            d["description"] = strip_tags(d["descriptionHtml"])
            items.append(d)
    return items


HINT = ("concours", "gagne", "gagner", "a gagner", "à gagner", "tirage", "instant gagnant", "remporte", "/jeu")
# Liens de rubrique (« Concours Instagram », « Jeux concours gratuits »…) : ce ne sont pas des concours.
CATEGORY = re.compile(r"^(les |tous les |toutes les )?(jeux?[- ])?concours( gratuits?)?( (sur )?(facebook|instagram|tiktok|twitter|x|r[ée]seaux sociaux|du jour|en cours|qui finissent.*|quotidiens?|instants? gagnants?))?$")
NOISE = ("règlement", "reglement", "mentions légales", "cgu", "cookies", "connexion", "newsletter", "contact")


def page_links(html: str, base: str) -> list[dict]:
    p = LinkParser(base)
    p.feed(html)
    seen, items = set(), []
    for a in p.anchors:
        t = a["text"].lower()
        if not (15 <= len(t) <= 250) or any(n in t for n in NOISE) or CATEGORY.match(t):
            continue
        if not any(h in t or h in a["href"].lower() for h in HINT):
            continue
        if a["href"] in seen or not a["href"].startswith("http"):
            continue
        seen.add(a["href"])
        items.append({"title": a["text"], "link": a["href"], "description": "", "descriptionHtml": "", "categories": []})
    return items


def looks_like_feed(text: str) -> bool:
    head = text[:2000].lower()
    return "<rss" in head or "<feed" in head or "<rdf:rdf" in head


def collect_source(src: dict, f: Fetcher) -> tuple[list[dict], str]:
    ok, note = f.robots_allows(src["url"])
    if not ok:
        raise PermissionError(note)  # source non lue : signalée en ✗
    status, text = f.get(src["url"])
    if status >= 400:
        raise RuntimeError(f"HTTP {status}")
    if src.get("kind") == "rss" or looks_like_feed(text):
        return parse_feed(text, src["url"]), "flux RSS"
    if src.get("kind", "auto") == "auto":
        p = LinkParser(src["url"])
        p.feed(text)
        for feed in dict.fromkeys(p.feeds):
            if not f.robots_allows(feed)[0]:
                continue
            s2, t2 = f.get(feed)
            if s2 < 400 and looks_like_feed(t2):
                items = parse_feed(t2, feed)
                if items:
                    return items, f"flux RSS trouvé : {feed}"
    return page_links(text, src["url"]), "lecture légère de la page" + social_hints(text, src["url"])


def social_hints(html: str, base: str) -> str:
    """Repère (sans les visiter) les rubriques « concours Facebook / Instagram » de la page."""
    p = LinkParser(base)
    p.feed(html)
    host = urllib.parse.urlsplit(base).netloc
    found = []
    for a in p.anchors:
        t = (a["text"] + " " + a["href"]).lower()
        if urllib.parse.urlsplit(a["href"]).netloc == host and any(k in t for k in ("facebook", "instagram", "reseaux-sociaux", "réseaux sociaux")):
            if a["href"] not in found:
                found.append(a["href"])
    return f" · rubriques réseaux sociaux repérées : {', '.join(found[:5])}" if found else ""


# ---------------------------------------------------------------- fichiers
def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def load_sources() -> list[dict]:
    if not SOURCES_FILE.exists():
        SOURCES_FILE.write_text(json.dumps(DEFAULT_SOURCES, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Fichier {SOURCES_FILE.name} créé : modifiez-le pour activer/désactiver des sources.")
    return load_json(SOURCES_FILE, DEFAULT_SOURCES)


def same_day(a: float, b: float) -> bool:
    """1 passage par jour = une seule fois par jour du calendrier (heure de Paris)."""
    return datetime.fromtimestamp(a, PARIS).date() == datetime.fromtimestamp(b, PARIS).date()


def run_collect(fetcher: Fetcher | None = None, now: float | None = None) -> dict:
    now = now or time.time()
    fetcher = fetcher or Fetcher()
    state = load_json(STATE_FILE, {})
    previous = load_json(OUTPUT_FILE, {"items": []})
    by_source: dict[str, list] = {}
    for it in previous.get("items", []):
        by_source.setdefault(it.get("sourceId", "?"), []).append(it)

    sources = load_sources()
    enabled = {s["id"] for s in sources if s.get("enabled")}
    by_source = {k: v for k, v in by_source.items() if k in enabled}  # source décochée : on oublie ses concours
    for src in sources:
        if not src.get("enabled"):
            continue
        st = state.get(src["id"], {})
        last = st.get("lastRun")
        if last and (same_day(last, now) if st.get("ok", True) else now - last < RETRY_AFTER_ERROR):
            print(f"- {src['name']} : déjà collecté le {datetime.fromtimestamp(st['lastRun']):%d/%m à %H:%M}, on attend demain.")
            continue
        try:
            items, note = collect_source(src, fetcher)
            for it in items:
                it["sourceId"] = src["id"]
            by_source[src["id"]] = items
            state[src["id"]] = {"lastRun": now, "ok": True, "note": note, "count": len(items)}
            print(f"✓ {src['name']} : {len(items)} élément(s) – {note}")
        except Exception as e:  # noqa: BLE001
            state[src["id"]] = {"lastRun": now, "ok": False, "note": str(e)}
            print(f"✗ {src['name']} : {e}")

    out = {"generated": datetime.fromtimestamp(now).isoformat(timespec="seconds"),
           "items": [it for lst in by_source.values() for it in lst]}
    OUTPUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ {len(out['items'])} élément(s) dans {OUTPUT_FILE}")
    return out


def run_verify(fetcher: Fetcher | None = None) -> list[dict]:
    """Vérifie chaque source (même désactivée) sans rien collecter."""
    fetcher = fetcher or Fetcher()
    report = []
    for src in load_sources():
        line = {"source": src["name"], "url": src["url"]}
        try:
            ok, note = fetcher.robots_allows(src["url"])
            line["robots"] = note
            if ok:
                status, text = fetcher.get(src["url"])
                line["http"] = status
                if looks_like_feed(text):
                    line["rss"] = src["url"]
                else:
                    p = LinkParser(src["url"])
                    p.feed(text)
                    line["rss"] = ", ".join(dict.fromkeys(p.feeds)) or "aucun"
                    cgu = [a["href"] for a in p.anchors
                           if any(k in a["text"].lower() for k in ("cgu", "conditions", "mentions légales", "mentions legales"))]
                    line["cgu"] = cgu[0] if cgu else "lien non trouvé (cherchez en bas de page)"
        except Exception as e:  # noqa: BLE001
            line["erreur"] = str(e)
        report.append(line)
        print(f"\n■ {src['name']}  ({src['url']})")
        for k, v in line.items():
            if k not in ("source", "url"):
                print(f"    {k:7} : {v}")
    print("\nPensez à LIRE les CGU de chaque site : l'extension ne collecte que les sources que vous cochez.")
    return report


CGU_WORDS = re.compile(r"[^.]{0,160}\b(extraction|extraire|aspiration|aspirer|robots?|scraping|crawl\w*|moissonn\w*|"
                       r"collecte automatis\w*|automatis\w*|r[ée]utilisation|reproduction|copie)\b[^.]{0,160}", re.I)
CGU_LINK = ("cgu", "conditions g", "conditions d'utilisation", "mentions légales", "mentions legales", "legal")
CGU_PATHS = ("/cgu", "/conditions-generales-d-utilisation", "/conditions-generales-utilisation",
             "/mentions-legales", "/cgu-cgv", "/infos-legales")
CONTEST_LINK = ("jeu", "concours", "gagne", "tirage", "instant gagnant", "promo")


def run_discover(report_path: Path | None = None, fetcher: Fetcher | None = None) -> list[dict]:
    """Vérification détaillée de sources candidates (une requête par page, une seule fois).

    Pour chaque site : réponse, robots.txt, flux RSS, extrait des CGU sur la collecte
    automatique, nombre de concours visibles, et pour une marque ses pages « jeux »."""
    fetcher = fetcher or Fetcher(pause=1.0)
    report = []
    for src in load_sources():
        r = {"id": src["id"], "name": src["name"], "url": src["url"], "group": src.get("group", "")}
        try:
            ok, note = fetcher.robots_allows(src["url"])
            r["robots"] = note
            if not ok:
                continue
            status, text = fetcher.get(src["url"])
            r["http"] = status
            if status >= 400:
                continue
            p = LinkParser(src["url"])
            p.feed(text)
            r["rss"] = list(dict.fromkeys(p.feeds))[:3]
            r["concours_visibles"] = len(page_links(text, src["url"]))
            host = urllib.parse.urlsplit(src["url"]).netloc.replace("www.", "")
            r["pages_jeux"] = list(dict.fromkeys(
                a["href"] for a in p.anchors
                if host in urllib.parse.urlsplit(a["href"]).netloc
                and any(k in (a["text"] + " " + urllib.parse.urlsplit(a["href"]).path).lower() for k in CONTEST_LINK)
                and len(a["text"]) < 60))[:6]
            # Lien des CGU : dans la page, sinon adresses habituelles (certains sites le cachent derrière un bouton).
            liens = [a["href"] for a in p.anchors
                     if a["href"].startswith("http") and any(k in a["text"].lower() for k in CGU_LINK)]
            origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(src["url"]))
            liens += [origin + chemin for chemin in CGU_PATHS]
            r["cgu"] = None
            for cgu in dict.fromkeys(liens):
                if not fetcher.robots_allows(cgu)[0]:
                    continue
                cs, ct = fetcher.get(cgu)
                texte = strip_tags(ct)
                if cs < 400 and re.search(r"conditions|mentions l[ée]gales|propri[ée]t[ée] intellectuelle", texte, re.I):
                    r["cgu"] = cgu
                    r["cgu_extraits"] = [" ".join(m.group(0).split()) for m in CGU_WORDS.finditer(texte)][:6]
                    break
        except Exception as e:  # noqa: BLE001
            r["erreur"] = str(e)[:120]
        finally:
            report.append(r)
            print("RAPPORT " + json.dumps(r, ensure_ascii=False), flush=True)
    if report_path:
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path.split("?")[0] != "/concours.json":
            self.send_error(404)
            return
        body = OUTPUT_FILE.read_bytes() if OUTPUT_FILE.exists() else b'{"items": []}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(description="Collecteur de jeux-concours pour l'extension.")
    ap.add_argument("--verifier", action="store_true", help="vérifier robots.txt / RSS / CGU des sources")
    ap.add_argument("--decouvrir", type=Path, metavar="RAPPORT.json", help="vérification détaillée de sources candidates")
    ap.add_argument("--serve", action="store_true", help="servir concours.json sur 127.0.0.1 pour l'extension")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--sources", type=Path, help="fichier de sources à utiliser (par défaut python/sources.json)")
    args = ap.parse_args(argv)
    if args.sources:
        global SOURCES_FILE
        SOURCES_FILE = args.sources.resolve()
    if args.verifier:
        run_verify()
        return
    if args.decouvrir:
        run_discover(args.decouvrir)
        return
    run_collect()
    if args.serve:
        srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)  # local uniquement
        print(f"Extension : cochez la source « Script Python » (http://127.0.0.1:{args.port}/concours.json).")
        print("Laissez cette fenêtre ouverte. Ctrl+C pour arrêter. Nouvelle collecte toutes les 24 h.")
        last = time.time()
        srv.timeout = 60
        try:
            while True:
                srv.handle_request()
                if time.time() - last > MIN_INTERVAL:
                    run_collect()
                    last = time.time()
        except KeyboardInterrupt:
            print("\nArrêt.")


if __name__ == "__main__":
    sys.exit(main())
