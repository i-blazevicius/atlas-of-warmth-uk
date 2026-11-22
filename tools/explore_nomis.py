#!/usr/bin/env python3
"""Exploration only (prints, writes nothing): which Nomis area types hold MSOAs, and which
years Business Counts (local units) has for one MSOA. Round 2 after the industry codes were found."""
import csv
import io
import json
import sys
import requests

BASE = "https://www.nomisweb.co.uk/api/v01/dataset/NM_141_1"
H = {"User-Agent": "Mozilla/5.0"}


def get(url, **params):
    r = requests.get(url, params=params, headers=H, timeout=120)
    return r


def codes(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        if "value" in node and "description" in node and not isinstance(node["value"], (dict, list)):
            d = node["description"]
            out.append((str(node["value"]), d.get("value") if isinstance(d, dict) else str(d)))
        for v in node.values():
            codes(v, out)
    elif isinstance(node, list):
        for v in node:
            codes(v, out)
    return out


print("AREA TYPES that look like MSOA (code count between 6000 and 8000):")
for n in range(240, 340):
    r = get(f"{BASE}/geography/TYPE{n}.def.sdmx.json")
    if r.status_code != 200:
        continue
    cs = codes(r.json())
    if cs:
        print(f"TYPE{n}: {len(cs)} codes; first: {cs[:2]}")

print("\nOne MSOA by GSS code, all years (Hartlepool 014 = E02006909), pubs + religious + membership + library + sports clubs:")
ind = "134274030,134312638,134312718,134308739,134310848"
r = get(BASE + ".data.csv", geography="E02006909", industry=ind, employment_sizeband=0, legal_status=0, measures=20100)
print(r.status_code)
print(r.text[:3000])
