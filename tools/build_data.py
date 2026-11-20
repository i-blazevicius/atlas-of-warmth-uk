#!/usr/bin/env python3
"""Indices of Deprivation 2025 (England) -> the CSV files the site reads.

  python3 tools/build_data.py

Reads the originals in source/ and writes data/imd-england.csv (one row per LSOA, ranks and deciles of the
IMD, its seven domains, IDACI and IDAOPI) and data/imd-england-lad.csv (local-authority ranks of average rank).
Headers are short and plain; the site finds columns by header text (see js/config.js)."""
import re
import pandas as pd

S = 'source/'
f2 = pd.read_csv(S + 'File_2_IoD2025_Domains_of_Deprivation.csv')
f3 = pd.read_csv(S + 'File_3_IoD2025_Supplementary_Indices_IDACI_and_IDAOPI.csv')

def tidy(c):
    c = re.sub(r'\s*\(where 1 is most deprived[^)]*\)', '', c).strip()
    c = c.replace('Local Authority District', 'Local authority').replace('Index of Multiple Deprivation (IMD)', 'IMD')
    c = c.replace('Education, Skills and Training', 'Education').replace('Health Deprivation and Disability', 'Health')
    c = c.replace('Barriers to Housing and Services', 'Housing barriers').replace('Living Environment', 'Living environment')
    c = c.replace('Income Deprivation Affecting Children Index (IDACI)', 'IDACI').replace('Income Deprivation Affecting Older People (IDAOPI)', 'IDAOPI')
    c = re.sub(r'\((\d{4})\)', '', c).strip()
    return re.sub(r'\s+(Rank|Decile)$', lambda m: ' ' + m.group(1).lower(), c)

f2.columns = [tidy(c) for c in f2.columns]
f3.columns = [tidy(c) for c in f3.columns]
assert f2['LSOA code'].tolist() == f3['LSOA code'].tolist(), 'File 2 and File 3 list different LSOAs'
out = f2.merge(f3[['LSOA code', 'IDACI rank', 'IDACI decile', 'IDAOPI rank', 'IDAOPI decile']], on='LSOA code', validate='1:1')
out.to_csv('data/imd-england.csv', index=False)
print('data/imd-england.csv', out.shape, list(out.columns))

lad = pd.read_csv(S + 'IoD2025_LAD_Summaries_lower-tier_Rank_of_average_rank.csv')
lad.columns = [tidy(c).replace(' - rank', ' rank') for c in lad.columns]
lad.to_csv('data/imd-england-lad.csv', index=False)
print('data/imd-england-lad.csv', lad.shape, list(lad.columns))
