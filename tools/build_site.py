#!/usr/bin/env python3
"""Assemble le site dans _site/ : pages de site/, logique de extension/lib/,
données de python/concours.json et python/etat.json (si présents).
    python3 tools/build_site.py [dossier_de_sortie]
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
if out.exists():
    shutil.rmtree(out)
shutil.copytree(ROOT / "site", out)
shutil.copytree(ROOT / "extension" / "lib", out / "lib")
(out / "data").mkdir()
import json
actives = {s["id"] for s in json.loads((ROOT / "site" / "sources.json").read_text(encoding="utf-8")) if s.get("enabled")}
def lire(name, default):
    src = ROOT / "python" / name
    try:
        return json.loads(src.read_text(encoding="utf-8")) if src.exists() else default
    except ValueError:
        return default
# Seules les sources actives sont publiées (une source désactivée disparaît aussitôt).
concours = lire("concours.json", {"generated": None, "items": []})
concours["items"] = [i for i in concours.get("items", []) if i.get("sourceId") in actives]
etat = {k: v for k, v in lire("etat.json", {}).items() if k in actives}
(out / "data" / "concours.json").write_text(json.dumps(concours, ensure_ascii=False), encoding="utf-8")
(out / "data" / "etat.json").write_text(json.dumps(etat, ensure_ascii=False, indent=1), encoding="utf-8")
(out / ".nojekyll").write_text("")
print(f"Site assemblé dans {out}")
