#!/usr/bin/env python3
"""Charities that look like community spaces from the Scottish (OSCR) and Northern Ireland (CCNI) registers.
Same name rules as prepare_charity_candidates.py (candidate list, not a census).
OSCR: active + removed exports, both with postcodes; removed ones carry a Ceased Date (real losses).
CCNI: no postcode in the details export; only an address (town) is available, and removed charities carry no date,
so NI contributes gains only, placed by town.
Usage: python tools/prepare_charity_candidates_sc_ni.py --sc-active A.csv --sc-removed R.csv --ni N.csv --out source/charity
"""
import argparse
import re
from pathlib import Path

import pandas as pd

from prepare_charity_candidates import classify, GROUP


def pc_clean(s):
    return s.str.upper().str.replace(r"\s+", " ", regex=True).str.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc-active", required=True)
    ap.add_argument("--sc-removed", required=True)
    ap.add_argument("--ni", required=True)
    ap.add_argument("--out", default="source/charity")
    a = ap.parse_args()
    out = Path(a.out)
    parts = []
    for path, status in ((a.sc_active, "Registered"), (a.sc_removed, "Removed")):
        d = pd.read_csv(path, dtype=str)
        d["space_type"] = d["Charity Name"].map(classify)
        d = d[d.space_type.notna()].copy()
        parts.append(pd.DataFrame({
            "organisation_number": d["Charity Number"], "charity_name": d["Charity Name"], "country": "Scotland",
            "charity_registration_status": status,
            "reg_date": pd.to_datetime(d["Registered Date"], format="%d/%m/%Y", errors="coerce"),
            "rem_date": pd.to_datetime(d.get("Ceased Date"), format="%d/%m/%Y", errors="coerce") if status == "Removed" else pd.NaT,
            "reason": d.get("Reason For Removal"), "postcode": pc_clean(d.Postcode), "place": d["Main Operating Location"],
            "space_type": d.space_type, "space_group": d.space_type.map(GROUP)}))
    sc = pd.concat(parts, ignore_index=True)
    sc.to_csv(out / "candidates_sc.csv", index=False)
    sc[sc.postcode.notna()].postcode.drop_duplicates().to_csv(out / "postcodes_sc.txt", index=False, header=False)
    n = pd.read_csv(a.ni, dtype=str)
    n["space_type"] = n["Charity name"].map(classify)
    n = n[n.space_type.notna()].copy()
    addr = n["Public address"].fillna("")
    parts = addr.str.split(",").map(lambda p: [x.strip() for x in p if x.strip()])
    ni = pd.DataFrame({
        "organisation_number": n["Reg charity number"], "charity_name": n["Charity name"], "country": "Northern Ireland",
        "charity_registration_status": n.Status.map(lambda s: "Removed" if s == "Removed" else "Registered"),
        "reg_date": pd.to_datetime(n["Date registered"], format="%d/%m/%Y", errors="coerce"),
        "rem_date": pd.NaT, "address": addr,
        "postcode": addr.str.extract(r"(BT\d{1,2}\s*\d[A-Z]{2})", flags=re.I)[0].str.upper(),
        "town": parts.map(lambda p: next((x for x in reversed(p) if not re.match(r"(?i)^(co\.?|county)\b", x)
                                          and not re.match(r"(?i)^bt\d", x)), "")),
        "space_type": n.space_type, "space_group": n.space_type.map(GROUP)})
    ni.to_csv(out / "candidates_ni.csv", index=False)
    ni[["town"]].drop_duplicates().to_csv(out / "towns_ni.txt", index=False, header=False)
    print("Scotland", len(sc), sc.groupby("charity_registration_status").size().to_dict(), "unique postcodes",
          sc.postcode.nunique())
    print("NI", len(ni), ni.charity_registration_status.value_counts().to_dict(), "towns", ni.town.nunique())


if __name__ == "__main__":
    main()
