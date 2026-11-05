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
for name, default in (("concours.json", '{"generated": null, "items": []}'), ("etat.json", "{}")):
    src = ROOT / "python" / name
    (out / "data" / name).write_text(src.read_text(encoding="utf-8") if src.exists() else default, encoding="utf-8")
(out / ".nojekyll").write_text("")
print(f"Site assemblé dans {out}")
