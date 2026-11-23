#!/usr/bin/env python3
"""
Step 2: assemble the map-ready dataset from every layer built so far.

Design: the map reads COUNTS only. For any chosen window, layers/categories and area level it adds up
the ticked categories and then works out net, gains, losses and their percentages of the start stock.

Outputs in --out (default source/map_data):
  categories.json            layers, categories, windows, measures, rules (the map builds its filters from this)
  area_changes_zone.csv      zone level (msoa21 / iz22 / soa11 / msoa11): one row per area x window x category
  area_changes_lad.csv       local authority (LAD 2026) level, same columns
  spaces_points.csv          one row per located space (OSM spaces, charities) for dots / drill-down
  london_calibration.csv     London FOI council-run counts next to OSM change per borough (check, not a layer)

Columns of the area tables
  area_code, area_level, window, layer, category, source, quality,
  stock_a, stock_b, gains, losses, gains_raw, losses_raw
  gains/losses are blank where a source only gives totals (businesses) or only one direction (charities).
  *_raw are before the re-mapping / OS checks (OSM layer only).

To add a layer later: append rows with a new `layer`/`category` id and add its entry to categories.json.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_community_closures import BNG, place_points, read_polygons  # noqa: E402

LAYER_LABEL = {
    "cs": "Community spaces (OpenStreetMap, checked against OS)",
    "biz": "Pubs and community organisations (Nomis business counts)",
    "char": "Charities running halls and centres (Charity Commission)",
    "cs_council": "Council-run community spaces (London FOI, partial)",
}
TYPE_LABEL = {
    "village_hall": "Village halls", "community_centre": "Community centres", "community_hall": "Community halls",
    "memorial_hall": "Memorial halls", "other_hall": "Other halls", "religious_hall": "Church / parish halls",
    "youth": "Youth centres and clubs", "scout_guide": "Scout and guide halls", "club": "Clubs (social, working men's)",
    "social_centre": "Social centres", "family_centre": "Family centres", "cultural": "Cultural centres",
    "events_venue": "Events venues", "senior": "Senior centres", "unclassified": "Unclassified",
}
GROUP_OF = {
    "village_hall": "hall", "community_centre": "hall", "community_hall": "hall", "memorial_hall": "hall",
    "other_hall": "hall", "religious_hall": "religious_hall", "youth": "youth_scout", "scout_guide": "youth_scout",
    "club": "club", "social_centre": "social_centre", "family_centre": "other_community", "cultural": "other_community",
    "events_venue": "other_community", "senior": "other_community", "unclassified": "unclassified",
}
BIZ = {
    "pubs": "Pubs", "religious_organisations": "Religious organisations", "other_membership_organisations":
    "Other membership organisations", "libraries": "Libraries", "sport_clubs": "Sports clubs",
}
CS_QUALITY = {"2022-2025": "medium", "2020-2025": "low", "2018-2025": "low", "2018-2022": "low", "2015-2025": "low"}


def level_of(code):
    c = str(code)
    if c[:1].isdigit():  # Northern Ireland SOA codes look like 95AA01S1
        return "soa11"
    return {"E": "msoa21", "W": "msoa21", "S": "iz22", "N": "soa11"}.get(c[:1], "unknown")


def layer_cs(flows):
    f = flows.copy()
    f["area_level"] = np.where(f.level == "lad", "lad26", f.area_code.map(level_of))
    f["layer"], f["source"] = "cs", "osm"
    f["category"] = "cs." + f.space_type
    f["quality"] = f.window.map(CS_QUALITY)
    return f[["area_code", "area_level", "window", "layer", "category", "source", "quality", "stock_a", "stock_b",
              "gains", "losses", "gains_raw", "losses_raw"]]


def layer_biz(nomis_path, zones11, lads):
    n = pd.read_csv(nomis_path, dtype={"area_code": str})
    n = n[(n.area_type == "msoa11") & (n.status == "A")].copy()
    n["count"] = pd.to_numeric(n["count"], errors="coerce")
    cen = zones11.copy()
    cen["geometry"] = cen.geometry.centroid
    cen_pts = cen[["geometry"]].copy()
    cen_pts.index = cen["code"].values  # unnamed index, so it cannot clash with the 'code' column
    lad_of = place_points(cen_pts, lads).rename("lad_code")
    piv = n.pivot_table(index=["area_code", "industry"], columns="year", values="count", aggfunc="sum")
    rows = []
    for a, b in ((2016, 2024), (2019, 2024), (2021, 2024)):
        if a not in piv.columns or b not in piv.columns:
            continue
        t = piv[[a, b]].dropna().reset_index().rename(columns={a: "stock_a", b: "stock_b"})
        t["window"] = f"{a}-{b}"
        rows.append(t)
    t = pd.concat(rows)
    t["layer"], t["source"] = "biz", "nomis_uk_business_counts"
    t["category"] = "biz." + t.industry
    t["quality"] = "medium"  # counts are rounded to the nearest 5 at this level
    zone = t.assign(area_level="msoa11")
    # council level comes straight from Nomis (all UK, incl. Scotland and NI)
    nl = pd.read_csv(nomis_path, dtype={"area_code": str})
    nl = nl[(nl.area_type == "lad26") & (nl.status == "A")].copy()
    nl["count"] = pd.to_numeric(nl["count"], errors="coerce")
    pl = nl.pivot_table(index=["area_code", "industry"], columns="year", values="count", aggfunc="sum")
    lrows = []
    for a, b in ((2015, 2025), (2016, 2024), (2019, 2024), (2021, 2024), (2022, 2025)):
        if a not in pl.columns or b not in pl.columns:
            continue
        u = pl[[a, b]].dropna().reset_index().rename(columns={a: "stock_a", b: "stock_b"})
        u["window"] = f"{a}-{b}"
        lrows.append(u)
    lad = pd.concat(lrows)
    lad["layer"], lad["source"] = "biz", "nomis_uk_business_counts"
    lad["category"] = "biz." + lad.industry
    lad["quality"] = "high"  # rounded to 5, but a council holds many units
    lad["area_level"] = "lad26"
    out = []
    for d in (zone, lad):
        for c in ("gains", "losses", "gains_raw", "losses_raw"):
            d[c] = np.nan
        out.append(d[["area_code", "area_level", "window", "layer", "category", "source", "quality", "stock_a",
                      "stock_b", "gains", "losses", "gains_raw", "losses_raw"]])
    return out[0], out[1]


def layer_charity(cand_path, geo_path, zones, lads, windows):
    c = pd.read_csv(cand_path, dtype={"organisation_number": str, "registered_charity_number": str},
                    parse_dates=["reg_date", "rem_date"])
    g = pd.read_csv(geo_path)
    g["postcode"] = g.postcode.str.upper().str.replace(r"\s+", " ", regex=True).str.strip()
    c = c.merge(g[["postcode", "lat", "lon"]], on="postcode", how="left")
    # conversions (old charity removed and a same-named one registered within a year): not a real gain
    rem = c[c.charity_registration_status == "Removed"][["name_key", "rem_date", "organisation_number"]]
    reg = c[c.reg_date.notna()][["organisation_number", "name_key", "reg_date"]]
    m = reg.merge(rem, on="name_key", suffixes=("", "_old"))
    m = m[(m.organisation_number != m.organisation_number_old) &
          ((m.reg_date - m.rem_date).abs() <= pd.Timedelta(days=366))]
    c["is_conversion"] = c.organisation_number.isin(set(m.organisation_number))
    pts = c[(c.charity_registration_status == "Registered") & c.lat.notna()].copy()
    pts = gpd.GeoDataFrame(pts, geometry=gpd.points_from_xy(pts.lon, pts.lat), crs="EPSG:4326").to_crs(BNG)
    pts["zone_code"] = place_points(pts, zones)
    pts["lad_code"] = place_points(pts, lads)
    pts = pts.dropna(subset=["zone_code"])
    rows = {"zone": [], "lad": []}
    for w in windows:
        ya, yb = (int(v) for v in w.split("-"))
        start, end = pd.Timestamp(f"{ya}-01-01"), pd.Timestamp(f"{yb}-01-01")
        live_b = pts[(pts.reg_date <= end) & (pts.rem_date.isna() | (pts.rem_date > end))]
        gain = pts[(pts.reg_date > start) & (pts.reg_date <= end) & ~pts.is_conversion]
        gain_raw = pts[(pts.reg_date > start) & (pts.reg_date <= end)]
        for key, level in (("zone_code", "zone"), ("lad_code", "lad")):
            f = pd.concat({
                "stock_b": live_b.dropna(subset=[key]).groupby([key, "space_type"]).size(),
                "gains": gain.dropna(subset=[key]).groupby([key, "space_type"]).size(),
                "gains_raw": gain_raw.dropna(subset=[key]).groupby([key, "space_type"]).size(),
            }, axis=1).fillna(0).astype(int).reset_index().rename(columns={key: "area_code"})
            f["window"] = w
            f["area_level"] = "lad26" if level == "lad" else f.area_code.map(level_of)
            rows[level].append(f)
    out = []
    for level in ("zone", "lad"):
        d = pd.concat(rows[level])
        d["layer"], d["source"], d["quality"] = "char", "charity_commission_register", "medium"
        d["category"] = "char." + d.space_type
        for col in ("stock_a", "losses", "losses_raw"):
            d[col] = np.nan
        out.append(d[["area_code", "area_level", "window", "layer", "category", "source", "quality", "stock_a",
                      "stock_b", "gains", "losses", "gains_raw", "losses_raw"]])
    cp = pts[["organisation_number", "charity_name", "space_type", "reg_date", "is_conversion", "lon", "lat",
              "zone_code", "lad_code"]].rename(columns={"organisation_number": "space_id", "charity_name": "name",
                                                        "reg_date": "registered"})
    cp["registered_year"] = cp.registered.dt.year
    national = {w: int(((c.rem_date > pd.Timestamp(f'{w.split("-")[0]}-01-01')) &
                        (c.rem_date <= pd.Timestamp(f'{w.split("-")[1]}-01-01'))).sum()) for w in windows}
    return out[0], out[1], cp, national


def london(xlsx, lads_names, osm_lad):
    x = pd.read_excel(xlsx, header=0)
    x = x.iloc[:, [0, 2, 3, 5, 6, 7]]
    x.columns = ["borough", "status", "open_now", "closed_2018_2023", "created_2018_2023", "notes"]
    x = x[x.borough.notna() & ~x.borough.astype(str).str.upper().str.startswith("TOTAL")].copy()

    def num(v):
        m = re.match(r"\s*(\d+)", str(v))
        return float(m.group(1)) if m else np.nan
    for c in ("open_now", "closed_2018_2023", "created_2018_2023"):
        x[c] = x[c].map(num)
    alias = {"brighton/hove": "brighton and hove", "kensington & chelsea": "kensington and chelsea",
             "kingston": "kingston upon thames", "richmond": "richmond upon thames"}
    nm = lads_names.assign(key=lambda d: d.name.str.lower().str.replace(r"\s*&\s*", " and ", regex=True))
    x["key"] = x.borough.str.lower().str.replace(r"\s*&\s*", " and ", regex=True).replace(alias)
    x = x.merge(nm[["key", "code"]], on="key", how="left").rename(columns={"code": "lad_code"})
    x["stock_2018_implied"] = x.open_now - x.created_2018_2023 + x.closed_2018_2023
    x["net_2018_2023"] = x.created_2018_2023 - x.closed_2018_2023
    o = osm_lad[(osm_lad.window == "2018-2025")].groupby("area_code")[["stock_a", "stock_b", "gains", "losses"]].sum()
    x = x.merge(o.add_prefix("osm_2018_2025_"), left_on="lad_code", right_index=True, how="left")
    return x.drop(columns="key")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--flows", default="source/derived/community_spaces_flows.csv")
    ap.add_argument("--points", default="source/derived/community_spaces_points.csv")
    ap.add_argument("--nomis", default="source/nomis/business_counts_local_units.csv")
    ap.add_argument("--msoa11", required=True)
    ap.add_argument("--zones", nargs="+", required=True)
    ap.add_argument("--lad", required=True)
    ap.add_argument("--lad-code", default="LAD26CD")
    ap.add_argument("--lad-name", default="LAD26NM")
    ap.add_argument("--charity", default="source/charity/candidates.csv")
    ap.add_argument("--postcodes", default="source/charity/postcodes_geocoded.csv")
    ap.add_argument("--london", help="London FOI Excel")
    ap.add_argument("--out", default="source/map_data")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    zones = gpd.GeoDataFrame(pd.concat([read_polygons(*s.split("::")) for s in a.zones], ignore_index=True), crs=BNG)
    lads = read_polygons(a.lad, a.lad_code)
    names = gpd.read_file(a.lad)[[a.lad_code, a.lad_name]].drop_duplicates().rename(
        columns={a.lad_code: "code", a.lad_name: "name"})
    m11 = read_polygons(a.msoa11, "CODE")

    flows = pd.read_csv(a.flows)
    cs_zone = layer_cs(flows[flows.level == "zone"])
    cs_lad = layer_cs(flows[flows.level == "lad"])
    biz_zone, biz_lad = layer_biz(a.nomis, m11, lads)
    zone_parts, lad_parts = [cs_zone, biz_zone], [cs_lad, biz_lad]
    points = pd.read_csv(a.points)
    pts = points.assign(space_id=points.osm_id, layer="cs", category="cs." + points.space_type, source="osm",
                        status="open_2025")[["space_id", "layer", "category", "source", "name", "confidence",
                                             "first_seen_year", "lon", "lat", "zone_code", "lad_code", "status"]]
    national_losses = {}
    if Path(a.charity).exists() and Path(a.postcodes).exists():
        cw = ["2022-2025", "2020-2025", "2018-2025", "2015-2025"]
        ch_zone, ch_lad, cp, national_losses = layer_charity(a.charity, a.postcodes, zones, lads, cw)
        zone_parts.append(ch_zone)
        lad_parts.append(ch_lad)
        pts = pd.concat([pts, cp.assign(layer="char", category="char." + cp.space_type,
                                        source="charity_commission_register", confidence="register",
                                        first_seen_year=cp.registered_year, status="registered")[pts.columns]])
    if a.london:
        lon = london(a.london, names, cs_lad[cs_lad.category.str.startswith("cs.")])
        lon.to_csv(out / "london_calibration.csv", index=False)
        cc = lon.dropna(subset=["lad_code", "open_now", "closed_2018_2023", "created_2018_2023"])
        council = pd.DataFrame({
            "area_code": cc.lad_code, "area_level": "lad26", "window": "2018-2023", "layer": "cs_council",
            "category": "cs_council.council_run", "source": "foi_london_boroughs_2024", "quality": "medium",
            "stock_a": cc.stock_2018_implied, "stock_b": cc.open_now, "gains": cc.created_2018_2023,
            "losses": cc.closed_2018_2023, "gains_raw": cc.created_2018_2023, "losses_raw": cc.closed_2018_2023})
        lad_parts.append(council)
        both = lon.dropna(subset=["net_2018_2023", "osm_2018_2025_stock_a"]).copy()
        both["osm_net"] = both.osm_2018_2025_gains - both.osm_2018_2025_losses
        print(f"London calibration: {len(both)} boroughs with both; Spearman(council net, OSM net) = "
              f"{both.net_2018_2023.corr(both.osm_net, method='spearman'):.2f}")

    zone_all = pd.concat(zone_parts, ignore_index=True)
    lad_all = pd.concat(lad_parts, ignore_index=True)
    zone_all.to_csv(out / "area_changes_zone.csv", index=False)
    lad_all.to_csv(out / "area_changes_lad.csv", index=False)
    pts.to_csv(out / "spaces_points.csv", index=False)

    cats = []
    for cat in sorted(set(zone_all.category) | set(lad_all.category)):
        layer, typ = cat.split(".", 1)
        label = TYPE_LABEL.get(typ) or BIZ.get(typ) or typ.replace("_", " ").title()
        cats.append({"id": cat, "layer": layer, "label": label, "group": GROUP_OF.get(typ, layer)})
    windows = sorted(set(zone_all.window) | set(lad_all.window))
    meta = {
        "version": 1,
        "measures": [
            {"id": "net", "label": "Net change", "formula": "gains - losses (or stock_b - stock_a where flows are blank)"},
            {"id": "net_pct", "label": "Net change %", "formula": "net / stock_a * 100"},
            {"id": "gains", "label": "Gains", "formula": "gains"},
            {"id": "gains_pct", "label": "Gains %", "formula": "gains / stock_a * 100"},
            {"id": "losses", "label": "Losses", "formula": "losses"},
            {"id": "losses_pct", "label": "Losses %", "formula": "losses / stock_a * 100"},
        ],
        "how_to_combine": "add stock_a, stock_b, gains and losses over the ticked categories first, then work out the measure",
        "rules": {"min_stock_a_for_percent": 3, "recommended_window": "2022-2025 for layer cs",
                  "area_levels": ["msoa21", "iz22", "soa11", "msoa11", "lad26"]},
        "layers": [
            {"id": l, "label": LAYER_LABEL[l], "flows": {"cs": "gains_and_losses", "biz": "net_only",
                                                           "char": "gains_only", "cs_council": "gains_and_losses"}[l],
             "categories": [c["id"] for c in cats if c["layer"] == l]}
            for l in LAYER_LABEL if any(c["layer"] == l for c in cats)
        ],
        "categories": cats,
        "windows": windows,
        "notes": {
            "cs": "OpenStreetMap volunteer mapping: use 2022-2025; longer windows are inflated by growing coverage. "
                  "gains/losses exclude re-mapped duplicates and losses where an OS hall is still present.",
            "biz": "UK Business Counts local units, rounded to 5. Councils: whole UK incl. Scotland and NI (2015-2025 and shorter windows). Small areas: England and Wales only (2011 MSOAs, 2016-2024); small-area Scotland pending a 2001 intermediate zone boundary or lookup.",
            "char": "Charities placed by postcode; removed charities carry no postcode, so only gains and stock are "
                    "located. National removals by window: " + json.dumps(national_losses),
            "cs_council": "London FOI to councils (Jan 2024): council-run spaces only; definitions differ by borough; "
                          "some boroughs did not reply.",
        },
    }
    (out / "categories.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("zone rows", len(zone_all), "| lad rows", len(lad_all), "| points", len(pts), "| categories", len(cats))
    print(zone_all.groupby(["layer", "area_level"]).size().to_string())


if __name__ == "__main__":
    main()
