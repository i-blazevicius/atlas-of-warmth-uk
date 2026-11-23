#!/usr/bin/env python3
"""Add Scotland (OSCR, gains and losses) and Northern Ireland (CCNI, gains only) charity rows to the council pack.
Reads source/charity/candidates_sc.csv + postcodes_sc_geocoded.csv, candidates_ni.csv, and a council pack folder;
replaces any char rows outside England and Wales in area_changes_lad.csv and appends new ones."""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from ni_town_council import council

WINDOWS = ["2022-2025", "2020-2025", "2018-2025", "2015-2025"]


def conversions(c):
    c = c.copy()
    c["name_key"] = c.charity_name.str.lower().str.replace(r"[^a-z0-9]", "", regex=True)
    rem = c[c.charity_registration_status == "Removed"][["name_key", "rem_date", "organisation_number"]]
    reg = c[c.reg_date.notna()][["organisation_number", "name_key", "reg_date"]]
    m = reg.merge(rem, on="name_key", suffixes=("", "_old"))
    m = m[(m.organisation_number != m.organisation_number_old) &
          ((m.reg_date - m.rem_date).abs() <= pd.Timedelta(days=366))]
    c["is_conversion"] = c.organisation_number.isin(set(m.organisation_number)) | \
        c.organisation_number.isin(set(m.organisation_number_old))
    return c


def rows(c, source, quality, losses):
    out = []
    for w in WINDOWS:
        ya, yb = (int(v) for v in w.split("-"))
        s, e = pd.Timestamp(f"{ya}-01-01"), pd.Timestamp(f"{yb}-01-01")
        live = lambda t: c[(c.reg_date <= t) & (c.rem_date.isna() | (c.rem_date > t))]
        if not losses:  # NI: removal dates unknown, so stock is of charities still registered today
            live = lambda t: c[(c.reg_date <= t) & (c.charity_registration_status == "Registered")]
        parts = {"stock_b": live(e), "gains": c[(c.reg_date > s) & (c.reg_date <= e) & ~c.is_conversion &
                                                 (c.charity_registration_status == "Registered")
                                                 | (c.reg_date > s) & (c.reg_date <= e) & ~c.is_conversion & losses],
                 "gains_raw": c[(c.reg_date > s) & (c.reg_date <= e)]}
        if losses:
            parts["stock_a"] = live(s)
            lo = c[(c.rem_date > s) & (c.rem_date <= e)]
            parts["losses"] = lo[~lo.is_conversion]
            parts["losses_raw"] = lo
        f = pd.concat({k: v.groupby(["lad_code", "space_type"]).size() for k, v in parts.items()}, axis=1)
        f = f.fillna(0).astype(int).reset_index().rename(columns={"lad_code": "area_code"})
        for col in ("stock_a", "losses", "losses_raw"):
            if col not in f:
                f[col] = np.nan
        f["window"], f["area_level"], f["layer"] = w, "lad26", "char"
        f["category"], f["source"], f["quality"] = "char." + f.space_type, source, quality
        out.append(f)
    d = pd.concat(out)
    return d[["area_code", "area_level", "window", "layer", "category", "source", "quality", "stock_a", "stock_b",
              "gains", "losses", "gains_raw", "losses_raw"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--charity-dir", default="source/charity")
    ap.add_argument("--pack", default="source/map_data_council")
    a = ap.parse_args()
    cd, pack = Path(a.charity_dir), Path(a.pack)
    sc = pd.read_csv(cd / "candidates_sc.csv", dtype=str, parse_dates=["reg_date", "rem_date"])
    g = pd.read_csv(cd / "postcodes_sc_geocoded.csv")
    sc = sc.merge(g[["postcode", "lad_code"]], on="postcode", how="left")
    sc = sc[sc.lad_code.fillna("").str.startswith("S")]
    sc = conversions(sc)
    ni = pd.read_csv(cd / "candidates_ni.csv", dtype=str, parse_dates=["reg_date"])
    ni["rem_date"] = pd.NaT
    ni["lad_code"] = ni.town.map(council)
    ni = ni[ni.groupby("address").organisation_number.transform("size") < 10]  # umbrella HQ addresses
    ni = ni[ni.lad_code.notna()]
    ni = conversions(ni)
    new = pd.concat([rows(sc, "oscr_register", "medium", True), rows(ni, "ccni_register", "low", False)])
    p = pack / "area_changes_lad.csv"
    old = pd.read_csv(p, dtype={"area_code": str})
    keep = ~((old.layer == "char") & ~old.area_code.str[0].isin(["E", "W"]))
    out = pd.concat([old[keep], new], ignore_index=True)
    out.to_csv(p, index=False)
    sc_p = sc[(sc.charity_registration_status == "Registered")]
    pts = pd.read_csv(pack / "spaces_points.csv")
    print("Scotland placed", len(sc), "NI placed", len(ni), "char councils",
          out[out.layer == "char"].area_code.nunique())
    print(new.groupby(["source", "window"])[["stock_b", "gains", "losses"]].sum())


if __name__ == "__main__":
    main()
