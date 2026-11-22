#!/usr/bin/env python3
"""
Step 1.1 (local part): turn yearly OSM snapshots of community centres into
stock / closures / openings per small area, for any pair of dates.

Input  : the .jsonl from tools/fetch_osm_community_centres.py (one line per feature per
         1 January)
Zones  : one or more boundary files, one per nation, given as PATH::CODE_FIELD::LABEL
         (England and Wales 2021 MSOAs, Scotland 2022 intermediate zones, Northern Ireland
         2011 SOAs). Each centre is placed in exactly one zone, by its coordinates.
Local authorities (optional): one UK-wide boundary file; the roll-up is made from the
         centres themselves, so it needs no zone-to-authority lookup.

Usage (from the repo root):
    pip install geopandas pandas pyogrio
    python tools/build_community_closures.py \
        --features source/osm/osm_community_centres_snapshots.jsonl \
        --zones "source/boundaries/MSOA_2021_BGC.gpkg::CODE::msoa21" \
               "source/boundaries/SG_IntermediateZoneBdry_2022_EoR.shp::IZCode::iz22" \
               "source/boundaries/SOA2011.shp::SOA_CODE::soa11" \
        --lad source/boundaries/LAD_2026_BGC.gpkg --lad-code LAD26CD --lad-name LAD26NM \
        --pairs 2015-2025 2020-2025

Output (source/derived/ by default; git-ignored until reviewed):
    community_centres_zones.csv          one row per zone and pair
    community_centres_lad.csv            one row per local authority and pair (if --lad)
    community_centres_zones_<pair>.gpkg  zone polygons with the metrics, for QGIS

How a feature is classed on a date (a "pair" is date A -> date B, both 1 January):
    active  : tagged amenity=community_centre / social_centre on that date
    closed  : carries a disused:/was:/abandoned: amenity tag instead
    absent  : not in that date's snapshot (deleted, or re-tagged to something else)
Counts per area:
    stock_a, stock_b   active at A / at B
    persisting         active at both
    closures_tagged    active at A, mapped as closed at B (explicit lifecycle tag)
    closures_removed   active at A, absent at B
    closures           the two above added together
    openings           active at B, not active at A
    closure_pct        closures / stock_a * 100, left blank where stock_a < --min-stock

Known limits, kept in the output on purpose:
  * openings include real places that were simply mapped late, so openings and net
    change are the least reliable columns; closures as a share of stock_a is the core measure.
  * a place mapped twice (a node and a building) counts twice; de-duplication comes later.
  * "removed" can be a deletion of a mistake or a duplicate as well as a real closure, which
    is why tagged closures are kept apart.
  * zones are different sizes and vintages in each nation (see the zone_type column), so
    compare areas within a nation, or use the local authority roll-up for the UK view.
"""
import argparse
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

CENTRE = {"community_centre", "social_centre"}
LIFECYCLE_KEYS = ("disused:amenity", "was:amenity", "abandoned:amenity")
BNG = "EPSG:27700"
COAST_TOLERANCE_M = 500  # centres just off a generalised coastline still get an area


def load_snapshots(path: Path) -> pd.DataFrame:
    rows = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            f = json.loads(line)
            tags = f.get("tags", {})
            if tags.get("amenity") in CENTRE:
                state = "active"
            elif any(tags.get(k) in CENTRE for k in LIFECYCLE_KEYS):
                state = "closed"
            else:
                continue  # in the snapshot only because of some other tag: not ours
            rows.append(
                {
                    "date": f["date"],
                    "osm_id": f["osm_id"],
                    "state": state,
                    "lon": f["lon"],
                    "lat": f["lat"],
                }
            )
    df = pd.DataFrame(rows)
    if df.empty:
        raise SystemExit("no features read from " + str(path))
    # a feature can appear twice on a date if it carries both an active and a lifecycle tag: active wins
    df["rank"] = df["state"].map({"active": 0, "closed": 1})
    df = df.sort_values(["date", "osm_id", "rank"]).drop_duplicates(["date", "osm_id"]).drop(columns="rank")
    return df.reset_index(drop=True)


def state_on(df: pd.DataFrame, date: str, all_ids) -> pd.Series:
    """State of every osm_id on a snapshot date: active / closed / absent."""
    if date not in set(df["date"]):
        raise SystemExit(f"no snapshot for {date}; available: {sorted(set(df['date']))}")
    s = df[df["date"] == date].set_index("osm_id")["state"]
    return s.reindex(all_ids).fillna("absent")


def pair_metrics(df, all_ids, a_date, b_date):
    a = state_on(df, a_date, all_ids)
    b = state_on(df, b_date, all_ids)
    out = pd.DataFrame(
        {
            "stock_a": (a == "active"),
            "stock_b": (b == "active"),
            "persisting": (a == "active") & (b == "active"),
            "closures_tagged": (a == "active") & (b == "closed"),
            "closures_removed": (a == "active") & (b == "absent"),
            "openings": (a != "active") & (b == "active"),
        }
    )
    return out.astype(int)


def parse_pair(text: str):
    ya, yb = text.split("-")
    return f"{ya}-01-01", f"{yb}-01-01"


def read_polygons(path: str, code_field: str, label: str = None) -> gpd.GeoDataFrame:
    g = gpd.read_file(path)
    if code_field not in g.columns:
        raise SystemExit(f"{path}: no column {code_field}; columns are {list(g.columns)}")
    g = g.to_crs(BNG)
    g["geometry"] = g.geometry.make_valid()
    g = g[[code_field, "geometry"]].rename(columns={code_field: "code"})
    if label:
        g["zone_type"] = label
    return g


def place_points(pts: gpd.GeoDataFrame, polys: gpd.GeoDataFrame) -> pd.Series:
    """Code of the polygon each point falls in; points just outside get the nearest within tolerance."""
    inside = gpd.sjoin(pts, polys[["code", "geometry"]], how="left", predicate="within")
    inside = inside[~inside.index.duplicated(keep="first")]
    code = inside["code"].copy()
    missing = code[code.isna()].index
    if len(missing):
        near = gpd.sjoin_nearest(
            pts.loc[missing], polys[["code", "geometry"]], how="left", max_distance=COAST_TOLERANCE_M
        )
        near = near[~near.index.duplicated(keep="first")]
        code.loc[near.index] = near["code"]
    return code


def with_pct(frame: pd.DataFrame, min_stock: int) -> pd.DataFrame:
    frame["closures"] = frame["closures_tagged"] + frame["closures_removed"]
    frame["closure_pct"] = (frame["closures"] / frame["stock_a"] * 100).where(
        frame["stock_a"] >= min_stock
    ).round(1)
    return frame


COUNT_COLS = ["stock_a", "stock_b", "persisting", "closures_tagged", "closures_removed", "openings"]


def aggregate(per_point: pd.DataFrame, area: pd.Series, all_codes: pd.Series, min_stock: int):
    m = per_point.copy()
    m["code"] = area.reindex(m.index)
    m = m.dropna(subset=["code"])
    counts = m.groupby("code")[COUNT_COLS].sum()
    counts = counts.reindex(all_codes).fillna(0).astype(int)
    counts.index.name = "code"
    return with_pct(counts, min_stock).reset_index()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", required=True)
    ap.add_argument("--zones", nargs="+", required=True, help="PATH::CODE_FIELD::LABEL, one per nation")
    ap.add_argument("--lad", help="UK local authority boundaries (optional)")
    ap.add_argument("--lad-code", default="LAD26CD")
    ap.add_argument("--lad-name", default="LAD26NM")
    ap.add_argument("--pairs", nargs="+", default=["2015-2025", "2020-2025"])
    ap.add_argument("--min-stock", type=int, default=3)
    ap.add_argument("--out", default="source/derived")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    df = load_snapshots(Path(args.features))
    all_ids = pd.Index(df["osm_id"].unique())
    per_date = df.groupby("date")["state"].value_counts().unstack(fill_value=0)
    print("features per snapshot:\n" + per_date.to_string())

    # one location per feature: from the latest snapshot it appears in
    loc = df.sort_values("date").groupby("osm_id").last()[["lon", "lat"]]
    pts = gpd.GeoDataFrame(
        loc, geometry=gpd.points_from_xy(loc["lon"], loc["lat"]), crs="EPSG:4326"
    ).to_crs(BNG)

    parts = []
    for spec in args.zones:
        path, field, label = spec.split("::")
        parts.append(read_polygons(path, field, label))
        print(f"zones {label}: {len(parts[-1])} from {path}")
    zones = pd.concat(parts, ignore_index=True)
    if zones["code"].duplicated().any():
        raise SystemExit("zone codes are not unique across the files")
    zones = gpd.GeoDataFrame(zones, crs=BNG)

    zone_of = place_points(pts, zones)
    print(f"{zone_of.isna().sum()} of {len(zone_of)} features fall in no zone (sea, Ireland, Channel Islands...): ignored")

    lad_of = lad_names = lad_codes = None
    if args.lad:
        lads = read_polygons(args.lad, args.lad_code)
        names = gpd.read_file(args.lad)[[args.lad_code, args.lad_name]].drop_duplicates()
        lad_names = names.rename(columns={args.lad_code: "code", args.lad_name: "name"})
        lad_of = place_points(pts, lads)
        lad_codes = lads["code"].drop_duplicates()

    zone_rows, lad_rows = [], []
    for text in args.pairs:
        a_date, b_date = parse_pair(text)
        per_point = pair_metrics(df, all_ids, a_date, b_date)

        z = aggregate(per_point, zone_of, zones["code"], args.min_stock)
        z = z.merge(zones[["code", "zone_type"]], on="code", how="left")
        z.insert(1, "pair", text)
        zone_rows.append(z)
        zones.merge(z.drop(columns="zone_type"), on="code", how="left").to_file(
            out / f"community_centres_zones_{text}.gpkg", driver="GPKG"
        )

        if lad_of is not None:
            lr = aggregate(per_point, lad_of, lad_codes, args.min_stock)
            lr = lr.merge(lad_names, on="code", how="left")
            lr.insert(1, "pair", text)
            lad_rows.append(lr)

        tot = per_point.sum()
        print(f"{text}: stock {tot.stock_a} -> {tot.stock_b}, closures {tot.closures_tagged + tot.closures_removed} "
              f"({tot.closures_tagged} tagged, {tot.closures_removed} removed), openings {tot.openings}")

    pd.concat(zone_rows).rename(columns={"code": "zone_code"}).to_csv(
        out / "community_centres_zones.csv", index=False
    )
    if lad_rows:
        pd.concat(lad_rows).rename(columns={"code": "lad_code"}).to_csv(
            out / "community_centres_lad.csv", index=False
        )
    print(f"written to {out}/")


if __name__ == "__main__":
    main()
