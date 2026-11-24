# Which council each small area belongs to (data/area-council.csv: code, council), for showing a council-level measure
# (Community Spaces) over small areas in "Compare two measures". Uses only files already in data/:
#   England and Wales: the local authority code in data/epc.csv (2026 authorities, as data/councils.csv);
#   Scotland and Northern Ireland: the council name in data/deprivation-uk.csv, matched to data/councils.csv by name.
import re
import pandas as pd

councils = pd.read_csv('data/councils.csv')
nrm = lambda n: re.sub(r'\s+', ' ', str(n)).strip().lower().replace('&', 'and')
by_name = {nrm(n): c for c, n in zip(councils.code, councils.name)}
by_name['edinburgh, city of'] = by_name['city of edinburgh']
by_name['na h-eileanan an iar'] = by_name['na h-eileanan siar']

epc = pd.read_csv('data/epc.csv', usecols=['code', 'nation', 'la_code'], low_memory=False)
ew = epc[epc.nation.isin(['E', 'W']) & epc.la_code.isin(set(councils.code))][['code', 'la_code']].rename(columns={'la_code': 'council'})
dep = pd.read_csv('data/deprivation-uk.csv', usecols=['code', 'nation', 'la_name'], low_memory=False)
sn = dep[dep.nation.isin(['S', 'N'])].copy()
sn['council'] = sn.la_name.map(lambda n: by_name.get(nrm(n)))
assert sn.council.notna().all(), sn[sn.council.isna()].la_name.unique()
out = pd.concat([ew, sn[['code', 'council']]], ignore_index=True)
assert out.code.is_unique
out.to_csv('data/area-council.csv', index=False)
print(len(out), 'areas ->', out.council.nunique(), 'councils; by nation:', out.code.str[0].map(lambda x: 'N' if x == '9' else x).value_counts().to_dict())
