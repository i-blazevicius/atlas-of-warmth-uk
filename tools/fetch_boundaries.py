#!/usr/bin/env python3
"""Download the map's own area boundaries: LSOA 2021 (England and Wales, ONS, generalised) and data zone 2011 (Scotland).
Outputs gzipped GeoJSON / zip in --out."""
import argparse, gzip, json, subprocess, time
from pathlib import Path
import requests

H = {"User-Agent": "Mozilla/5.0 (portrait-of-a-nation data build)"}
ONS = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"


def find_service():
    j = requests.get(ONS, params={"f": "json"}, headers=H, timeout=120).json()
    names = [s["name"] for s in j.get("services", [])]
    print(len(names), "services;", [n for n in names if "lsoa" in n.lower() or "lower_layer" in n.lower()][:60])
    cands = [n for n in names if "Lower_layer_Super_Output_Areas" in n and "2021" in n and "BGC" in n]
    cands += [n for n in names if n.startswith("LSOA_2021") and "BGC" in n]
    for v in ("V5", "V4", "V3", "V2", ""):
        n = "Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC" + (f"_{v}" if v else "")
        if n not in cands:
            cands.append(n)
    n2 = [n for n in names if ("lsoa" in n.lower() or "lower_layer" in n.lower()) and "2021" in n and ("BGC" in n or "BSC" in n)]
    cands = n2 + cands
    print("candidates:", cands[:20])
    return cands


def fetch(service):
    url = f"{ONS}/{service}/FeatureServer/0/query"
    feats, off = [], 0
    while True:
        r = requests.get(url, params={"where": "1=1", "outFields": "*", "outSR": 27700, "f": "geojson",
                                      "resultOffset": off, "resultRecordCount": 2000}, headers=H, timeout=300)
        r.raise_for_status()
        f = r.json().get("features", [])
        feats += f
        off += len(f)
        print(" ", off, flush=True)
        if len(f) < 2000:
            break
        time.sleep(0.3)
    return feats


ap = argparse.ArgumentParser(); ap.add_argument("--out", default="out"); a = ap.parse_args()
out = Path(a.out); out.mkdir(exist_ok=True)
for s in find_service():
    try:
        f = fetch(s)
        if len(f) > 35000:
            with gzip.open(out / "lsoa21_bgc.geojson.gz", "wt") as fh:
                json.dump({"type": "FeatureCollection", "features": f}, fh)
            print("LSOA from", s, len(f)); break
    except Exception as e:  # noqa
        print("fail", s, e)
if not (out / "SG_DataZoneBdry_2011.zip").exists():
  subprocess.run(["curl", "-sL", "-o", str(out / "SG_DataZoneBdry_2011.zip"),
                "https://maps.gov.scot/ATOM/shapefiles/SG_DataZoneBdry_2011.zip"], check=True)
print(list(out.iterdir()))
