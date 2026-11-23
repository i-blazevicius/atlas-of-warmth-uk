#!/usr/bin/env python3
"""Bulk postcode lookup with postcodes.io (100 per request). Output columns:
postcode, lat, lon, country, msoa21, lsoa21, lad_code (current district as reported), data_zone (Scotland)."""
import argparse
import csv
import time

import requests

URL = "https://api.postcodes.io/postcodes"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    pcs = [l.strip() for l in open(a.inp, encoding="utf-8") if l.strip()]
    found = 0
    with open(a.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["postcode", "lat", "lon", "country", "msoa21", "lsoa21", "lad_code", "data_zone"])
        for i in range(0, len(pcs), 100):
            chunk = pcs[i:i + 100]
            for attempt in range(5):
                try:
                    r = requests.post(URL, json={"postcodes": chunk}, timeout=60)
                    if r.status_code == 200:
                        break
                    print("HTTP", r.status_code, "attempt", attempt + 1, flush=True)
                except requests.RequestException as e:
                    print("error", e, flush=True)
                time.sleep(5 * (attempt + 1))
            else:
                raise SystemExit("giving up at batch %d" % i)
            for item in r.json().get("result", []):
                res = item.get("result")
                if not res:
                    continue
                codes = res.get("codes", {})
                w.writerow([item["query"], res.get("latitude"), res.get("longitude"), res.get("country"),
                            codes.get("msoa"), codes.get("lsoa"), codes.get("admin_district"),
                            codes.get("lsoa") if False else res.get("data_zone", "")])
                found += 1
            if (i // 100) % 20 == 0:
                print(f"{i + len(chunk)}/{len(pcs)} done, {found} found", flush=True)
            time.sleep(0.2)
    print("done:", found, "of", len(pcs))


if __name__ == "__main__":
    main()
