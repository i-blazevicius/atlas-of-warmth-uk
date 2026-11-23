#!/usr/bin/env python3
"""
Step 1.1c: a usable community-spaces dataset from the OSM snapshots, checked against OS Points of Interest.

Inputs
  --features  osm_community_centres_snapshots.jsonl (all snapshot years, with osm_id)
  --poi       OS Points of Interest GeoPackage (Digimap; licensed, GB only)
  --zones     PATH::CODE_FIELD::LABEL, one per nation (as build_community_closures.py)
  --lad       UK local authority boundaries (+ --lad-code, --lad-name)

Outputs (source/derived/ and source/derived_private/)
  community_spaces_points.csv / .gpkg          PUBLIC: OSM points active on the latest date, with
                                               space_type, space_group, confidence tier, duplicate
                                               flag, first/last year seen, area codes. Only a yes/no
                                               'os_confirmed' is derived from OS data.
  community_spaces_closures_<a>-<b>.csv/.gpkg  PUBLIC: every OSM feature active at a and not at b,
                                               with a verdict (closed_tagged / likely_remapped /
                                               likely_still_open / probable_closure).
  community_spaces_zones.csv, _lad.csv         per area and window: raw and adjusted closure counts
  community_spaces_zone_counts_by_group.csv    per area and space_group: stock and probable closures
  derived_private/community_spaces_with_os.*   PRIVATE (OS licence): the above plus OS-only points.
"""
import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_community_closures import BNG, CENTRE, LIFECYCLE_KEYS, drop_ring_duplicates, place_points, read_polygons  # noqa: E402

HALL_CLASS = "Halls and Community Centres"
OTHER_CLASSES = ["Social Clubs", "Youth Organisations", "Community Networks and Projects"]
CONFIRM_M = 100  # OS hall within this distance confirms an OSM point
NEAR_M = 250
REMAP_M = 50  # an active OSM feature this close to a vanished one suggests it was re-mapped, not closed
DUP_M = 30

TAG_TYPE = {
    "village_hall": "village_hall", "community_hall": "community_hall", "parish_hall": "religious_hall",
    "church_hall": "religious_hall", "youth_centre": "youth", "youth_club": "youth",
    "club_home": "club", "club": "club", "family_centre": "family_centre", "cultural_centre": "cultural",
    "events_venue": "events_venue", "scout_hut": "scout_guide", "scout_hall": "scout_guide",
}
FOR_TYPE = {"scout": "scout_guide", "juvenile": "youth", "child": "youth", "child;juvenile": "youth",
            "religious": "religious_hall", "senior": "senior"}
NAME_RULES = [
    ("scout_guide", r"\b(scout|scouts|guide|guides|girl guiding|cadet|cadets|brownie|brownies|rainbow|beaver|cub)\b"),
    ("youth", r"\b(youth|young people|teen|junior)\b"),
    ("religious_hall", r"\b(church|parish|chapel|methodist|baptist|catholic|presbyterian|mission|kirk|mosque|temple|gurdwara|synagogue|st\.?)\b.*\bhall\b|\b(church|parish) (hall|centre|center|rooms?)\b"),
    ("memorial_hall", r"\bmemorial\b"),
    ("village_hall", r"\bvillage (hall|institute|club|centre|center)\b"),
    ("club", r"\b(social club|working men|workingmen|legion|conservative club|labour club|liberal club|masonic|club)\b"),
    ("community_centre", r"\b(community|neighbourhood|neighborhood|resource) (centre|center|hall|house|hub|association)\b|\bcommunity\b"),
]
GROUP = {
    "village_hall": "hall", "community_hall": "hall", "memorial_hall": "hall", "community_centre": "hall",
    "other_hall": "hall", "religious_hall": "religious_hall", "youth": "youth_scout", "scout_guide": "youth_scout",
    "club": "club", "social_centre": "social_centre", "family_centre": "other_community",
    "cultural": "other_community", "events_venue": "other_community", "senior": "other_community",
    "unclassified": "unclassified",
}


def classify(tags: dict, name: str):
    """Harmonised (space_type, how) from OSM tags first, then the name."""
    t = tags.get("community_centre", "")
    if t in TAG_TYPE:
        return TAG_TYPE[t], "osm_tag"
    f = tags.get("community_centre:for", "")
    if f in FOR_TYPE:
        return FOR_TYPE[f], "osm_tag"
    n = (name or "").lower()
    for typ, pat in NAME_RULES:
        if re.search(pat, n):
            return typ, "name"
    if tags.get("amenity") == "social_centre":
        return "social_centre", "osm_tag"
    if "hall" in n:
        return "other_hall", "name"
    return "unclassified", "none"


def norm_name(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def load(path):
    rows = []
    with open(path, encoding="utf-8") as fh:
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
                continue
            name = tags.get("name") or ""
            typ, how = classify(tags, name) if state == "active" else classify(
                {**tags, "amenity": next((tags[k] for k in LIFECYCLE_KEYS if tags.get(k) in CENTRE), "")}, name)
            rows.append({
                "year": int(f["date"][:4]), "osm_id": f["osm_id"], "state": state, "lon": f["lon"], "lat": f["lat"],
                "name": name, "osm_subtype": tags.get("amenity") if state == "active" else "",
                "osm_tag_type": tags.get("community_centre", ""), "website": tags.get("website", ""),
                "operator": tags.get("operator", ""), "space_type": typ, "type_source": how,
            })
    df = pd.DataFrame(rows)
    df["rank"] = df["state"].map({"active": 0, "closed": 1})
    df = df.sort_values(["year", "osm_id", "rank"]).drop_duplicates(["year", "osm_id"]).drop(columns="rank")
    df["date"] = df["year"]
    return drop_ring_duplicates(df.reset_index(drop=True)).drop(columns="date")


def to_bng(lon, lat):
    return Transformer.from_crs(4326, 27700, always_xy=True).transform(np.asarray(lon), np.asarray(lat))


def read_poi(path):
    c = sqlite3.connect(path)
    q = ("select name, classname, feature_easting x, feature_northing y, provenance from "
         '"Points of Interest 2026_09" where classname in (?,?,?,?)')
    p = pd.read_sql(q, c, params=[HALL_CLASS, *OTHER_CLASSES])
    p["classname"] = p["classname"].str.strip()
    return p


def nearest(src_xy, dst_xy):
    if len(dst_xy) == 0:
        return np.full(len(src_xy), np.inf), np.zeros(len(src_xy), dtype=int)
    return cKDTree(dst_xy).query(src_xy)


def area_codes(df, zones, lads):
    pts = gpd.GeoDataFrame(df[["osm_id"]].copy(), geometry=gpd.points_from_xy(df["x"], df["y"]), crs=BNG)
    pts.index = df.index
    df["zone_code"] = place_points(pts, zones)
    if lads is not None:
        df["lad_code"] = place_points(pts, lads[0])
        df = df.merge(lads[1].rename(columns={"code": "lad_code", "name": "lad_name"}), on="lad_code", how="left")
    return df


def pct(num, den, min_stock):
    return np.where(den >= min_stock, num / den.replace(0, np.nan) * 100, np.nan)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", required=True)
    ap.add_argument("--poi", required=True)
    ap.add_argument("--zones", nargs="+", required=True)
    ap.add_argument("--lad")
    ap.add_argument("--lad-code", default="LAD26CD")
    ap.add_argument("--lad-name", default="LAD26NM")
    ap.add_argument("--windows", nargs="+", default=["2022-2025", "2020-2025", "2015-2025"])
    ap.add_argument("--min-stock", type=int, default=3)
    ap.add_argument("--out", default="source/derived")
    ap.add_argument("--out-private", default="source/derived_private")
    a = ap.parse_args()
    out, outp = Path(a.out), Path(a.out_private)
    out.mkdir(parents=True, exist_ok=True)
    outp.mkdir(parents=True, exist_ok=True)

    df = load(a.features)
    df["x"], df["y"] = to_bng(df.lon, df.lat)
    latest = int(df.year.max())
    years = sorted(df.year.unique())

    zones = pd.concat([read_polygons(*(s.split("::")[0], s.split("::")[1], s.split("::")[2])) for s in a.zones],
                      ignore_index=True)
    zones = gpd.GeoDataFrame(zones, crs=BNG)
    lads = None
    if a.lad:
        lg = read_polygons(a.lad, a.lad_code)
        nm = gpd.read_file(a.lad)[[a.lad_code, a.lad_name]].drop_duplicates()
        lads = (lg, nm.rename(columns={a.lad_code: "code", a.lad_name: "name"}), lg["code"].drop_duplicates())

    poi = read_poi(a.poi)
    hall = poi[poi.classname == HALL_CLASS].reset_index(drop=True)
    other = poi[poi.classname != HALL_CLASS].reset_index(drop=True)
    hall_xy = hall[["x", "y"]].values
    other_xy = other[["x", "y"]].values
    hall_tree = cKDTree(hall_xy)

    # ---------- current points (latest snapshot, active) ----------
    cur = df[(df.year == latest) & (df.state == "active")].copy().reset_index(drop=True)
    cur["os_dist_m"], _ = cKDTree(hall_xy).query(cur[["x", "y"]].values)
    cur["os_other_dist_m"], _ = cKDTree(other_xy).query(cur[["x", "y"]].values)
    cur = area_codes(cur, zones, lads)
    gb = ~cur.zone_code.fillna("").str.startswith("N")  # OS POI covers Great Britain only
    cur["os_confirmed"] = (cur.os_dist_m <= CONFIRM_M) & gb
    cur["confidence"] = np.select(
        [~gb, cur.os_dist_m <= CONFIRM_M, (cur.os_dist_m <= NEAR_M) | (cur.os_other_dist_m <= CONFIRM_M)],
        ["no_os_coverage", "A_confirmed", "B_plausible"], "C_osm_only")
    # duplicates: same normalised name within DUP_M of another active feature (keep the lowest id)
    cur["nn"] = cur.name.map(norm_name)
    cur["possible_duplicate"] = False
    tree = cKDTree(cur[["x", "y"]].values)
    for i, j in tree.query_pairs(DUP_M):
        if cur.nn[i] and cur.nn[i] == cur.nn[j]:
            drop = j if cur.osm_id[i] <= cur.osm_id[j] else i
            cur.loc[drop, "possible_duplicate"] = True
    seen = df[df.state == "active"].groupby("osm_id").year.agg(first_seen_year="min", last_seen_year="max")
    cur = cur.merge(seen, left_on="osm_id", right_index=True, how="left")
    cur["space_group"] = cur.space_type.map(GROUP)
    cur["first_seen_note"] = np.where(cur.first_seen_year == years[0], f"on map by {years[0]}", "")
    cols = ["osm_id", "name", "space_type", "space_group", "type_source", "osm_subtype", "osm_tag_type", "operator",
            "website", "confidence", "os_confirmed", "possible_duplicate", "first_seen_year", "last_seen_year",
            "zone_code", "lad_code", "lad_name", "lon", "lat"]
    cols = [c for c in cols if c in cur.columns]
    pub = cur[cols].copy()
    pub.to_csv(out / "community_spaces_points.csv", index=False)
    gpd.GeoDataFrame(pub, geometry=gpd.points_from_xy(pub.lon, pub.lat), crs="EPSG:4326").to_file(
        out / "community_spaces_points.gpkg", driver="GPKG", layer="community_spaces")

    # ---------- private layer: add OS halls that have no OSM point within CONFIRM_M ----------
    d_os, _ = cKDTree(cur[["x", "y"]].values).query(hall_xy)
    osonly = hall[d_os > CONFIRM_M].copy()
    osonly["space_type"], osonly["type_source"] = zip(*[classify({}, n) for n in osonly.name.fillna("")])
    osonly["space_group"] = osonly.space_type.map(GROUP)
    lon, lat = Transformer.from_crs(27700, 4326, always_xy=True).transform(osonly.x.values, osonly.y.values)
    osonly["lon"], osonly["lat"] = lon, lat
    osonly["source"], osonly["confidence"] = "OS_only", "os_only"
    osonly["osm_id"] = ""
    osonly = area_codes(osonly.assign(osm_id=[f"os{i}" for i in range(len(osonly))]), zones, lads)
    priv = pd.concat([pub.assign(source=np.where(pub.os_confirmed, "both", "OSM_only")),
                      osonly[["osm_id", "name", "space_type", "space_group", "type_source", "confidence", "zone_code",
                              "lad_code", "lad_name", "lon", "lat", "source"]].assign(
                                  os_confirmed=True, possible_duplicate=False)], ignore_index=True)
    priv.to_csv(outp / "community_spaces_with_os.csv", index=False)
    gpd.GeoDataFrame(priv, geometry=gpd.points_from_xy(priv.lon, priv.lat), crs="EPSG:4326").to_file(
        outp / "community_spaces_with_os.gpkg", driver="GPKG", layer="community_spaces_with_os")
    print(f"current points: {len(pub)} OSM; {len(osonly)} OS halls with no OSM point within {CONFIRM_M} m (private layer)")
    print(pub.confidence.value_counts().to_string())
    print(pub.space_group.value_counts().to_string())
    print("possible duplicates:", int(pub.possible_duplicate.sum()))

    # ---------- closures per window, with verdicts ----------
    zone_rows, lad_rows, grp_rows = [], [], []
    flow_rows_zone, flow_rows_lad = [], []
    active_latest_xy = cur[["x", "y"]].values
    for w in a.windows:
        ya, yb = (int(v) for v in w.split("-"))
        if ya not in years or yb not in years:
            print("skip window", w, "(snapshot missing)")
            continue
        A = df[(df.year == ya) & (df.state == "active")].set_index("osm_id")
        B = df[df.year == yb].set_index("osm_id")
        gone = A[~A.index.isin(B[B.state == "active"].index)].copy()
        gone["b_state"] = B.state.reindex(gone.index).fillna("absent")
        gone = gone.reset_index()
        d_hall, _ = hall_tree.query(gone[["x", "y"]].values)
        gains = B[(B.state == "active") & ~B.index.isin(A.index)].reset_index()
        gains = area_codes(gains, zones, lads)
        d_remap, idx = nearest(gone[["x", "y"]].values, gains[["x", "y"]].values)
        near_new = d_remap <= REMAP_M
        replaced = set(gains.osm_id.values[idx[near_new]]) if len(gains) else set()
        gains["is_replacement"] = gains.osm_id.isin(replaced)
        gb_g = np.ones(len(gone), dtype=bool)
        gone = area_codes(gone, zones, lads)
        gb_g = ~gone.zone_code.fillna("").str.startswith("N")
        gone["os_hall_within_100m"] = (d_hall <= CONFIRM_M) & gb_g
        gone["remapped_nearby"] = near_new
        gone["verdict"] = np.select(
            [gone.b_state == "closed", gone.remapped_nearby, gone.os_hall_within_100m],
            ["closed_tagged", "likely_remapped", "likely_still_open"], "probable_closure")
        gone["space_group"] = gone.space_type.map(GROUP)
        keep = ["osm_id", "name", "space_type", "space_group", "b_state", "verdict", "remapped_nearby",
                "os_hall_within_100m", "zone_code", "lad_code", "lad_name", "lon", "lat"]
        gout = gone[[c for c in keep if c in gone.columns]]
        gout.to_csv(out / f"community_spaces_closures_{w}.csv", index=False)
        gpd.GeoDataFrame(gout, geometry=gpd.points_from_xy(gout.lon, gout.lat), crs="EPSG:4326").to_file(
            out / f"community_spaces_closures_{w}.gpkg", driver="GPKG", layer=f"closures_{w}")
        v = gone.verdict.value_counts()
        print(f"{w}: stock {len(A)} | gone {len(gone)} -> " + ", ".join(f"{k} {n}" for k, n in v.items()))

        # flows by area and type (counts only; percentages are worked out by the map)
        Bstock = area_codes(B[B.state == "active"].reset_index(), zones, lads)
        Astock0 = area_codes(A.reset_index(), zones, lads)
        for level_key, level_name in (("zone_code", "zone"), ("lad_code", "lad")):
            if level_key == "lad_code" and lads is None:
                continue
            parts = {
                "stock_a": Astock0, "stock_b": Bstock, "gains_raw": gains,
                "gains": gains[~gains.is_replacement], "losses_raw": gone,
                "losses": gone[gone.verdict.isin(["closed_tagged", "probable_closure"])],
            }
            frames = []
            for col, d in parts.items():
                f = d.dropna(subset=[level_key]).groupby([level_key, "space_type"]).size().rename(col)
                frames.append(f)
            fl = pd.concat(frames, axis=1).fillna(0).astype(int).reset_index()
            fl = fl.rename(columns={level_key: "area_code"})
            fl.insert(1, "window", w)
            fl.insert(1, "level", level_name)
            fl["space_group"] = fl.space_type.map(GROUP)
            (flow_rows_zone if level_name == "zone" else flow_rows_lad).append(fl)

        # area tables
        Astock = A.reset_index().copy()
        Astock = area_codes(Astock, zones, lads)
        Astock["space_group"] = Astock.space_type.map(GROUP)
        for key, codes, rows in (("zone_code", zones["code"], zone_rows), ("lad_code", lads[2] if lads else None, lad_rows)):
            if codes is None:
                continue
            base = pd.DataFrame({key: codes.values})
            s = Astock.groupby(key).size().rename("stock_a")
            g = gone.groupby(key).verdict.value_counts().unstack(fill_value=0)
            t = base.merge(s, left_on=key, right_index=True, how="left").merge(
                g, left_on=key, right_index=True, how="left").fillna(0)
            for c in ["closed_tagged", "likely_remapped", "likely_still_open", "probable_closure"]:
                if c not in t:
                    t[c] = 0
            t["closures_all"] = t[["closed_tagged", "likely_remapped", "likely_still_open", "probable_closure"]].sum(axis=1)
            t["closures_adjusted"] = t.closed_tagged + t.probable_closure
            t["closure_pct_all"] = pct(t.closures_all, t.stock_a, a.min_stock)
            t["closure_pct_adjusted"] = pct(t.closures_adjusted, t.stock_a, a.min_stock)
            t.insert(1, "window", w)
            if key == "lad_code" and lads is not None:
                t = t.merge(lads[1].rename(columns={"code": "lad_code", "name": "lad_name"}), on="lad_code", how="left")
            rows.append(t)
        gs = Astock.groupby(["zone_code", "space_group"]).size().rename("stock_a").reset_index()
        gg = gone[gone.verdict.isin(["closed_tagged", "probable_closure"])].groupby(
            ["zone_code", "space_group"]).size().rename("closures_adjusted").reset_index()
        m = gs.merge(gg, on=["zone_code", "space_group"], how="outer").fillna(0)
        m.insert(1, "window", w)
        grp_rows.append(m)

    if zone_rows:
        pd.concat(zone_rows).to_csv(out / "community_spaces_zones.csv", index=False)
    if lad_rows:
        pd.concat(lad_rows).to_csv(out / "community_spaces_lad.csv", index=False)
    if flow_rows_zone or flow_rows_lad:
        pd.concat(flow_rows_zone + flow_rows_lad).to_csv(out / "community_spaces_flows.csv", index=False)
    if grp_rows:
        pd.concat(grp_rows).to_csv(out / "community_spaces_zone_counts_by_group.csv", index=False)
    print("written to", out, "and", outp)


if __name__ == "__main__":
    main()
