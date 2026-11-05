#!/usr/bin/env python3
"""Fabrique dist/jeux-concours-<version>.xpi (le fichier d'installation pour Firefox).

Un .xpi est simplement un ZIP du dossier extension/, avec manifest.json à la racine.
    python3 tools/build_xpi.py
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
version = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))["version"]
out = ROOT / "dist" / f"jeux-concours-{version}.xpi"
out.parent.mkdir(exist_ok=True)
for old in out.parent.glob("jeux-concours-*.xpi"):
    old.unlink()
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(EXT.rglob("*")):
        if f.is_file() and not f.name.startswith("."):
            z.write(f, f.relative_to(EXT).as_posix())
print(f"Créé : {out.relative_to(ROOT)} ({out.stat().st_size // 1024} Ko)")
