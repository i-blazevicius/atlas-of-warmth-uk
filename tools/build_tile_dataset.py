#!/usr/bin/env python3
"""
Put every map layer on the map's own areas, so all layers line up with each other and with the
existing deprivation / fuel poverty / EPC data:
  lsoa21  England and Wales LSOA 2021
  dz11    Scotland data zone 2011
  soa11   Northern Ireland SOA (same codes as the map's NI tiles)

Input: the output of build_map_dataset.py run on those areas (community spaces and charities are counted
directly from points) plus the population per area from the census layer.
Business counts only exist for larger areas (2011 MSOA, 2001 intermediate zone, council), so each larger area's
counts are shared among its tiles by 2021/22 population (method = apportioned_*). Summing the tiles back gives
the published count, and % change is the same in every tile of one parent area.

Usage: python tools/build_tile_dataset.py --map-dir source/map_data_tiles --census source/census_data/census_changes_zone.csv.gz \
          --tile-lookup source/map_data/tile_lookup.csv
"""
import argparse
import json
from pathlib import Path

import pandas as pd

COLS = ["area_code", "area_level", "window", "layer", "category", "source", "quality", "method",
        "stock_a", "stock_b", "gains", "losses", "gains_raw", "losses_raw"]


def tile_level(code):
    c = str(code)
    if c[:1] in "EW":
        return "lsoa21"
    if c[:1] == "S":
        return "dz11"
    return "soa11"


def share(rows, parent_col, tiles):
    """rows: biz rows keyed by parent area_code; tiles: tile_code, parent, pop."""
    t = tiles.dropna(subset=[parent_col]).copy()
    t["w"] = t["pop"] / t.groupby(parent_col)["pop"].transform("sum")
    x = rows.merge(t[["tile_code", parent_col, "w"]], left_on="area_code", right_on=parent_col)
    for c in ("stock_a", "stock_b"):
        x[c] = (x[c] * x.w).round(3)
    return x.drop(columns=["area_code"]).rename(columns={"tile_code": "area_code"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map-dir", default="source/map_data_tiles")
    ap.add_argument("--census", default="source/census_data/census_changes_zone.csv.gz")
    ap.add_argument("--tile-lookup", default="source/map_data/tile_lookup.csv")
    a = ap.parse_args()
    d = Path(a.map_dir)
    z = pd.read_csv(d / "area_changes_zone.csv", dtype={"area_code": str})
    lad = pd.read_csv(d / "area_changes_lad.csv", dtype={"area_code": str})
    tl = pd.read_csv(a.tile_lookup, dtype=str)
    c = pd.read_csv(a.census, usecols=["area_code", "topic", "grain", "total_b"])
    pop = c[(c.topic == "ethnic") & (c.grain == "broad")].drop_duplicates("area_code").set_index("area_code").total_b
    tl["pop"] = tl.tile_code.map(pop).fillna(0) + 1e-6

    direct = z[z.layer.isin(["cs", "char"])].copy()
    direct["area_level"] = direct.area_code.map(tile_level)
    direct["method"] = "counted"

    biz = z[z.layer == "biz"]
    parts = [direct]
    e = share(biz[biz.area_level == "msoa11"], "msoa11", tl[tl.tile_level == "lsoa21"])
    e["area_level"], e["method"], e["quality"] = "lsoa21", "apportioned_from_msoa11", "low"
    s = share(biz[biz.area_level == "iz01"], "iz01", tl[tl.tile_level == "dz11"])
    s["area_level"], s["method"], s["quality"] = "dz11", "apportioned_from_iz01", "low"
    nb = lad[(lad.layer == "biz") & lad.area_code.str.startswith("N")]
    n = share(nb, "lad26", tl[tl.tile_level == "soa11"])
    n["area_level"], n["method"], n["quality"] = "soa11", "apportioned_from_council", "very_low"
    parts += [e, s, n]
    out = pd.concat(parts, ignore_index=True)
    for col in COLS:
        if col not in out:
            out[col] = pd.NA
    out = out[COLS]
    out.to_csv(d / "area_changes_tile.csv", index=False)
    (d / "area_changes_zone.csv").unlink()
    lad["method"] = "published"
    lad[COLS].to_csv(d / "area_changes_lad.csv", index=False)

    meta = json.loads((d / "categories.json").read_text())
    meta["rules"]["area_levels"] = ["lsoa21", "dz11", "soa11", "lad26"]
    meta["files"] = {"area_changes_tile.csv": "every layer on the map's own areas (lsoa21, dz11, soa11)",
                     "area_changes_lad.csv": "council level (lad26), published or summed counts"}
    meta["methods"] = {
        "counted": "points counted directly into the area",
        "apportioned_from_msoa11": "business counts for a 2011 MSOA shared among its LSOAs by 2021 population",
        "apportioned_from_iz01": "business counts for a 2001 intermediate zone shared among its data zones by 2022 population",
        "apportioned_from_council": "Northern Ireland business counts for a council shared among its SOAs by 2021 population",
        "published": "as published / summed"}
    meta["notes"]["biz"] = ("UK Business Counts local units, rounded to 5 at source. On the map's areas they are shared out by population: "
                            "% change equals that of the parent area, and counts are estimates (fractional). Show biz change at the parent "
                            "or council level when a precise count matters. Northern Ireland has council-level data only.")
    (d / "categories.json").write_text(json.dumps(meta, indent=2))
    for f in ("lookup_dz11_to_iz01.csv",):
        if (d / f).exists():
            (d / f).unlink()
    print(out.groupby(["layer", "area_level", "method"]).size().to_string())
    # checks: shares add back to published totals
    chk = out[(out.layer == "biz") & (out.window == "2016-2024")].groupby("area_level")[["stock_a", "stock_b"]].sum()
    print(chk.round(0))


if __name__ == "__main__":
    main()
