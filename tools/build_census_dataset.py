#!/usr/bin/env python3
"""
Census community layer: counts per area for two census dates, by topic and group, harmonised across the nations.

Topics: ethnic, religion, birth (country of birth), language.
Each area x topic x category row carries count_a / count_b (+ totals), so the map can show counts and shares at both
dates, net change and percentage-point change. Two grains per topic: `broad` (shared groups, sum to the total) and
`detail` (finer groups; the same people, so never add broad and detail together).

Geography (area_level):
  lsoa21  England and Wales; 2011 output areas are converted to 2021 LSOAs with the ONS exact-fit lookup
          (output areas split between LSOAs are apportioned equally across their pieces: method_a = apportioned)
  dz11    Scotland data zones 2011, both dates (2011 and 2022 census)
  soa11   Northern Ireland SOAs (2011 census native); 2021 data zones / super data zones moved onto them by population

Usage: python tools/build_census_dataset.py --oa-lookup <OA11->OA21 csv> --lsoa-lookup <OA21->LSOA21 csv> \
         --ni-dir <folder with the four 2011 NI xlsx>  --sc2022-dir <folder with the Scottish 2022 tables> [--out source/census_data]
"""
import argparse
import csv
import glob
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

# ---------------------------------------------------------------- classification ---------------------------------
ETH_BROAD = {"white": "White", "mixed": "Mixed or multiple", "asian": "Asian", "black": "Black, African or Caribbean",
             "other": "Other ethnic group"}
ETH_DETAIL = {  # detail id -> (broad, label)
    "white_british": ("white", "White: British (England, Wales, Scotland, NI) / other White British"),
    "white_scottish": ("white", "White: Scottish (Scotland only)"),
    "white_irish": ("white", "White: Irish"), "white_traveller": ("white", "White: Gypsy or Irish Traveller"),
    "white_roma": ("white", "White: Roma (2021 only)"), "white_polish": ("white", "White: Polish (Scotland only)"),
    "white_other": ("white", "White: other"), "white_all": ("white", "White (not split, Northern Ireland)"),
    "mixed_wbc": ("mixed", "Mixed: White and Black Caribbean"), "mixed_wba": ("mixed", "Mixed: White and Black African"),
    "mixed_wasian": ("mixed", "Mixed: White and Asian"), "mixed_other": ("mixed", "Mixed: other"),
    "mixed_all": ("mixed", "Mixed (not split)"),
    "asian_indian": ("asian", "Asian: Indian"), "asian_pakistani": ("asian", "Asian: Pakistani"),
    "asian_bangladeshi": ("asian", "Asian: Bangladeshi"), "asian_chinese": ("asian", "Asian: Chinese"),
    "asian_other": ("asian", "Asian: other"),
    "black_african": ("black", "Black: African"), "black_caribbean": ("black", "Black: Caribbean"),
    "black_other": ("black", "Black: other"),
    "asian_all": ("asian", "Asian (not split, Northern Ireland)"), "black_all": ("black", "Black (not split, Northern Ireland)"),
    "other_arab": ("other", "Other: Arab"), "other_any": ("other", "Other: any other ethnic group"),
}
REL_BROAD = {"christian": "Christian", "buddhist": "Buddhist", "hindu": "Hindu", "jewish": "Jewish", "muslim": "Muslim",
             "sikh": "Sikh", "other_religion": "Other religion", "no_religion": "No religion",
             "not_stated": "Religion not stated"}
REL_DETAIL = {"christian": ("christian", "Christian (not split)"),
              "church_of_scotland": ("christian", "Church of Scotland"), "roman_catholic": ("christian", "Roman Catholic"),
              "other_christian": ("christian", "Other Christian"),
              "catholic": ("christian", "Catholic (Northern Ireland)"),
              "presbyterian": ("christian", "Presbyterian (NI)"), "church_of_ireland": ("christian", "Church of Ireland (NI)"),
              "methodist": ("christian", "Methodist (NI)"),
              "pagan": ("other_religion", "Pagan (Scotland 2022 only)"),
              "muslim_ni": ("other_religion", "Muslim (Northern Ireland: counted within other religions)"),
              "hindu_ni": ("other_religion", "Hindu (Northern Ireland: counted within other religions)"),
              "other_christian_ni": ("christian", "Other Christian denominations (Northern Ireland)")}
for k in ("buddhist", "hindu", "jewish", "muslim", "sikh", "other_religion", "no_religion", "not_stated"):
    REL_DETAIL.setdefault(k, (k, REL_BROAD[k]))
BIRTH_BROAD = {"uk": "United Kingdom", "europe_ex_uk": "Europe outside the UK", "outside_europe": "Outside Europe"}
BIRTH_DETAIL = {"uk": ("uk", "United Kingdom"),
                "eu14": ("europe_ex_uk", "EU member states before 2004 (incl. Ireland)"),
                "eu_accession": ("europe_ex_uk", "EU accession states 2004 onwards"),
                "europe_non_eu": ("europe_ex_uk", "Other Europe (non-EU, Channel Islands, Isle of Man)"),
                "africa": ("outside_europe", "Africa"), "middle_east_asia": ("outside_europe", "Middle East and Asia"),
                "americas": ("outside_europe", "The Americas and the Caribbean"),
                "oceania_other": ("outside_europe", "Antarctica, Oceania and other"),
                "ireland": ("europe_ex_uk", "Republic of Ireland (Northern Ireland)"),
                "eu_other": ("europe_ex_uk", "Other EU countries (Northern Ireland)"),
                "other_unspecified": ("outside_europe", "Other (not split; Northern Ireland 2011 also holds non-EU Europe)")}
LANG_BROAD = {"english_main": "English (or Welsh in Wales) is main language", "other_main": "Another main language"}
LANG_DETAIL = {"english_main": ("english_main", "English main language"),
               "other_main_well": ("other_main", "Other main language, speaks English well"),
               "other_main_poor": ("other_main", "Other main language, does not speak English well"),
               "scots": ("other_main", "Scots"), "gaelic": ("other_main", "Gaelic"),
               "sign_language": ("other_main", "Sign language"), "other_language": ("other_main", "Other language"),
               "other_main_unsplit": ("other_main", "Other main language (not split)"),
               "polish": ("other_main", "Polish"), "lithuanian": ("other_main", "Lithuanian"),
               "irish": ("other_main", "Irish")}
TOPICS = {"ethnic": (ETH_BROAD, ETH_DETAIL), "religion": (REL_BROAD, REL_DETAIL),
          "birth": (BIRTH_BROAD, BIRTH_DETAIL), "language": (LANG_BROAD, LANG_DETAIL)}


def eth_leaf(name):
    """Nomis / ONS England-Wales ethnic category name -> detail id (None for totals and parent rows)."""
    n = name.lower()
    if ":" not in n or n.startswith(("all categories", "total")):
        return None
    if n.startswith("white"):
        for key, det in (("gypsy", "white_traveller"), ("roma", "white_roma"), ("irish", "white_irish"),
                         ("other white", "white_other"), ("british", "white_british")):
            if key in n:
                return det
    if n.startswith("mixed"):
        return ("mixed_wbc" if "white and black caribbean" in n else "mixed_wba" if "white and black african" in n
                else "mixed_wasian" if "white and asian" in n else "mixed_other")
    if n.startswith("asian"):
        for key, det in (("indian", "asian_indian"), ("pakistani", "asian_pakistani"), ("bangladeshi", "asian_bangladeshi"),
                         ("chinese", "asian_chinese"), ("other asian", "asian_other")):
            if key in n:
                return det
    if n.startswith("black"):
        return "black_african" if n.endswith("african") else "black_caribbean" if n.endswith("caribbean") else "black_other"
    if n.startswith("other ethnic"):
        return "other_arab" if "arab" in n else "other_any"
    return None


def sc_eth_leaf(name):
    n = name.lower()
    if n.startswith(("all people", "white: total", "white: white scottish")) or n in ("white", "all people"):
        return "white_scottish" if "white scottish" in n or n == "white: scottish" else None
    m = {"white: scottish": "white_scottish", "white: other british": "white_british", "white: other white british": "white_british", "white: white irish": "white_irish",
         "white: irish": "white_irish", "white: gypsy/ traveller": "white_traveller", "white: gypsy/traveller": "white_traveller",
         "white: white polish": "white_polish", "white: polish": "white_polish", "other white": "white_other",
         "white: other white": "white_other", "mixed or multiple ethnic group": "mixed_all",
         "mixed or multiple ethnic groups": "mixed_all"}
    if n in m:
        return m[n]
    if n.startswith("asian") and ":" in n and "total" not in n:
        for key, det in (("pakistani", "asian_pakistani"), ("indian", "asian_indian"), ("bangladeshi", "asian_bangladeshi"),
                         ("chinese", "asian_chinese"), ("other asian", "asian_other")):
            if key in n:
                return det
    if n.startswith("african:") and "total" not in n:
        return "black_african"
    if n.startswith("african") and n.count(":") == 0:
        return None  # 2011 parent
    if n.startswith("caribbean or black:") and "total" not in n:
        return "black_caribbean" if "caribbean," in n or n.endswith(("caribbean british", "caribbean")) and "other" not in n else "black_other"
    if n.startswith("other ethnic groups:") and "total" not in n:
        return "other_arab" if "arab" in n else "other_any"
    return None


def broad_of(topic, det):
    return TOPICS[topic][1][det][0]


# ---------------------------------------------------------------- England and Wales -------------------------------
def ew_tables(ew_dir):
    """Return {topic: (df2011_by_OA, df2021_by_LSOA)} long frames with columns area_code, det, value."""
    out = {}

    def load(name, mapper, keep=None):
        p = Path(ew_dir) / f"{name}.csv.gz"
        if not p.exists() or p.stat().st_size < 200:
            return None
        parts = []
        for ch in pd.read_csv(p, chunksize=3_000_000, dtype={"area_code": str, "cat_code": str, "cat_name": str}):
            ch = ch.dropna(subset=["cat_name"])
            ch["det"] = ch.cat_name.map(mapper)
            ch = ch.dropna(subset=["det"])
            if len(ch):
                parts.append(ch.groupby(["area_code", "det"], as_index=False).value.sum())
        d = pd.concat(parts)
        return d.groupby(["area_code", "det"], as_index=False).value.sum()

    out["ethnic"] = (load("eth11", eth_leaf), load("eth21", eth_leaf))
    rel = {"Christian": "christian", "Buddhist": "buddhist", "Hindu": "hindu", "Jewish": "jewish", "Muslim": "muslim",
           "Sikh": "sikh", "Other religion": "other_religion", "No religion": "no_religion",
           "Religion not stated": "not_stated", "Not answered": "not_stated"}
    out["religion"] = (load("rel11", rel.get), load("rel21", rel.get))

    def birth11(name):
        code_map = {}
        return None

    # country of birth 2011 is keyed by cat_code (QS203EW00xx); 2021 by position code (_n)
    def load_birth():
        c11 = {"QS203EW0003": "uk", "QS203EW0014": "eu14", "QS203EW0017": "eu14", "QS203EW0024": "eu_accession",
               "QS203EW0029": "europe_non_eu", "QS203EW0010": "europe_non_eu", "QS203EW0011": "europe_non_eu",
               "QS203EW0012": "europe_non_eu", "QS203EW0013": "europe_non_eu", "QS203EW0032": "africa",
               "QS203EW0045": "middle_east_asia", "QS203EW0063": "americas", "QS203EW0072": "oceania_other",
               "QS203EW0078": "other_unspecified"}
        c21 = {"_1": "uk", "_2": "eu14", "_3": "eu_accession", "_4": "eu_accession", "_5": "eu_accession",
               "_6": "europe_non_eu", "_7": "africa", "_8": "middle_east_asia", "_9": "americas", "_10": "oceania_other",
               "_11": "other_unspecified"}
        res = []
        for name, cm in (("cob11", c11), ("cob21", c21)):
            parts = []
            for ch in pd.read_csv(Path(ew_dir) / f"{name}.csv.gz", chunksize=3_000_000,
                                  dtype={"area_code": str, "cat_code": str, "cat_name": str}):
                ch["det"] = ch.cat_code.map(cm)
                ch = ch.dropna(subset=["det"])
                parts.append(ch.groupby(["area_code", "det"], as_index=False).value.sum())
            d = pd.concat(parts).groupby(["area_code", "det"], as_index=False).value.sum()
            res.append(d)
        return tuple(res)

    out["birth"] = load_birth()

    def prof(name):
        n = name.lower()
        if n.startswith(("all usual", "total")):
            return None
        if "main language is english" in n:
            return "english_main"
        if "cannot" in n or "not well" in n or "not at all" in n:
            return "other_main_poor"
        if "very well" in n or "speak english well" in n or n.endswith("well"):
            return "other_main_well"
        return None

    out["language"] = (load("prof11", prof), load("prof21", prof))
    return out


def oa_to_lsoa(df11, oa_lookup, lsoa_lookup):
    lk = pd.read_csv(oa_lookup, encoding="utf-8-sig", usecols=["OA11CD", "OA21CD"], dtype=str)
    ls = pd.read_csv(lsoa_lookup, encoding="utf-8-sig", usecols=["OA21CD", "LSOA21CD"], dtype=str)
    m = lk.merge(ls, on="OA21CD", how="left").dropna(subset=["LSOA21CD"])
    n = m.groupby("OA11CD").size().rename("n_links")
    w = m.groupby(["OA11CD", "LSOA21CD"]).size().rename("k").reset_index().merge(n, on="OA11CD")
    w["w"] = w.k / w.n_links
    w["exact"] = w.w.eq(1.0)
    x = df11.merge(w[["OA11CD", "LSOA21CD", "w", "exact"]], left_on="area_code", right_on="OA11CD", how="inner")
    x["value"] = x.value * x.w
    g = x.groupby(["LSOA21CD", "det"], as_index=False).value.sum().rename(columns={"LSOA21CD": "area_code"})
    meth = x.groupby("LSOA21CD").exact.all().map({True: "exact", False: "apportioned"}).rename("method_a")
    return g, meth


# ---------------------------------------------------------------- Scotland ---------------------------------------
def sc2011(sc_dir, fname, cols_map):
    """cols_map: function(header_name) -> detail id or None (skips). Returns long frame without the national row."""
    d = pd.read_csv(Path(sc_dir) / fname, dtype=str)
    d = d.rename(columns={d.columns[0]: "area_code"})
    d = d[d.area_code.str.startswith("S01")]
    rows = []
    for c in d.columns[1:]:
        det = cols_map(c)
        if det:
            v = pd.to_numeric(d[c], errors="coerce")
            rows.append(pd.DataFrame({"area_code": d.area_code, "det": det, "value": v}))
    out = pd.concat(rows)
    return out.groupby(["area_code", "det"], as_index=False).value.sum()


def sc_long_csv(path, cat_col_name):
    """SuperWEB2 'long' export: header row then Counting, zone, category, count."""
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for r in csv.reader(fh):
            if len(r) >= 4 and r[0] == "Individuals" and r[1].startswith("S01"):
                rows.append((r[1], r[2], r[3]))
    d = pd.DataFrame(rows, columns=["area_code", "cat", "value"])
    d["value"] = pd.to_numeric(d.value, errors="coerce")
    return d


def sc_cob_2022(path):
    out, hdr, zone = [], None, None
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for r in csv.reader(fh):
            if len(r) == 1 and r[0].strip().startswith("S01"):
                zone = r[0].strip()
            elif len(r) > 3 and r[1] == "Country of Birth":
                hdr = r
            elif len(r) > 3 and zone and r[0] == "All people" and r[1] == "Total":
                out.append((zone, r))
    m = {"Europe: United Kingdom: Total": "uk", "Europe: Channel Islands and Isle of Man": "europe_non_eu",
         "Europe: Other Europe: EU Countries: Republic of Ireland": "eu14",
         "Europe: Other Europe: EU Countries: Other member countries in March 2022": "eu14",
         "Europe: Other Europe: EU Countries: Other EU accession countries March 2022": "eu_accession",
         "Europe: Other Europe: Non-EU countries": "europe_non_eu", "Africa": "africa",
         "Middle East and Asia": "middle_east_asia", "The Americas and the Caribbean": "americas",
         "Antartica and Oceania and Other": "oceania_other"}
    idx = {i: m[h] for i, h in enumerate(hdr) if h in m}
    missing = [h for h in m if h not in hdr]
    if missing:
        raise SystemExit(f"2022 country of birth columns not found: {missing}")
    rows = []
    for z, r in out:
        for i, det in idx.items():
            rows.append((z, det, pd.to_numeric(r[i], errors="coerce")))
    d = pd.DataFrame(rows, columns=["area_code", "det", "value"])
    return d.groupby(["area_code", "det"], as_index=False).value.sum()


def scotland(sc11_dir, sc22_dir):
    res = {}
    # ethnic
    a = sc2011(sc11_dir, "KS201SC.csv", sc_eth_leaf)
    d22 = sc_long_csv(glob.glob(f"{sc22_dir}/*16-22-29.csv")[0], "x")
    d22["det"] = d22.cat.map(sc_eth_leaf)
    b = d22.dropna(subset=["det"]).groupby(["area_code", "det"], as_index=False).value.sum()
    res["ethnic"] = (a, b)
    # religion
    def rel11(c):
        n = c.lower()
        return {"church of scotland": "church_of_scotland", "roman catholic": "roman_catholic",
                "other christian": "other_christian", "buddhist": "buddhist", "hindu": "hindu", "jewish": "jewish",
                "muslim": "muslim", "sikh": "sikh", "other religion": "other_religion", "no religion": "no_religion",
                "religion not stated": "not_stated"}.get(n)
    a = sc2011(sc11_dir, "KS209SCb.csv", rel11)
    d22 = sc_long_csv(glob.glob(f"{sc22_dir}/*16-25-08.csv")[0], "x")
    m22 = {"Church of Scotland": "church_of_scotland", "Roman Catholic": "roman_catholic", "Other Christian": "other_christian",
           "Buddhist": "buddhist", "Hindu": "hindu", "Jewish": "jewish", "Muslim": "muslim", "Sikh": "sikh",
           "Pagan": "pagan", "Other religion": "other_religion", "No religion": "no_religion",
           "Religion not stated": "not_stated"}
    d22["det"] = d22.cat.map(m22)
    b = d22.dropna(subset=["det"]).groupby(["area_code", "det"], as_index=False).value.sum()
    res["religion"] = (a, b)
    # country of birth
    def cob11(c):
        return {"Europe: United Kingdom": "uk", "Europe: Channel Islands and Isle of Man": "europe_non_eu",
                "Europe: Republic of Ireland": "eu14",
                "Europe: Other Europe: EU Countries: Member countries in March 2001": "eu14",
                "Europe: Other Europe: Accession countries April 2001 to March 2011": "eu_accession",
                "Europe: Other Europe: Non EU countries": "europe_non_eu", "Africa": "africa",
                "Middle East and Asia": "middle_east_asia", "The Americas and the Caribbean": "americas",
                "Antarctica and Oceania": "oceania_other", "Other": "oceania_other"}.get(c)
    a = sc2011(sc11_dir, "QS203SC.csv", cob11)
    b = sc_cob_2022(glob.glob(f"{sc22_dir}/*16-26-35.csv")[0])
    res["birth"] = (a, b)
    # language: 2022 main language; 2011 only has language used at home (English only vs other): low comparability
    def lang11(c):
        n = c.lower()
        return "english_main" if n.endswith("english only") else None
    a = sc2011(sc11_dir, "KS206SC.csv", lang11)
    tot = pd.read_csv(Path(sc11_dir) / "KS206SC.csv", dtype=str)
    tot = tot.rename(columns={tot.columns[0]: "area_code"})
    tot = tot[tot.area_code.str.startswith("S01")][["area_code", tot.columns[1]]]
    tot["tv"] = pd.to_numeric(tot.iloc[:, 1], errors="coerce")
    a = a.merge(tot[["area_code", "tv"]], on="area_code")
    other = a.assign(det="other_main_unsplit", value=a.tv - a.value)
    a = pd.concat([a[["area_code", "det", "value"]], other[["area_code", "det", "value"]]])
    d22 = sc_long_csv(glob.glob(f"{sc22_dir}/*16-24-03.csv")[0], "x")
    m22 = {"English": "english_main", "Scots": "scots", "Gaelic": "gaelic", "Sign Language": "sign_language",
           "Other language": "other_language"}
    d22["det"] = d22.cat.map(m22)
    b = d22.dropna(subset=["det"]).groupby(["area_code", "det"], as_index=False).value.sum()
    res["language"] = (a, b)
    return res


# ---------------------------------------------------------------- Northern Ireland -------------------------------
def ni2011(ni_dir):
    res = {}

    def read(key):
        p = glob.glob(f"{ni_dir}/*{key}*.xlsx")[0]
        d = pd.read_excel(p, sheet_name="SOA", header=None)
        hr = d.index[d[1] == "SOA Code"][0]
        t = d.iloc[hr + 1:].copy()
        t.columns = [str(c) for c in d.iloc[hr]]
        t = t[t["SOA Code"].astype(str).str.startswith("95")]
        return t

    def tidy(t, mapper):
        rows = []
        for c in t.columns[2:]:
            if c.endswith("(%)") or c.startswith("All usual"):
                continue
            det = mapper(c)
            if det:
                rows.append(pd.DataFrame({"area_code": t["SOA Code"].astype(str).values, "det": det,
                                          "value": pd.to_numeric(t[c], errors="coerce").values}))
        return pd.concat(rows).groupby(["area_code", "det"], as_index=False).value.sum()

    eth = {"White": "white_all", "Chinese": "asian_all", "Irish Traveller": "white_all", "Indian": "asian_all",
           "Pakistani": "asian_all", "Bangladeshi": "asian_all", "Other Asian": "asian_all",
           "Black Caribbean": "black_all", "Black African": "black_all", "Black other": "black_all",
           "Mixed": "mixed_all", "Other": "other_any"}
    res["ethnic"] = tidy(read("ks201"), lambda c: eth.get(c.split(": ", 1)[1]))
    rel = {"Catholic": "catholic", "Presbyterian Church in Ireland": "presbyterian", "Church of Ireland": "church_of_ireland",
           "Methodist Church in Ireland": "methodist", "Other Christian (including Christian related)": "other_christian_ni",
           "Other religions": "other_religion", "No religion": "no_religion", "Religion not stated": "not_stated"}
    res["religion"] = tidy(read("ks211"), lambda c: rel.get(c.split(": ", 1)[1]))
    cob = {"Northern Ireland": "uk", "England": "uk", "Scotland": "uk", "Wales": "uk", "Republic of Ireland": "ireland",
           "Other EU: Member countries prior to 2004 expansion": "eu_other",
           "Other EU: Accession countries 2004 onwards": "eu_other", "Other": "other_unspecified"}
    res["birth"] = tidy(read("ks204"), lambda c: cob.get(c.split(": ", 1)[1]))
    res["language"] = tidy(read("ks207"), lambda c: "english_main" if c.split(": ")[1] == "English" else "other_main_unsplit")
    return res


def ni2021(ni21_dir, dz_shp):
    """Northern Ireland 2021 tables: data zones summed to super data zones; religion is already on super data zones."""
    dzg = gpd.read_file(dz_shp)[["DZ2021_cd", "SDZ2021_cd"]]
    to_sdz = dict(zip(dzg.DZ2021_cd, dzg.SDZ2021_cd))
    res, dz_pop = {}, None

    def read(key):
        return pd.read_csv(glob.glob(f"{ni21_dir}/*{key}*.csv")[0], dtype=str)

    def tidy(d, mapper, to_super=None):
        d = d.copy()
        d.columns = ["code", "label", "cat_code", "cat", "count"]
        d["det"] = d.cat.map(mapper)
        d = d.dropna(subset=["det"])
        d["value"] = pd.to_numeric(d["count"], errors="coerce")
        if to_super == "sdz":
            d["code"] = d.code.map(to_sdz)
        return d.groupby(["code", "det"], as_index=False).value.sum().rename(columns={"code": "area_code"})

    e = read("dz21ethnic")
    e.columns = ["code", "label", "cat_code", "cat", "count"]
    dz_pop = e.assign(v=pd.to_numeric(e["count"], errors="coerce")).groupby("code").v.sum()
    res["ethnic"] = tidy(read("dz21ethnic"), {"White": "white_all", "Asian": "asian_all", "Black": "black_all",
                                              "Mixed": "mixed_all", "Other": "other_any"})
    res["birth"] = tidy(read("dz21cob"), {
        "Europe: United Kingdom: Northern Ireland": "uk", "Europe: United Kingdom: England, Scotland and Wales": "uk",
        "Europe: Ireland": "ireland", "Europe: Other EU countries": "eu_other", "Europe: Other Non-EU countries": "europe_non_eu",
        "Africa": "africa", "Middle East and Asia": "middle_east_asia", "The Americas and the Caribbean": "americas",
        "Antarctica, Oceania and Other": "oceania_other"})
    res["language"] = tidy(read("dz21main"), {"English": "english_main", "Other languages": "other_main_unsplit"})
    rel = {"Christian: Catholic": "catholic", "Christian: Presbyterian Church in Ireland": "presbyterian",
           "Christian: Church of Ireland": "church_of_ireland", "Christian: Methodist Church in Ireland": "methodist",
           "Other Religions: Muslim": "muslim_ni", "Other Religions: Hindu": "hindu_ni",
           "Other Religions: Other Religions": "other_religion", "No religion": "no_religion", "Religion not stated": "not_stated"}
    for k in range(5, 15):
        pass
    d = read("sdz21religion")
    cats = d.iloc[:, 3].unique()
    for c in cats:
        if c.startswith("Christian: ") and c not in rel:
            rel[c] = "other_christian_ni"
    res["religion"] = tidy(d, rel)
    return res, dz_pop


def soa11_to_sdz21(df11, soa_shp, dz_shp, dz_pop):
    """Apportion 2011 SOA counts to 2021 super data zones, weighting the pieces by 2021 data-zone population x overlap."""
    soa = gpd.read_file(soa_shp)[["SOA_CODE", "geometry"]].to_crs(27700)
    dz = gpd.read_file(dz_shp)[["DZ2021_cd", "SDZ2021_cd", "geometry"]].to_crs(27700)
    dz["dz_area"] = dz.area
    dz["pop"] = dz.DZ2021_cd.map(dz_pop).fillna(0)
    soa["soa_area"] = soa.area
    ov = gpd.overlay(soa, dz, how="intersection", keep_geom_type=True)
    ov["piece"] = ov.area
    ov = ov[ov.piece > 1]
    ov["w0"] = ov["pop"] * ov.piece / ov.dz_area
    tot = ov.groupby("SOA_CODE").w0.transform("sum")
    ov["w"] = np.where(tot > 0, ov.w0 / tot, ov.piece / ov.groupby("SOA_CODE").piece.transform("sum"))
    w = ov.groupby(["SOA_CODE", "SDZ2021_cd"], as_index=False).w.sum()
    x = df11.merge(w, left_on="area_code", right_on="SOA_CODE")
    x["value"] = x.value * x.w
    g = x.groupby(["SDZ2021_cd", "det"], as_index=False).value.sum().rename(columns={"SDZ2021_cd": "area_code"})
    return g


def ni21_weights(soa_shp, dz_shp, dz_pop):
    """Population weights for moving NI 2021 data zones and super data zones onto 2011 SOAs (the map's NI areas)."""
    soa = gpd.read_file(soa_shp)[["SOA_CODE", "geometry"]].to_crs(27700)
    dz = gpd.read_file(dz_shp)[["DZ2021_cd", "SDZ2021_cd", "geometry"]].to_crs(27700)
    dz["dz_area"] = dz.area
    dz["pop"] = dz.DZ2021_cd.map(dz_pop).fillna(0)
    ov = gpd.overlay(dz, soa, how="intersection", keep_geom_type=True)
    ov["piece"] = ov.area
    ov = ov[ov.piece > 1]
    ov["pp"] = ov["pop"] * ov.piece / ov.dz_area + 1e-9 * ov.piece
    w_dz = ov.groupby(["DZ2021_cd", "SOA_CODE"], as_index=False).pp.sum()
    w_dz["w"] = w_dz.pp / w_dz.groupby("DZ2021_cd").pp.transform("sum")
    w_sdz = ov.groupby(["SDZ2021_cd", "SOA_CODE"], as_index=False).pp.sum()
    w_sdz["w"] = w_sdz.pp / w_sdz.groupby("SDZ2021_cd").pp.transform("sum")
    return w_dz.rename(columns={"DZ2021_cd": "src"}), w_sdz.rename(columns={"SDZ2021_cd": "src"})


def to_soa(df, w):
    x = df.merge(w[["src", "SOA_CODE", "w"]], left_on="area_code", right_on="src")
    x["value"] = x.value * x.w
    return x.groupby(["SOA_CODE", "det"], as_index=False).value.sum().rename(columns={"SOA_CODE": "area_code"})


# ---------------------------------------------------------------- assemble ---------------------------------------
YEARS = {"lsoa21": (2011, 2021), "dz11": (2011, 2022), "soa11": (2011, 2021)}
QUALITY = {"ethnic": "high", "religion": "high", "birth": "medium", "language": "medium"}


def assemble(level, topic, a, b, method_a=None):
    parts = []
    for tag, d in (("a", a), ("b", b)):
        if d is None:
            continue
        d = d.copy()
        d["broad"] = d.det.map(lambda k: broad_of(topic, k))
        parts.append((tag, d))
    frames = []
    for grain, key in (("detail", "det"), ("broad", "broad")):
        m = None
        for tag, d in parts:
            g = d.groupby(["area_code", key], as_index=False).value.sum().rename(columns={key: "category", "value": f"count_{tag}"})
            m = g if m is None else m.merge(g, on=["area_code", "category"], how="outer")
        if "count_b" not in m:
            m["count_b"] = np.nan
        m["grain"] = grain
        frames.append(m)
    x = pd.concat(frames, ignore_index=True)
    # totals = sum of the broad groups (they partition the people counted)
    tot = x[x.grain == "broad"].groupby("area_code")[["count_a", "count_b"]].sum(min_count=1).rename(
        columns={"count_a": "total_a", "count_b": "total_b"})
    x = x.merge(tot, on="area_code", how="left")
    x["area_level"] = level
    x["topic"] = topic
    x["year_a"], x["year_b"] = YEARS[level]
    if method_a is not None:
        x["method_a"] = x.area_code.map(method_a).fillna("apportioned")
    else:
        x["method_a"] = "published"
    x["quality"] = QUALITY[topic]
    return x


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ew-dir", default="source/census/ew")
    ap.add_argument("--sc11-dir", default="source/census/sc11")
    ap.add_argument("--sc22-dir", required=True)
    ap.add_argument("--ni-dir", required=True, help="folder with the four 2011 NI xlsx")
    ap.add_argument("--ni21-dir", required=True, help="folder with the four NI 2021 csv tables")
    ap.add_argument("--soa11", required=True, help="NI SOA 2011 shapefile")
    ap.add_argument("--dz21", required=True, help="NI 2021 data zone shapefile")
    ap.add_argument("--oa-lookup", required=True)
    ap.add_argument("--lsoa-lookup", required=True)
    ap.add_argument("--out", default="source/census_data")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    frames = []

    ew = ew_tables(a.ew_dir)
    for topic, (d11, d21) in ew.items():
        if d11 is None or d21 is None:
            print("skipping England and Wales", topic, "(table missing)")
            continue
        conv, meth = oa_to_lsoa(d11, a.oa_lookup, a.lsoa_lookup)
        frames.append(assemble("lsoa21", topic, conv, d21, meth))
        print("E&W", topic, "ok")
    for topic, (d11, d22) in scotland(a.sc11_dir, a.sc22_dir).items():
        frames.append(assemble("dz11", topic, d11, d22))
        print("Scotland", topic, "ok")
    ni21, dz_pop = ni2021(a.ni21_dir, a.dz21)
    w_dz, w_sdz = ni21_weights(a.soa11, a.dz21, dz_pop)
    soa_conv = {}
    for topic, d11 in ni2011(a.ni_dir).items():
        d21 = to_soa(ni21[topic], w_sdz if topic == "religion" else w_dz)
        frames.append(assemble("soa11", topic, d11, d21))
        print("NI", topic, "ok")

    x = pd.concat(frames, ignore_index=True)
    # totals = sum of the broad groups (they partition the people counted)
    tot = x[x.grain == "broad"].groupby("area_code")[["count_a", "count_b"]].sum(min_count=1).rename(
        columns={"count_a": "total_a", "count_b": "total_b"})
    x = x.merge(tot, on="area_code", how="left")
    x["area_level"] = level
    x["topic"] = topic
    x["year_a"], x["year_b"] = YEARS[level]
    if method_a is not None:
        x["method_a"] = x.area_code.map(method_a).fillna("apportioned")
    else:
        x["method_a"] = "published"
    x["quality"] = QUALITY[topic]
    return x


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ew-dir", default="source/census/ew")
    ap.add_argument("--sc11-dir", default="source/census/sc11")
    ap.add_argument("--sc22-dir", required=True)
    ap.add_argument("--ni-dir", required=True, help="folder with the four 2011 NI xlsx")
    ap.add_argument("--ni21-dir", required=True, help="folder with the four NI 2021 csv tables")
    ap.add_argument("--soa11", required=True, help="NI SOA 2011 shapefile")
    ap.add_argument("--dz21", required=True, help="NI 2021 data zone shapefile")
    ap.add_argument("--oa-lookup", required=True)
    ap.add_argument("--lsoa-lookup", required=True)
    ap.add_argument("--out", default="source/census_data")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    frames = []

    ew = ew_tables(a.ew_dir)
    for topic, (d11, d21) in ew.items():
        if d11 is None or d21 is None:
            print("skipping England and Wales", topic, "(table missing)")
            continue
        conv, meth = oa_to_lsoa(d11, a.oa_lookup, a.lsoa_lookup)
        frames.append(assemble("lsoa21", topic, conv, d21, meth))
        print("E&W", topic, "ok")
    for topic, (d11, d22) in scotland(a.sc11_dir, a.sc22_dir).items():
        frames.append(assemble("dz11", topic, d11, d22))
        print("Scotland", topic, "ok")
    ni21, dz_pop = ni2021(a.ni21_dir, a.dz21)
    w_dz, w_sdz = ni21_weights(a.soa11, a.dz21, dz_pop)
    for topic, d11 in ni2011(a.ni_dir).items():
        d21 = to_soa(ni21[topic], w_sdz if topic == "religion" else w_dz)
        frames.append(assemble("soa11", topic, d11, d21))
        print("NI", topic, "ok")

    x = pd.concat(frames, ignore_index=True)
    for c in ("count_a", "count_b", "total_a", "total_b"):
        x[c] = x[c].round(1)
    cols = ["area_code", "area_level", "topic", "grain", "category", "year_a", "year_b", "count_a", "count_b",
            "total_a", "total_b", "method_a", "quality"]
    x = x[cols]
    x.to_csv(out / "census_changes_zone.csv.gz", index=False, compression="gzip")
    cats = {"version": 1,
            "measures": ["count_a", "share_a", "count_b", "share_b", "net_change", "share_change_pp", "pct_change"],
            "how_to_combine": "Pick a topic, a grain (broad or detail, never both) and the groups to include; sum count_a and count_b "
                              "for the ticked groups; share = count / total; net = count_b - count_a; share change in percentage points.",
            "levels": {"lsoa21": "England and Wales 2021 LSOAs (2011 converted)", "dz11": "Scotland data zones 2011",
                       "soa11": "Northern Ireland super output areas (the map's NI areas); 2021 data zones moved onto them by population, religion from 2021 super data zones"},
            "years": {k: list(v) for k, v in YEARS.items()},
            "topics": {t: {"broad": b, "detail": {k: v[1] for k, v in dd.items()}} for t, (b, dd) in TOPICS.items()},
            "notes": {
                "ethnic": "Shared broad groups. England/Wales 2011 and 2021 use the same question; Scotland uses its own list (African and "
                          "Caribbean/Black are merged into Black); Northern Ireland 2011 has no White sub-groups.",
                "religion": "Northern Ireland groups all Christian denominations as Christian (details kept). Pagan is separate in Scotland 2022 only.",
                "birth": "2021 categories differ from 2011 (EU groups, British Overseas). Broad groups (UK, Europe outside UK, outside Europe) are comparable; "
                         "Northern Ireland 2011 'Other' also contains non-EU Europe.",
                "language": "England and Wales: main language English (or Welsh in Wales) vs another language, from the proficiency tables. "
                            "Scotland 2022 is main language; Scotland 2011 asked about language used at home, so the change is only indicative (quality low).",
                "method_a": "'apportioned' = 2011 output areas that straddle 2021 LSOAs were split equally between the pieces.",
                "northern_ireland": "2021 groups are coarse (5 ethnic groups, 9 birth groups, English vs other language); 2011 was collapsed to match. "
                                    "Religion: Muslim and Hindu are counted within other religions in both years for comparability. Country of birth: 2011 'Other' "
                                    "includes non-EU Europe, which 2021 reports separately. Irish Travellers are counted as White in 2011. Religion not stated fell from 2011 to 2021 (122k to 31k) partly because the 2021 question was answered more often, so read NI religion shifts between 'no religion' and 'not stated' with care."}}
    cats["notes"]["language_scotland_quality"] = "low"
    (out / "census_categories.json").write_text(json.dumps(cats, indent=1))
    print(x.groupby(["area_level", "topic"]).area_code.nunique())


if __name__ == "__main__":
    main()
