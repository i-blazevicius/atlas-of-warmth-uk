#!/usr/bin/env python3
"""
Step 1.1a: OSM community centres across the UK, as they stood on 1 January of each year.

For each date, asks the Overpass API (which keeps OSM's history) for every feature tagged
amenity=community_centre / social_centre, plus those carrying a disused:/was:/abandoned:
amenity tag (how mappers mark a closed centre). Works out nothing: stock, closures and
openings are computed afterwards by tools/build_community_closures.py.

(The ohsome full-history API was tried first and rejects a UK-wide request as too large.)

Usage:
    pip install requests
    python tools/fetch_osm_community_centres.py --start 2015 --end 2025

Output: source/osm/osm_community_centres_snapshots.jsonl (source/ is git-ignored)
        one line per feature per date:
        {"date": "2015-01-01", "osm_id": "node/123", "lat": .., "lon": .., "tags": {...}}
        (ways and relations use Overpass's centre point)

Data (c) OpenStreetMap contributors, ODbL. Keep that attribution on the finished map.
"""
import argparse
import json
import time
from pathlib import Path

import requests

ENDPOINT = "https://overpass-api.de/api/interpreter"
H = {"User-Agent": "portrait-of-a-nation data build (github.com/i-blazevicius/portrait-of-a-nation)"}
UK_RELATION = 62149  # the United Kingdom; area ids are the relation id + 3600000000

VALUES = "^(community_centre|social_centre)$"
KEYS = ("amenity", "disused:amenity", "was:amenity", "abandoned:amenity")


def query(date: str) -> str:
    parts = "\n".join(f'  nwr["{k}"~"{VALUES}"](area.uk);' for k in KEYS)
    return (
        f'[out:json][timeout:600][date:"{date}T00:00:00Z"];\n'
        f"area({3600000000 + UK_RELATION})->.uk;\n(\n{parts}\n);\nout center tags qt;"
    )


def fetch(date: str, retries: int = 6) -> list:
    for attempt in range(1, retries + 1):
        try:
            r = requests.post(ENDPOINT, data={"data": query(date)}, headers=H, timeout=(30, 900))
            if r.status_code == 200:
                return r.json()["elements"]
            print(f"  {date}: HTTP {r.status_code}, attempt {attempt}: {r.text[:200]!r}", flush=True)
        except (requests.RequestException, ValueError) as exc:
            print(f"  {date}: {exc}, attempt {attempt}", flush=True)
        time.sleep(30 * attempt)
    raise SystemExit(f"giving up on {date}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=2015)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--out", default="source/osm")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    path = out / "osm_community_centres_snapshots.jsonl"
    total = 0
    with path.open("w", encoding="utf-8") as fh:
        for year in range(args.start, args.end + 1):
            date = f"{year}-01-01"
            elements = fetch(date)
            n = 0
            for e in elements:
                c = e if e["type"] == "node" else e.get("center")
                if not c:
                    continue
                fh.write(
                    json.dumps(
                        {
                            "date": date,
                            "osm_id": f'{e["type"]}/{e["id"]}',
                            "lat": c["lat"],
                            "lon": c["lon"],
                            "tags": e.get("tags", {}),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                n += 1
            total += n
            print(f"{date}: {n} features", flush=True)
            time.sleep(10)  # be kind to the public server
    print(f"done: {total} rows -> {path}")


if __name__ == "__main__":
    main()
