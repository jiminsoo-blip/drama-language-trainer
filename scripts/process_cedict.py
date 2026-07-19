#!/usr/bin/env python3
"""Convert CC-CEDICT text dump into a compact JSON map for the drama trainer app.

Input line format:  Traditional Simplified [pin1 yin1] /def1/def2/
Output JSON: { "_meta": {...}, "data": { simplified: [numberedPinyin, "def1|def2"] } }
"""
import json
import re
import sys
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])

LINE_RE = re.compile(r"^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+/(.+)/$")

data = {}
with SRC.open("r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = LINE_RE.match(line)
        if not m:
            continue
        _trad, simp, pinyin, defs = m.groups()
        def_list = [d for d in defs.split("/") if d][:2]
        if not def_list:
            continue
        # Keep first reading if a word appears multiple times with same simplified form
        if simp not in data:
            data[simp] = [pinyin, "|".join(def_list)]

payload = {
    "_meta": {
        "source": "CC-CEDICT (https://cc-cedict.org/wiki/)",
        "license": "CC BY-SA 4.0",
        "format": "key = simplified word, value = [numbered pinyin, 'def1|def2']",
        "entries": len(data),
    },
    "data": data,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

size_mb = OUT.stat().st_size / (1024 * 1024)
print(f"entries={len(data)} size={size_mb:.2f}MB out={OUT}")
