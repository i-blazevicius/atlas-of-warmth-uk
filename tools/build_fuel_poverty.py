#!/usr/bin/env python3
"""Fuel poverty -> data/fuel-poverty.csv: England (2024 data, DESNZ, published May 2026) and Scotland (SHCS 2022-24)

  python3 tools/build_fuel_poverty.py

Reads source/fuel-poverty-sub-regional-2026-2024-data-tables.xlsx (gov.uk: "Sub-regional fuel poverty data 2026
(2024 data)"): Table 2 (local authorities) and Table 4 (LSOAs). One row per area, local authorities and LSOAs
together, keyed by area code:
  code, name, nation, la_code, la_name, lad rate, lsoa rate, fuel poor households, households
`lad rate` is filled on local-authority rows and `lsoa rate` on LSOA rows (the page picks which one to draw).
Rates are the % of households in fuel poverty (Low Income Low Energy Efficiency metric). The LSOA figures are
modelled estimates DESNZ says should only be used to spot general trends, not to rank or compare LSOAs."""
import os, re
import pandas as pd

SRC = 'source/fuel-poverty-sub-regional-2026-2024-data-tables.xlsx'
x = pd.ExcelFile(SRC)

def table(name, key):
    d = x.parse(name, header=None)
    i = d.index[d.iloc[:, 0].astype(str).str.startswith(key)][0]
    out = d.iloc[i + 1:].copy()
    out.columns = [str(c).strip() for c in d.iloc[i]]
    return out

regions = {r.upper(): r for r in x.parse('Table 1', header=None).iloc[:, 0].dropna().astype(str)
           if r.upper() in {'NORTH EAST', 'NORTH WEST', 'YORKSHIRE AND THE HUMBER', 'EAST MIDLANDS', 'WEST MIDLANDS',
                            'EAST OF ENGLAND', 'LONDON', 'SOUTH EAST', 'SOUTH WEST'}}
assert len(regions) == 9, regions

t2 = table('Table 2', 'Local Authority code')
t2 = t2[t2.iloc[:, 0].astype(str).str.match(r'^E0[6-9]\d{6}$')]
c = t2.columns
la = pd.DataFrame({
    'code': t2[c[0]].values,
    'name': [(d if isinstance(d, str) else u).strip() for u, d in zip(t2[c[2]], t2[c[3]])],
    'nation': 'E', 'la_code': '', 'la_name': t2[c[1]].map(lambda r: regions[str(r).strip().upper()]).values,
    'lad rate': pd.to_numeric(t2[c[6]]).round(2).values,
    'lsoa rate': '',
    'fuel poor households': pd.to_numeric(t2[c[5]]).astype(int).values,
    'households': pd.to_numeric(t2[c[4]]).astype(int).values,
})

t4 = table('Table 4', 'LSOA Code')
t4 = t4[t4['LSOA Code'].astype(str).str.match(r'^E01\d{6}$')]
ls = pd.DataFrame({
    'code': t4['LSOA Code'].values, 'name': t4['LSOA Name'].values, 'nation': 'E',
    'la_code': t4['Local Authority Code'].values, 'la_name': t4['Local Authority Name'].values,
    'lad rate': '', 'lsoa rate': pd.to_numeric(t4['Proportion of households fuel poor (%)']).round(2).values,
    'fuel poor households': pd.to_numeric(t4['Number of households in fuel poverty']).astype(int).values,
    'households': pd.to_numeric(t4['Number of households']).astype(int).values,
})
# Scotland: Scottish House Condition Survey local authority tables 2022-24, Table 21 (% of households in fuel poverty,
# 10%-of-income definition: not comparable with England's measure). Council names are matched to the May 2026 codes.
# The tables round counts to thousands and give no household totals, so only the rate is kept.
sc = []
SCOT = 'source/shcs-local-authority-tables-2022-2024.ods'
if os.path.exists(SCOT):
    import geopandas as gpd
    lads = gpd.read_file('source/LAD_May2026_UK_BGC.gpkg', ignore_geometry=True)
    lads = lads[lads.LAD26CD.str.startswith('S12')]
    norm = lambda n: re.sub(r'\s+', ' ', str(n)).strip().lower().replace('&', 'and')
    fix = {'edinburgh, city of': 'city of edinburgh'}
    byname = {norm(n): (c, n) for c, n in zip(lads.LAD26CD, lads.LAD26NM)}
    t = pd.read_excel(SCOT, sheet_name='Table_21', header=None, engine='odf').iloc[4:36, [0, 1]]
    for name, v in zip(t[0], t[1]):
        v = str(v).strip(); rate = float(v[:-1]) if v.endswith('%') else float(v) * 100     # one cell is stored as 0.33
        code, nm = byname.pop(fix.get(norm(name), norm(name)))
        sc.append({'code': code, 'name': nm, 'nation': 'S', 'la_code': '', 'la_name': '', 'lad rate': round(rate, 2),
                   'lsoa rate': '', 'fuel poor households': '', 'households': ''})
    assert not byname and len(sc) == 32, byname
    print(f'{len(sc)} Scottish councils, rate {min(r["lad rate"] for r in sc)}-{max(r["lad rate"] for r in sc)}')
out = pd.concat([la, ls, pd.DataFrame(sc)], ignore_index=True)
assert out.code.is_unique
out.to_csv('data/fuel-poverty.csv', index=False)
print(f'{len(la)} local authorities, {len(ls)} LSOAs -> data/fuel-poverty.csv')
print('LA rate range', la['lad rate'].min(), la['lad rate'].max(), '| LSOA', ls['lsoa rate'].min(), ls['lsoa rate'].max())
