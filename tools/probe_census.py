#!/usr/bin/env python3
"""Probe: list download links on Scotland's Census download-data page."""
import re
import requests

H = {"User-Agent": "Mozilla/5.0 (portrait-of-a-nation data build)"}
for u in ["https://www.scotlandscensus.gov.uk/census-results/download-data/",
          "https://www.scotlandscensus.gov.uk/census-results/download-data/census-table-data/",
          "https://www.scotlandscensus.gov.uk/census-results/download-data/bulk-data-files/"]:
    r = requests.get(u, headers=H, timeout=60)
    print("\nURL", u, r.status_code, len(r.text))
    for l in sorted(set(re.findall(r'href="([^"]+)"', r.text))):
        if re.search(r"download|bulk|csv|zip|table|data", l, re.I) and "javascript" not in l:
            print("  ", l[:200])
