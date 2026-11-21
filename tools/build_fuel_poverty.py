#!/usr/bin/env python3
"""England's sub-regional fuel poverty (2024 data, DESNZ, published May 2026) -> data/fuel-poverty-england.csv

  python3 tools/build_fuel_poverty.py

Reads source/fuel-poverty-sub-regional-2026-2024-data-tables.xlsx (gov.uk: "Sub-regional fuel poverty data 2026
(2024 data)"): Table 2 (local authorities) and Table 4 (LSOAs). One row per area, local authorities and LSOAs
together, keyed by area code:
  code, name, nation, la_code, la_name, lad rate, lsoa rate, fuel poor households, households
`lad rate` is filled on local-authority rows and `lsoa rate` on LSOA rows (the page picks which one to draw).
Rates are the % of households in fuel poverty (Low Income Low Energy Efficiency metric). The LSOA figures are
modelled estimates DESNZ says should only be used to spot general trends, not to rank or compare LSOAs."""
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
out = pd.concat([la, ls], ignore_index=True)
assert out.code.is_unique
out.to_csv('data/fuel-poverty-england.csv', index=False)
print(f'{len(la)} local authorities, {len(ls)} LSOAs -> data/fuel-poverty-england.csv')
print('LA rate range', la['lad rate'].min(), la['lad rate'].max(), '| LSOA', ls['lsoa rate'].min(), ls['lsoa rate'].max())
