#!/usr/bin/env python3
"""
Step 1.4a: charities that look like community spaces, from the Charity Commission register extract
(publicextract_charity.txt, tab-separated; Open Government Licence).

There is no classification table in this extract, so charities are picked by NAME (village hall, community
centre, memorial hall, church/parish hall, scout/guide hut, working men's / social club...). Treat as a
candidate list, not a census. Removed charities carry no postcode in the extract, so they cannot be placed.

Usage: python tools/prepare_charity_candidates.py --register publicextract_charity.txt --out source/charity
Output: candidates.csv (one row per charity) and postcodes.txt (unique postcodes of registered candidates).
"""
import argparse
import re
from pathlib import Path

import pandas as pd

RULES = [
    ("scout_guide", r"\b(scouts?|girl guides?|girlguiding|guides? (hut|group|headquarters|hall)|cadets?|brownies|rainbows)\b"),
    ("youth", r"\byouth (club|centre|center|project|hall|house|association)\b"),
    ("religious_hall", r"\b(church|parish|chapel|methodist|baptist|catholic|mission|kirk|st\.? [a-z]+'?s?)\b.*\b(hall|centre|center|rooms?)\b|\b(parish|church) (hall|rooms?|centre)\b"),
    ("village_hall", r"\bvillage (hall|institute|centre|center|club|memorial hall|room)\b|\b(parish|village) reading room\b"),
    ("memorial_hall", r"\bmemorial (hall|institute|centre|center|club|playing field and hall)\b"),
    ("community_centre", r"\b(community|neighbourhood|neighborhood|resource|residents?'?) (centre|center|hall|house|hub|association|rooms?)\b|\bcommunity (building|facility|facilities)\b"),
    ("club", r"\b(working men'?s?|workmen'?s?|social club|legion|miners'? welfare|welfare (hall|institute|centre))\b"),
    ("other_hall", r"\b(hall|village room|community room)\b"),
]
GROUP = {"scout_guide": "youth_scout", "youth": "youth_scout", "religious_hall": "religious_hall",
         "village_hall": "hall", "memorial_hall": "hall", "community_centre": "hall", "club": "club",
         "other_hall": "hall"}


def classify(name):
    n = str(name).lower()
    for typ, pat in RULES:
        if re.search(pat, n):
            return typ
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--register", required=True)
    ap.add_argument("--out", default="source/charity")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    c = pd.read_csv(a.register, sep="\t", dtype=str, usecols=[
        "organisation_number", "registered_charity_number", "linked_charity_number", "charity_name",
        "charity_registration_status", "date_of_registration", "date_of_removal", "charity_contact_postcode",
        "charity_is_cio", "charity_has_land"])
    c["space_type"] = c.charity_name.map(classify)
    c = c[c.space_type.notna()].copy()
    c["space_group"] = c.space_type.map(GROUP)
    c["reg_date"] = pd.to_datetime(c.date_of_registration.str[:10], errors="coerce")
    c["rem_date"] = pd.to_datetime(c.date_of_removal.str[:10], errors="coerce")
    c["postcode"] = c.charity_contact_postcode.str.upper().str.replace(r"\s+", " ", regex=True).str.strip()
    c["name_key"] = c.charity_name.str.lower().str.replace(r"[^a-z0-9]", "", regex=True)
    keep = ["organisation_number", "registered_charity_number", "linked_charity_number", "charity_name", "name_key",
            "charity_registration_status", "reg_date", "rem_date", "postcode", "charity_is_cio", "charity_has_land",
            "space_type", "space_group"]
    c[keep].to_csv(out / "candidates.csv", index=False)
    pcs = c[(c.charity_registration_status == "Registered") & c.postcode.notna()].postcode.drop_duplicates()
    pcs.to_csv(out / "postcodes.txt", index=False, header=False)
    print(len(c), "candidate charities;", int((c.charity_registration_status == "Registered").sum()), "registered;",
          len(pcs), "unique postcodes")
    print(c.space_type.value_counts().to_string())


if __name__ == "__main__":
    main()
