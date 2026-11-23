#!/usr/bin/env python3
"""Download one Nomis census table at one small-area geography, in long form (area, category, count).

Usage:  python tools/fetch_nomis_census.py --dataset NM_522_1 --geography TYPE299 --out out.csv.gz
Nomis returns at most 25,000 rows per call, so the script pages with recordoffset.
Columns written: area_code, cat_dim, cat_code, cat_name, value
Contains public sector information licensed under the Open Government Licence v3.0.
"""
import argparse
import csv
import gzip
import io
import json
import time

import requests

H = {"User-Agent": "Mozilla/5.0 (portrait-of-a-nation data build)"}
B = "https://www.nomisweb.co.uk/api/v01/dataset/"
SKIP = {"geography", "time", "freq", "measures", "rural_urban", "date"}


def get(url, params=None, tries=5):
    for i in range(1, tries + 1):
        try:
            r = requests.get(url, params=params, headers=H, timeout=300)
            if r.status_code == 200:
                return r.text
            print(f"  HTTP {r.status_code} (try {i})", flush=True)
        except Exception as e:  # noqa
            print(f"  error {e} (try {i})", flush=True)
        time.sleep(5 * i)
    raise SystemExit("giving up")


def dims(ds):
    kf = json.loads(get(B + ds + ".def.sdmx.json"))["structure"]["keyfamilies"]["keyfamily"][0]
    out = [d["conceptref"] for d in kf["components"]["dimension"]]
    print("dimensions:", out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--geography", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--allow-empty", action="store_true")
    a = ap.parse_args()
    cat = [d for d in dims(a.dataset) if d.lower() not in SKIP]
    print("category dimensions:", cat)
    sel = ["geography_code"] + [f"{c}_code" for c in cat] + [f"{c}_name" for c in cat] + ["obs_value"]
    params = {"geography": a.geography, "measures": 20100, "select": ",".join(sel), "recordlimit": 25000}
    if any(d.lower() == "rural_urban" for d in dims(a.dataset)):
        params["rural_urban"] = 0
    n, off = 0, 0
    with gzip.open(a.out, "wt", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["area_code", "cat_dim", "cat_code", "cat_name", "value"])
        while True:
            params["recordoffset"] = off
            rows = list(csv.DictReader(io.StringIO(get(B + a.dataset + ".data.csv", params))))
            if not rows:
                break
            for r in rows:
                for c in cat[:1]:  # one category dimension per table
                    w.writerow([r["GEOGRAPHY_CODE"], c, r[f"{c.upper()}_CODE"], r[f"{c.upper()}_NAME"], r["OBS_VALUE"]])
            n += len(rows)
            off += len(rows)
            if n % 500000 < 25000:
                print(f"  {n} rows", flush=True)
            if len(rows) < 25000:
                break
            time.sleep(0.3)
    print(f"done: {n} rows -> {a.out}")
    if n == 0 and not a.allow_empty:
        raise SystemExit("no rows returned")


if __name__ == "__main__":
    main()
