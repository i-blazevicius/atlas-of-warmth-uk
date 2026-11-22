#!/usr/bin/env python3
"""
Step 1.2a: UK Business Counts (Nomis dataset NM_141_1, local units) for the categories
that stand for community life: pubs, religious organisations, other membership
organisations, libraries and sports clubs. One tidy row per area, year and industry.

Nomis serves every year on the current area geography, so the same 2021 MSOAs hold the
counts for 2015 and 2025 and no crosswalk is needed. Scottish intermediate zones are
fetched too. There is no small-area Northern Ireland data in this dataset.

Usage (from the repo root):
    pip install requests
    python tools/fetch_nomis_business_counts.py --years 2010-2026

Output: source/nomis/business_counts_local_units.csv  (source/ is git-ignored)
    year, area_code, area_type, industry, sic, count, status
`status` is Nomis's note on the figure (blank = normal; "Q" = missing or suppressed).
Counts of workplaces registered for VAT and/or PAYE: small unregistered groups are missing.
Contains public sector information licensed under the Open Government Licence v3.0.
"""
import argparse
import csv
import io
import time
from pathlib import Path

import requests

BASE = "https://www.nomisweb.co.uk/api/v01/dataset/NM_141_1.data.csv"
H = {"User-Agent": "Mozilla/5.0 (portrait-of-a-nation data build)"}

# Nomis's own ids for the SIC 2007 5-digit lines (looked up from its industry list).
INDUSTRIES = {
    "pubs": ("56302", "134274030"),
    "religious_organisations": ("94910", "134312638"),
    "other_membership_organisations": ("94990", "134312718"),
    "libraries": ("91011", "134308739"),
    "sport_clubs": ("93120", "134310848"),
}
AREA_TYPES = {"TYPE152": "msoa21", "TYPE317": "iz_scotland"}


def fetch(geography: str, industry_id: str, year: int, retries: int = 4) -> str:
    params = {
        "geography": geography,
        "industry": industry_id,
        "employment_sizeband": 0,  # total
        "legal_status": 0,  # total
        "measures": 20100,  # value
        "date": year,
        "select": "date_name,geography_code,obs_value,obs_status",
    }
    for attempt in range(1, retries + 1):
        r = requests.get(BASE, params=params, headers=H, timeout=180)
        if r.status_code == 200:
            return r.text
        print(f"  {geography} {industry_id} {year}: HTTP {r.status_code}, attempt {attempt}", flush=True)
        time.sleep(5 * attempt)
    raise SystemExit(f"giving up on {geography} {industry_id} {year}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2010-2026", help="e.g. 2010-2026 or 2015,2020,2025")
    ap.add_argument("--out", default="source/nomis")
    args = ap.parse_args()

    if "-" in args.years:
        a, b = args.years.split("-")
        years = list(range(int(a), int(b) + 1))
    else:
        years = [int(y) for y in args.years.split(",")]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    path = out / "business_counts_local_units.csv"
    n = 0
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["year", "area_code", "area_type", "industry", "sic", "count", "status"])
        for geog, label in AREA_TYPES.items():
            for name, (sic, nid) in INDUSTRIES.items():
                for year in years:
                    text = fetch(geog, nid, year)
                    rows = list(csv.DictReader(io.StringIO(text)))
                    for r in rows:
                        w.writerow([r["DATE_NAME"], r["GEOGRAPHY_CODE"], label, name, sic, r["OBS_VALUE"], r["OBS_STATUS"]])
                    n += len(rows)
                    print(f"{label} {name} {year}: {len(rows)} rows", flush=True)
                    time.sleep(0.5)
    print(f"done: {n} rows -> {path}")


if __name__ == "__main__":
    main()
