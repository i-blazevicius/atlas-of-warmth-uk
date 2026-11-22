#!/usr/bin/env python3
"""
Step 1.1 (local part): turn the OSM history of community centres into
stock / closures / openings per MSOA, for any pair of dates.

Input  : the .jsonl from tools/fetch_osm_community_centres.py
Boundaries: 2021 MSOAs (England and Wales), e.g. the ONS BGC .gpkg (code column CODE)
Lookup : ONS OA21 -> LSOA21 -> MSOA21 -> LAD22 csv (for the local authority roll-up)

Usage (from the repo root):
    pip install geopandas pandas pyogrio
    python tools/build_community_closures.py \
        --features source/osm/osm_community_centres_2015-01-01_2025-01-01.jsonl \
        --msoa source/boundaries/MSOA_2021_BGC.gpkg \
        --lookup source/lookups/OA21_LSOA21_MSOA21_LAD22.csv \
        --pairs 2015-2025 2020-2025

Output (source/derived/ by default; git-ignored until reviewed):
    community_centres_msoa.csv   one row per MSOA and pair
    community_centres_lad.csv    the same, rolled up to local authority (counts summed,
                                 percentage recomputed from the sums, never averaged)
    community_centres_msoa_<pair>.gpkg   MSOA polygons with the metrics, for QGIS

How a feature is classed at a date (a "pair" is date A -> date B, both 1 January):
    active  : tagged amenity=community_centre / social_centre at that date
    closed  : carries a disused:/was:/abandoned: amenity tag instead
    absent  : no matching version at that date (deleted, or re-tagged to something else)
Counts per area:
    stock_a, stock_b   active at A / at B
    persisting         active at both
    closures_tagged    active at A, mapped as closed at B (explicit lifecycle tag)
    closures_removed   active at A, absent at B
    closures           the two above added together
    openings           active at B, not active at A
    closure_pct        closures / stock_a * 100, left blank where stock_a < --min-stock
Features that disappear again after less than --min-lifespan-days are dropped from
every count: they are almost always mapping mistakes or duplicates, not real closures.

Known limits, kept in the output on purpose:
  * openings include real places that were simply mapped late, so openings and net
    change are the least reliable columns; closures as a share of stock_a is the core measure.
  * a place mapped twice (a node and a building) counts twice; de-duplication comes later.
"""
import argparse
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

CENTRE = {"community_centre", "social_centre"}
LIFECYCLE_KEYS = ("disused:amenity", "was:amenity", "abandoned:amenity")
BNG = "EPSG:27700"


def load_features(path: Path) -> pd.DataFrame:
    rows = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            f = json.loads(line)
            p = f["properties"]
            g = f.get("geometry")
            if not g or g.get("type") != "Point":
                continue
            amenity = p.get("amenity")
            if amenity in CENTRE:
                state = "active"
            elif any(p.get(k) in CENTRE for k in LIFECYCLE_KEYS):
                state = "closed"
            else:
                state = "other"
            rows.append(
                {
                    "osm_id": p["@osmId"],
                    "valid_from": p["@validFrom"],
                    "valid_to": p["@validTo"],
                    "state": state,
                    "lon": g["coordinates"][0],
                    "lat": g["coordinates"][1],
                }
            )
    df = pd.DataFrame(rows)
    if df.empty:
        raise SystemExit("no features read from " + str(path))
    df["valid_from"] = pd.to_datetime(df["valid_from"], utc=True)
    df["valid_to"] = pd.to_datetime(df["valid_to"], utc=True)
    return df.sort_values(["osm_id", "valid_from"]).reset_index(drop=True)


def state_at(df: pd.DataFrame, when: pd.Timestamp, data_end: pd.Timestamp) -> pd.Series:
    """State of every osm_id at `when`: active / closed / absent."""
    # a version that runs to the end of the extract is still current
    vt = df["valid_to"].where(df["valid_to"] < data_end, pd.Timestamp.max.tz_localize("UTC"))
    hit = df[(df["valid_from"] <= when) & (when < vt)]
    s = hit.groupby("osm_id")["state"].last()
    s = s.replace({"other": "absent"})
    return s.reindex(df["osm_id"].unique()).fillna("absent")


def drop_ephemeral(df: pd.DataFrame, data_end: pd.Timestamp, min_days: int) -> pd.DataFrame:
    active = df[df["state"] == "active"].copy()
    active["days"] = (active["valid_to"].clip(upper=data_end) - active["valid_from"]).dt.days
    total = active.groupby("osm_id")["days"].sum()
    last_to = df.groupby("osm_id")["valid_to"].max()
    ceased = last_to < data_end
    ephemeral = ceased & (total.reindex(last_to.index).fillna(0) < min_days)
    drop = set(ephemeral[ephemeral].index)
    return df[~df["osm_id"].isin(drop)], len(drop)


def pair_metrics(df, a_date, b_date, data_end):
    a = state_at(df, a_date, data_end)
    b = state_at(df, b_date, data_end)
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
    return pd.Timestamp(f"{ya}-01-01", tz="UTC"), pd.Timestamp(f"{yb}-01-01", tz="UTC")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", required=True)
    ap.add_argument("--msoa", required=True)
    ap.add_argument("--msoa-code", default="CODE")
    ap.add_argument("--lookup", required=True)
    ap.add_argument("--pairs", nargs="+", default=["2015-2025", "2020-2025"])
    ap.add_argument("--min-stock", type=int, default=3)
    ap.add_argument("--min-lifespan-days", type=int, default=365)
    ap.add_argument("--out", default="source/derived")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    df = load_features(Path(args.features))
    data_end = df["valid_to"].max()
    df, n_drop = drop_ephemeral(df, data_end, args.min_lifespan_days)
    print(f"{df['osm_id'].nunique()} features kept, {n_drop} short-lived ones dropped")

    # one location per feature: the latest version's
    loc = df.groupby("osm_id").last()[["lon", "lat"]]
    pts = gpd.GeoDataFrame(
        loc, geometry=gpd.points_from_xy(loc["lon"], loc["lat"]), crs="EPSG:4326"
    ).to_crs(BNG)

    msoa = gpd.read_file(args.msoa)[[args.msoa_code, "geometry"]].rename(
        columns={args.msoa_code: "msoa21cd"}
    )
    if msoa.crs is None or msoa.crs.to_string() != BNG:
        msoa = msoa.to_crs(BNG)
    joined = gpd.sjoin(pts, msoa, how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]
    area_of = joined["msoa21cd"]
    outside = area_of.isna().sum()
    print(f"{outside} features fall outside England and Wales MSOAs (Scotland, NI, Ireland, sea): ignored here")

    lk = pd.read_csv(args.lookup, encoding="utf-8-sig", usecols=["MSOA21CD", "LAD22CD", "LAD22NM"])
    lk = lk.drop_duplicates("MSOA21CD").rename(
        columns={"MSOA21CD": "msoa21cd", "LAD22CD": "lad22cd", "LAD22NM": "lad22nm"}
    )

    all_msoa = msoa[["msoa21cd"]].drop_duplicates()
    msoa_rows, lad_rows = [], []
    for text in args.pairs:
        a_date, b_date = parse_pair(text)
        m = pair_metrics(df, a_date, b_date, data_end)
        m["msoa21cd"] = area_of.reindex(m.index)
        m = m.dropna(subset=["msoa21cd"])
        counts = m.groupby("msoa21cd").sum(numeric_only=True)
        counts = all_msoa.merge(counts, on="msoa21cd", how="left").fillna(0)
        count_cols = [c for c in counts.columns if c != "msoa21cd"]
        counts[count_cols] = counts[count_cols].astype(int)
        counts["closures"] = counts["closures_tagged"] + counts["closures_removed"]
        counts.insert(1, "pair", text)
        counts = counts.merge(lk, on="msoa21cd", how="left")

        def pct(frame):
            return (frame["closures"] / frame["stock_a"] * 100).where(
                frame["stock_a"] >= args.min_stock
            ).round(1)

        counts["closure_pct"] = pct(counts)
        msoa_rows.append(counts)

        lad = counts.groupby(["pair", "lad22cd", "lad22nm"], as_index=False)[
            ["stock_a", "stock_b", "persisting", "closures_tagged", "closures_removed", "closures", "openings"]
        ].sum()
        lad["closure_pct"] = pct(lad)
        lad_rows.append(lad)

        gdf = msoa.merge(counts, on="msoa21cd", how="left")
        gdf.to_file(out / f"community_centres_msoa_{text}.gpkg", driver="GPKG")

    pd.concat(msoa_rows).to_csv(out / "community_centres_msoa.csv", index=False)
    pd.concat(lad_rows).to_csv(out / "community_centres_lad.csv", index=False)
    print(f"written to {out}/")


if __name__ == "__main__":
    main()
