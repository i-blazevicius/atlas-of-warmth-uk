#!/usr/bin/env python3
"""
Step 1.1a: community centres in OpenStreetMap as they stood on 1 January of each year.

Source: Geofabrik's dated extracts (great-britain-YY0101.osm.pbf and
ireland-and-northern-ireland-YY0101.osm.pbf, ODbL). Needs the `osmium` command-line tool
(apt install osmium-tool) and shapely. The all-UK Overpass route was dropped: the public
server returned empty answers for whole-UK historic queries.

Kept: amenity=community_centre|social_centre, plus the lifecycle forms
disused:/was:/abandoned: amenity (a tagged closure). The Republic of Ireland part of the
island extract is dropped later, when points are placed into UK zones.

Usage:  python tools/fetch_osm_community_centres.py --start 2015 --end 2025
Output: source/osm/osm_community_centres_snapshots.jsonl, one line per feature per date:
        {"date","osm_id","lat","lon","tags"}   (osm_id like n123 / w456 / r789)
"""
import argparse
import json
import subprocess
import urllib.request
from pathlib import Path

from shapely.geometry import shape

REGIONS = ["great-britain", "ireland-and-northern-ireland"]
FILTERS = [f"nwr/{k}={v}" for k in ("amenity", "disused:amenity", "was:amenity", "abandoned:amenity")
           for v in ("community_centre", "social_centre")]
VALUES = {"community_centre", "social_centre"}
KEYS = ("amenity", "disused:amenity", "was:amenity", "abandoned:amenity")


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=2015)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--years", help="comma list, overrides start/end, e.g. 2015,2020,2025")
    ap.add_argument("--out", default="source/osm")
    args = ap.parse_args()
    years = [int(y) for y in args.years.split(",")] if args.years else range(args.start, args.end + 1)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "tmp"
    tmp.mkdir(exist_ok=True)
    path = out / "osm_community_centres_snapshots.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for year in years:
            date = f"{year}-01-01"
            n_year = 0
            for region in REGIONS:
                src = tmp / f"{region}-{year}.osm.pbf"
                url = f"https://download.geofabrik.de/europe/{region}-{str(year)[2:]}0101.osm.pbf"
                print(f"{date} {region}: downloading {url}", flush=True)
                urllib.request.urlretrieve(url, src)
                filt = tmp / "filtered.osm.pbf"
                gj = tmp / "filtered.geojsonseq"
                run(["osmium", "tags-filter", "--overwrite", "-o", str(filt), str(src), *FILTERS])
                run(["osmium", "export", "--overwrite", "-f", "geojsonseq", "-o", str(gj), str(filt)])
                src.unlink()
                with gj.open(encoding="utf-8") as g:
                    for line in g:
                        line = line.strip().lstrip("\x1e")
                        if not line:
                            continue
                        f = json.loads(line)
                        tags = f.get("properties") or {}
                        if not any(tags.get(k) in VALUES for k in KEYS):
                            continue
                        try:
                            p = shape(f["geometry"]).representative_point()
                        except Exception:
                            continue
                        fh.write(json.dumps({"date": date, "osm_id": str(f.get("id", "")),
                                             "lat": round(p.y, 6), "lon": round(p.x, 6),
                                             "tags": tags}, ensure_ascii=False) + "\n")
                        n_year += 1
            fh.flush()
            print(f"{date}: {n_year} features", flush=True)
    print("done ->", path)


if __name__ == "__main__":
    main()
