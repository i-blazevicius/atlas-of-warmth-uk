#!/usr/bin/env python3
"""Energy performance certificates by LSOA, England and Wales (MHCLG live tables LT_1 to LT_3, 2026) -> data/epc.csv

  python3 tools/build_epc.py

Reads the three .ods tables in source/ (gov.uk: "Live tables on Energy performance of new and existing dwellings in
England and Wales: annual"), sheets LT_1_2 (median energy efficiency score), LT_2_2 (% of dwellings in band C or above)
and LT_3_2 (median CO2, tonnes a year). One row per LSOA 2021:
  code, name, nation, la_code, la_name, epc score, epc band c, epc co2
Only dwellings with an EPC in the last ten years are counted (sold, let or built), and the tables give no counts and
suppress nothing, so thinly covered LSOAs cannot be flagged."""
import pandas as pd

def load(path, sheet, col):
    d = pd.read_excel(path, sheet_name=sheet, header=None, engine='odf').iloc[4:]
    d.columns = ['code', 'name', 'la_code', 'la_name', col]
    d[col] = pd.to_numeric(d[col], errors='coerce')
    return d.set_index('code')

a = load('source/epc-LT_1-median-energy-efficiency-2026.ods', 'LT_1_2', 'epc score')
b = load('source/epc-LT_2-band-c-or-above-2026.ods', 'LT_2_2', 'epc band c')
c = load('source/epc-LT_3-median-co2-2026.ods', 'LT_3_2', 'epc co2')
out = a.join(b[['epc band c']], how='outer').join(c[['epc co2']], how='outer').reset_index()
assert out.code.is_unique and out.name.notna().all() and len(out) == 35672, len(out)
out['nation'] = out.code.str[0]
assert set(out.nation) == {'E', 'W'}
out.loc[out['epc co2'] <= 0, 'epc co2'] = None            # a few LSOAs have a zero or negative median: not meaningful
out = out[['code', 'name', 'nation', 'la_code', 'la_name', 'epc score', 'epc band c', 'epc co2']]
out.to_csv('data/epc.csv', index=False)
print(out.groupby('nation').size().to_dict(), 'rows -> data/epc.csv; missing co2:', int(out['epc co2'].isna().sum()))
