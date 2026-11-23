#!/usr/bin/env python3
"""Probe: Scotland census 2022 and 2011 data-zone bulk file pages."""
import re
import requests

H = {"User-Agent": "Mozilla/5.0 (portrait-of-a-nation data build)"}
for u in ["https://www.scotlandscensus.gov.uk/census-results/download-data/census-table-data/",
          "https://www.scotlandscensus.gov.uk/documents/2011-census-table-data-sns-data-zone-2011/",
          "https://www.scotlandscensus.gov.uk/census-results/download-data/commissioned-tables/"]:
    r = requests.get(u, headers=H, timeout=60)
    print("\nURL", u, r.status_code, len(r.text))
    for l in sorted(set(re.findall(r'href="([^"]+)"', r.text))):
        if re.search(r"2022|\.zip|\.csv|\.xlsx|data-zone|datazone", l, re.I):
            print("  ", l[:220])
    print("  text 2022 mentions:", len(re.findall("2022", r.text)))
