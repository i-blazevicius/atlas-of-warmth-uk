#!/usr/bin/env python3
"""Prints what the Nomis API offers for UK Business Counts (local units): dimensions,
area types that cover MSOAs, years, and industry codes for the categories we need.
Exploration only: writes nothing."""
import json
import sys
import requests

BASE = "https://www.nomisweb.co.uk/api/v01/dataset/NM_141_1"
H = {"User-Agent": "Mozilla/5.0"}


def get(url, **params):
    r = requests.get(url, params=params, headers=H, timeout=90)
    print(f"GET {r.url} -> {r.status_code}", file=sys.stderr)
    r.raise_for_status()
    return r.json()


d = get(BASE + ".def.sdmx.json")
kf = d["structure"]["keyfamilies"]["keyfamily"][0]
print("DIMENSIONS:")
for dim in kf["components"]["dimension"]:
    print(" ", dim["conceptRef"], "|", dim.get("codelist"))

for q in ("*Manchester 008*", "*Hartlepool 014*"):
    g = get(BASE + "/geography.def.sdmx.json", search=q)
    print(f"\nGEOGRAPHY search {q}:")
    for cl in g["structure"]["codelists"]["codelist"]:
        for c in cl.get("code", []):
            print(" ", c["value"], "|", c["description"]["value"], "|", {a["name"]: a.get("value") for a in c.get("annotations", {}).get("annotation", [])[:0]})

d2 = get(BASE + "/date.def.sdmx.json")
print("\nDATES:", [c["value"] for cl in d2["structure"]["codelists"]["codelist"] for c in cl.get("code", [])])

for q in ("*public house*", "*pubs*", "*religious*", "*membership organisations*", "*librar*", "*sports club*", "*community*", "*social*"):
    try:
        i = get(BASE + "/industry.def.sdmx.json", search=q)
    except Exception as e:
        print("industry search failed", q, e); continue
    print(f"\nINDUSTRY search {q}:")
    for cl in i["structure"]["codelists"]["codelist"]:
        for c in cl.get("code", [])[:25]:
            print(" ", c["value"], "|", c["description"]["value"])

for dim in ("employment_sizeband", "legal_status", "measures"):
    try:
        x = get(BASE + f"/{dim}.def.sdmx.json")
        print(f"\n{dim.upper()}:")
        for cl in x["structure"]["codelists"]["codelist"]:
            for c in cl.get("code", [])[:12]:
                print(" ", c["value"], "|", c["description"]["value"])
    except Exception as e:
        print("failed", dim, e)
