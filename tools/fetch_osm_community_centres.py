#!/usr/bin/env python3
"""
Step 1.1a: extract the full OSM history of community centres for the UK.

Pulls every version of every feature tagged as a community/social centre
(or later re-tagged with a disused:/was:/abandoned: lifecycle prefix) between
two dates from the ohsome API, as centroids with validity intervals.
All stock/closure/opening logic is done locally afterwards (script 02),
so one download answers every date pair.

Usage:
    pip install requests
    python tools/fetch_osm_community_centres.py --start 2015-01-01 --end 2025-01-01

Output: source/osm/osm_community_centres_<start>_<end>.jsonl (source/ is git-ignored)
        one GeoJSON feature per line (centroid point + tags + @validFrom/@validTo).

Notes
- Data (c) OpenStreetMap contributors, ODbL. Keep attribution on the final map.
- The UK bbox also catches the Republic of Ireland, Channel Islands and a bit of
  France/Belgium. Those are dropped later by the spatial join to UK MSOAs.
- If a request times out, rerun with a smaller --window-years; features that
  straddle windows are de-duplicated on (@osmId, @validFrom).
"""
import argparse
import json
import sys
import time
from pathlib import Path

import requests

API = "https://api.ohsome.org/v1/elementsFullHistory/centroid"

# Rough UK bounding box: min lon, min lat, max lon, max lat.
UK_BBOX = "-8.7,49.8,2.0,60.95"

CENTRE_VALUES = "(community_centre, social_centre)"
# Live tag plus the lifecycle tags a mapper uses when a centre closes.
FILTER = (
    f"amenity in {CENTRE_VALUES} or "
    f"disused:amenity in {CENTRE_VALUES} or "
    f"was:amenity in {CENTRE_VALUES} or "
    f"abandoned:amenity in {CENTRE_VALUES}"
)


def year_windows(start: str, end: str, step: int):
    y0, y1 = int(start[:4]), int(end[:4])
    tail = start[4:]
    for y in range(y0, y1, step):
        yield f"{y}{tail}", f"{min(y + step, y1)}{end[4:]}"


def fetch_window(t0: str, t1: str, out_fh, seen: set, retries: int = 3) -> int:
    data = {
        "bboxes": UK_BBOX,
        "filter": FILTER,
        "time": f"{t0},{t1}",
        "properties": "tags,metadata",
        "showMetadata": "true",
        "format": "geojson",
    }
    for attempt in range(1, retries + 1):
        try:
            with requests.post(API, data=data, stream=True, timeout=(30, 900)) as r:
                if r.status_code != 200:
                    raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
                body = r.json()
            break
        except (requests.RequestException, RuntimeError, ValueError) as exc:
            print(f"  attempt {attempt} failed: {exc}", file=sys.stderr)
            if attempt == retries:
                raise
            time.sleep(10 * attempt)
    n = 0
    for feat in body.get("features", []):
        p = feat["properties"]
        key = (p.get("@osmId"), p.get("@validFrom"))
        if key in seen:
            continue
        seen.add(key)
        out_fh.write(json.dumps(feat, ensure_ascii=False) + "\n")
        n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2015-01-01")
    ap.add_argument("--end", default="2025-01-01")
    ap.add_argument("--window-years", type=int, default=2)
    ap.add_argument("--out", default="source/osm")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"osm_community_centres_{args.start}_{args.end}.jsonl"

    seen: set = set()
    total = 0
    with out_path.open("w", encoding="utf-8") as fh:
        for t0, t1 in year_windows(args.start, args.end, args.window_years):
            print(f"window {t0} -> {t1} ...", flush=True)
            n = fetch_window(t0, t1, fh, seen)
            total += n
            print(f"  {n} feature versions", flush=True)
    print(f"done: {total} rows -> {out_path}")


if __name__ == "__main__":
    main()
