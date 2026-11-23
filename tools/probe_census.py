#!/usr/bin/env python3
"""Discovery probe: which Nomis census tables exist (2011, 2021) for ethnic group, religion, country of birth and
main language, at which small-area geographies; and whether Scotland / NI census download pages are reachable."""
import json
import re
import requests

H = {"User-Agent": "Mozilla/5.0 (portrait-of-a-nation data build)"}
B = "https://www.nomisweb.co.uk/api/v01/dataset/"


def get(url, **kw):
    try:
        r = requests.get(url, headers=H, timeout=90, **kw)
        return r.status_code, r.text
    except Exception as e:  # noqa
        return 0, str(e)


for term in ["ethnic", "religion", "country of birth", "main language", "language"]:
    code, txt = get(B + "def.sdmx.json", params={"search": f"*{term}*"})
    print(f"\n== search {term}: HTTP {code}")
    try:
        ds = json.loads(txt)["structure"]["keyfamilies"]["keyfamily"]
        for d in ds:
            nm = d["name"]["value"] if isinstance(d["name"], dict) else d["name"]
            print(" ", d["id"], "|", nm[:110])
    except Exception as e:  # noqa
        print("  parse fail", e, txt[:200])

def nm(x):
    return x["value"] if isinstance(x, dict) else x


DS = ["NM_522_1", "NM_529_1", "NM_524_1", "NM_525_1", "NM_2041_1", "NM_2049_1", "NM_2024_1", "NM_2043_1", "NM_2032_1"]
for ds in DS:
    code, txt = get(B + ds + ".def.sdmx.json")
    print(f"\n== {ds}: HTTP {code}")
    if code != 200:
        continue
    kf = json.loads(txt)["structure"]["keyfamilies"]["keyfamily"][0]
    print(" name:", nm(kf["name"]))
    dims = kf["components"]["dimension"]
    print(" dims:", [(d.get("conceptRef") or d.get("concept") or d.get("id") or list(d.keys())) for d in dims])
    for d in dims:
        cid = d.get("conceptRef") or d.get("concept") or d.get("id")
        if not cid or str(cid).lower() in ("geography", "time", "freq", "measures", "rural_urban"):
            continue
        c2, t2 = get(B + ds + "/" + str(cid) + ".def.sdmx.json")
        if c2 != 200:
            continue
        try:
            cl = json.loads(t2)["structure"]["codelists"]["codelist"][0]["code"]
            print("  dim", cid, [(c["value"], nm(c["description"])[:45]) for c in cl][:40])
        except Exception as e:  # noqa
            print("  dim", cid, "parse fail", e)
    for g in ("TYPE299", "TYPE151", "TYPE298"):
        c3, t3 = get(B + ds + ".data.csv", params={"geography": g, "measures": 20100, "recordlimit": 4})
        print("  data", g, c3, t3[:300].replace("\n", " / "))

for u in ["https://www.scotlandscensus.gov.uk/census-results/download-data/",
          "https://www.scotlandscensus.gov.uk/webapi/jsf/tableView/tableView.xhtml",
          "https://www.scotlandscensus.gov.uk/media/",
          "https://www.nisra.gov.uk/statistics/census/2021-census/results/flexible-table-builder",
          "https://build.nisra.gov.uk/en/",
          "https://www.nrscotland.gov.uk/statistics-and-data/census/2022-census"]:
    code, txt = get(u)
    print("\nURL", u, code, len(txt), re.findall(r"<title>(.*?)</title>", txt, re.S)[:1])
