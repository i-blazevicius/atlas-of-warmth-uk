#!/usr/bin/env python3
"""Northern Ireland's 2001 Super Output Areas, built from the 2001 Output Areas.

  python3 tools/build_ni_soa.py

NISRA's SOA boundary download was unavailable, so the 890 SOAs are made by merging the 5,022 output areas
(source/OA_ni/OA_ni.shp) by the OA -> SOA column of NISRA's geography lookup
(source/NI_lookup_SA2011_SOA2011_OA2001_2016.ods, sheet "OA"). Output areas nest exactly in SOAs, so the result
has the same outlines. Writes source/SOA2001_NI.gpkg (code, name, geometry), for tools/build_tiles.py."""
import geopandas as gpd
import pandas as pd

S = 'source/'
raw = pd.read_excel(S + 'NI_lookup_SA2011_SOA2011_OA2001_2016.ods', sheet_name='OA', header=None, engine='odf')
head = raw.index[raw[0].astype(str).str.strip() == 'OA'][0]
lk = raw.iloc[head + 1:, :2].dropna()
lk.columns = ['OA', 'SOA']
names = pd.read_excel(S + 'NI_lookup_SA2011_SOA2011_OA2001_2016.ods', sheet_name='SOA', header=None, engine='odf')
h = names.index[names[0].astype(str).str.strip() == 'SOA Code'][0]
names = dict(names.iloc[h + 1:, :2].dropna().values)

oa = gpd.read_file(S + 'OA_ni/OA_ni.shp')
oa = oa.merge(lk, left_on='OA_CODE', right_on='OA', how='left')
missing = oa['SOA'].isna().sum()
print(f'{len(oa)} output areas, {missing} without an SOA in the lookup')
oa['geometry'] = oa.geometry.make_valid()
soa = oa.dissolve(by='SOA', as_index=False)[['SOA', 'geometry']].rename(columns={'SOA': 'code'})
soa['name'] = soa['code'].map(names)
print(f'{len(soa)} SOAs')
soa.to_file(S + 'SOA2001_NI.gpkg', driver='GPKG')
