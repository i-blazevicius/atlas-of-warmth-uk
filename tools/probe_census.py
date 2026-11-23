#!/usr/bin/env python3
"""Probe: Nomis 2021 language-related tables available at small areas."""
import json
import requests

H = {"User-Agent": "Mozilla/5.0 (portrait-of-a-nation data build)"}
B = "https://www.nomisweb.co.uk/api/v01/dataset/"
for term in ["proficiency", "household language", "language"]:
    j = requests.get(B + "def.sdmx.json", params={"search": f"*{term}*"}, headers=H, timeout=90).json()
    for d in j["structure"]["keyfamilies"]["keyfamily"]:
        n = d["name"]["value"] if isinstance(d["name"], dict) else d["name"]
        if n.startswith(("TS", "RM", "QS", "KS")) and ("2" in n[:4]):
            print(term, "|", d["id"], "|", n[:100])
for ds in ["NM_2044_1", "NM_2048_1", "NM_2047_1"]:
    for g in ("TYPE151", "TYPE152"):
        r = requests.get(B + ds + ".data.csv", params={"geography": g, "measures": 20100, "recordlimit": 3}, headers=H, timeout=90)
        print(ds, g, r.status_code, r.text[:150].replace("\n", " / "))
    r = requests.get(B + ds + ".def.sdmx.json", headers=H, timeout=60)
    if r.status_code == 200:
        print("   ", r.json()["structure"]["keyfamilies"]["keyfamily"][0]["name"])
