#!/usr/bin/env python3
"""Energy performance certificates -> data/epc.csv: England and Wales by LSOA, Scotland by data zone, Northern Ireland by council

  python3 tools/build_epc.py

England and Wales: reads the three .ods tables in source/ (gov.uk: "Live tables on Energy performance of new and existing dwellings in
England and Wales: annual"), sheets LT_1_2 (median energy efficiency score), LT_2_2 (% of dwellings in band C or above)
and LT_3_2 (median CO2, tonnes a year). One row per LSOA 2021:
  code, name, nation, la_code, la_name, epc score, epc band c, epc co2
Only dwellings with an EPC in the last ten years are counted (sold, let or built), and the tables give no counts and
suppress nothing, so thinly covered LSOAs cannot be flagged."""
import os
import pandas as pd

def load(path, sheet, col):
    d = pd.read_excel(path, sheet_name=sheet, header=None, engine='odf').iloc[4:]
    d.columns = ['code', 'name', 'la_code', 'la_name', col]
    d[col] = pd.to_numeric(d[col], errors='coerce')
    return d.set_index('code')

a = load('source/epc-LT_1-median-energy-efficiency-2026.ods', 'LT_1_2', 'epc score')
b = load('source/epc-LT_2-band-c-or-above-2026.ods', 'LT_2_2', 'epc band c')
c = load('source/epc-LT_3-median-co2-2026.ods', 'LT_3_2', 'epc co2')
ew = a.join(b[['epc band c']], how='outer').join(c[['epc co2']], how='outer').reset_index()
assert ew.code.is_unique and ew.name.notna().all() and len(ew) == 35672, len(ew)
ew['nation'] = ew.code.str[0]
assert set(ew.nation) == {'E', 'W'}
ew.loc[ew['epc co2'] <= 0, 'epc co2'] = None            # a few LSOAs have a zero or negative median: not meaningful
parts = [ew]

# Scotland: the Scottish Government's domestic EPC extract (statistics.gov.scot, one CSV per lodgement quarter, in one .7z;
# needs `pip install py7zr`). Every certificate carries its 2011 data zone. Per data zone: median score, share in band C or
# above (score 69+), median CO2 and the number of certificates. Out-of-range scores (the extract is not cleansed) are dropped.
import glob, tempfile
SCOT = glob.glob('source/scotland-epc-*.7z')
if SCOT:
    import py7zr
    use = ['BUILDING_REFERENCE_NUMBER', 'LODGEMENT_DATE', 'CURRENT_ENERGY_EFFICIENCY', 'CO2_EMISSIONS_CURRENT', 'DATA_ZONE_2011', 'LOCAL_AUTHORITY_LABEL']
    with tempfile.TemporaryDirectory() as tmp:
        with py7zr.SevenZipFile(SCOT[0]) as z:
            z.extractall(path=tmp)
        d = pd.concat([pd.read_csv(f, dtype=str, encoding='utf-8-sig', usecols=use, skiprows=[1]) for f in sorted(glob.glob(f'{tmp}/Q*.csv'))], ignore_index=True)
    d = d[d.DATA_ZONE_2011.str.match(r'^S01\d{6} \(', na=False)].copy()
    d['code'] = d.DATA_ZONE_2011.str[:9]
    d['name'] = d.DATA_ZONE_2011.str[11:-1]
    d['score'] = pd.to_numeric(d.CURRENT_ENERGY_EFFICIENCY, errors='coerce')
    d['co2'] = pd.to_numeric(d.CO2_EMISSIONS_CURRENT, errors='coerce')
    d = d[d.score.between(1, 100)]
    d = d.sort_values('LODGEMENT_DATE').drop_duplicates('BUILDING_REFERENCE_NUMBER', keep='last')   # one current certificate per building
    g = d.groupby('code').agg(name=('name', 'first'), la_name=('LOCAL_AUTHORITY_LABEL', lambda s: s.mode().iat[0] if s.notna().any() else ''),
                              **{'epc score': ('score', 'median'), 'epc co2': ('co2', 'median'), 'epc count': ('score', 'size')})
    g['epc band c'] = d.assign(c=d.score >= 69).groupby('code').c.mean() * 100
    g = g.reset_index()
    g['nation'] = 'S'; g['la_code'] = ''
    g['epc co2'] = g['epc co2'].round(1); g['epc band c'] = g['epc band c'].round(2)
    parts.append(g)
    print(f'{len(g)} Scottish data zones from {len(d):,} certificates; fewest per zone {int(g["epc count"].min())}')

# Northern Ireland: Census 2021 table CT0063 (NISRA), EPC band by household characteristic, by local government district. The
# "accommodation type" sheet covers every household, so its rows are summed per council. Gives only the share of homes WITH
# an EPC that are in band C or above, the number rated and the number of households (about half have none).
NI = 'source/ni-census-2021-ct0063-epc-band.xlsx'
if os.path.exists(NI):
    t = pd.read_excel(NI, sheet_name='Accommodation type', header=5)
    t = t[t['Geography Code'].astype(str).str.match(r'^N09\d{6}$', na=False)]
    bands = [f'EPC rating: {b}' for b in 'ABCDEFG']
    t = t.groupby(['Geography Code', 'Geography'])[bands + ['No EPC rating']].sum().reset_index()
    rated = t[bands].sum(axis=1)
    ni = pd.DataFrame({'code': t['Geography Code'], 'name': t['Geography'].str.strip(), 'nation': 'N', 'la_code': '', 'la_name': '',
                       'epc band c': (t[bands[:3]].sum(axis=1) / rated * 100).round(2), 'epc count': rated, 'epc homes': rated + t['No EPC rating']})
    assert len(ni) == 11
    parts.append(ni)
    print('11 Northern Ireland councils: rated homes', int(rated.sum()), 'of', int(ni['epc homes'].sum()))

out = pd.concat(parts, ignore_index=True)
for c in ['epc count', 'epc homes']:
    out[c] = out[c].astype('Int64')
assert out.code.is_unique
out = out[['code', 'name', 'nation', 'la_code', 'la_name', 'epc score', 'epc band c', 'epc co2', 'epc count', 'epc homes']]
out.to_csv('data/epc.csv', index=False)
print(out.groupby('nation').size().to_dict(), 'rows -> data/epc.csv')
