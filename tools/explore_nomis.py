#!/usr/bin/env python3
"""Prints what the Nomis API offers for UK Business Counts (local units): dimensions,
area types that cover MSOAs, years, and industry codes for the categories we need.
Exploration only: writes nothing. Tolerant of the response shape, prints raw text if unsure."""
import json
import sys
import requests

BASE = "https://www.nomisweb.co.uk/api/v01/dataset/NM_141_1"
H = {"User-Agent": "Mozilla/5.0"}


def get(url, **params):
    r = requests.get(url, params=params, headers=H, timeout=90)
    print(f"\n### GET {r.url} -> {r.status_code}", flush=True)
    r.raise_for_status()
    return r.json()


def entries(node, found=None):
    """Every {value, description} style code entry anywhere in the JSON."""
    found = [] if found is None else found
    if isinstance(node, dict):
        if "value" in node and "description" in node and not isinstance(node["value"], (dict, list)):
            d = node["description"]
            found.append((str(node["value"]), d.get("value") if isinstance(d, dict) else str(d)))
        for v in node.values():
            entries(v, found)
    elif isinstance(node, list):
        for v in node:
            entries(v, found)
    return found


def show(label, data, limit=40):
    es = entries(data)
    print(f"{label}: {len(es)} codes")
    for v, d in es[:limit]:
        print("   ", v, "|", d)
    if not es:
        print(json.dumps(data)[:2500])


d = get(BASE + ".def.sdmx.json")
print(json.dumps(d)[:3500])

for q in ("Manchester 008", "Hartlepool 014"):
    show(f"GEOGRAPHY search {q}", get(BASE + "/geography.def.sdmx.json", search=f"*{q}*"))

show("DATES", get(BASE + "/date.def.sdmx.json"), limit=80)

for q in ("public house", "religious", "membership organisations", "librar", "sports club", "community", "social club"):
    try:
        show(f"INDUSTRY search {q}", get(BASE + "/industry.def.sdmx.json", search=f"*{q}*"), limit=25)
    except Exception as e:
        print("industry search failed", q, e)

for dim in ("employment_sizeband", "legal_status", "measures"):
    try:
        show(dim.upper(), get(BASE + f"/{dim}.def.sdmx.json"), limit=15)
    except Exception as e:
        print("failed", dim, e)
