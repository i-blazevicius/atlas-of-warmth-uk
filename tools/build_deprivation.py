#!/usr/bin/env python3
"""Deprivation indices of the four nations -> one UK-wide CSV the site reads.

  python3 tools/build_deprivation.py

Reads the originals in source/ (see source/README.md) and writes:
  data/deprivation-uk.csv       one row per small area: code, name, nation, local authority, and for each measure
                                a decile and a rank. Each nation ranks only its own areas, so a decile means
                                "within this nation" and is not comparable across borders.
  data/deprivation-england-lad.csv   England's local-authority summaries (rank of average rank).

Measures are matched across nations only where the domains plainly correspond (income, employment, health,
education, crime). Domains one or two nations have (Wales's physical environment, England's barriers to housing
and services, ...) are kept as their own measures; other nations have no value for them.

Deciles: England, Wales and Scotland's overall SIMD come with official deciles. Scotland's domain deciles and all
of Northern Ireland's are derived here from the ranks (ten equal groups, decile 1 = most deprived), the same
rule the official deciles use. Those are marked in data/deprivation-uk-derived.csv.
"""
import math
import re
import geopandas as gpd
import pandas as pd

S = 'source/'
MEASURES = ['imd', 'income', 'employment', 'health', 'education', 'crime', 'access', 'housing', 'barriers',
            'living', 'physical', 'idaci', 'idaopi']
derived = []   # (nation, measure) pairs whose deciles were derived from ranks


def decile_from_rank(rank, n):
    return rank.apply(lambda r: math.ceil(r * 10 / n) if pd.notna(r) else pd.NA).astype('Int64')


def frame(nation, codes, names, la_codes, la_names):
    return pd.DataFrame({'code': codes.values, 'name': names.values, 'nation': nation,
                         'la_code': la_codes.values if la_codes is not None else '', 'la_name': la_names.values})


# ── England: IoD 2025, File 7 (every rank and decile) ──────────────────────────
e = pd.read_csv(S + 'File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv')
def ecol(prefix, kind):
    hits = [c for c in e.columns if any(c.startswith(p) for p in prefix.split('|')) and re.search(rf'\b{kind}\b', c)]
    assert len(hits) == 1, (prefix, kind, hits)
    return e[hits[0]]
E_SRC = {'imd': 'Index of Multiple Deprivation', 'income': 'Income Decile|Income Rank', 'employment': 'Employment ',
         'education': 'Education, Skills', 'health': 'Health Deprivation', 'crime': 'Crime ',
         'barriers': 'Barriers to Housing', 'living': 'Living Environment',
         'idaci': 'Income Deprivation Affecting Children', 'idaopi': 'Income Deprivation Affecting Older'}
eng = frame('E', e['LSOA code (2021)'], e['LSOA name (2021)'], e['Local Authority District code (2024)'],
            e['Local Authority District name (2024)'])
for m, p in E_SRC.items():
    eng[f'{m} decile'] = ecol(p, 'Decile').values
    eng[f'{m} rank'] = ecol(p, 'Rank').values

# ── Wales: WIMD 2025 (long format: one row per area, domain and measure type) ──
w = pd.read_csv(S + 'WIMD2025_ranks_and_groups_LSOA.csv', low_memory=False)
w = w[w['Area code'].str.startswith('W01')]
W_SRC = {'WIMD': 'imd', 'Income': 'income', 'Employment': 'employment', 'Health': 'health', 'Education': 'education',
         'Community safety': 'crime', 'Access to services': 'access', 'Housing': 'housing',
         'Physical environment': 'physical'}
w = w[w['Data description'].isin(['Rank', 'Decile'])].copy()
w['col'] = w['Domain'].map(W_SRC) + ' ' + w['Data description'].str.lower()
wide = w.pivot_table(index='Area code', columns='col', values='Data values', aggfunc='first')
first = w.drop_duplicates('Area code').set_index('Area code')
la_names = w[['Area name_hierarchy']].drop_duplicates()
wal = frame('W', wide.index.to_series(), first.loc[wide.index, 'Area name'], first.loc[wide.index, 'Area name_hierarchy'],
            pd.Series([''] * len(wide)))
for c in wide.columns:   # values above 999 are written with a thousands comma ("1,301")
    wal[c] = pd.to_numeric(pd.Series(wide[c].values).astype(str).str.replace(',', ''), errors='coerce').values
lsoa_la = gpd.read_file(S + 'LSOA_2021_EW_BGC.gpkg', ignore_geometry=True)
la_name_of = dict(pd.read_csv(S + 'WIMD2025_ranks_and_groups_LSOA.csv', low_memory=False)
                  .query("`Area code`.str.startswith('W06')", engine='python')[['Area code', 'Area name']].drop_duplicates().values)
wal['la_name'] = wal['la_code'].map(la_name_of)

# ── Scotland: SIMD 2020v2 (the GIS file carries ranks and the overall decile) ──
s = gpd.read_file(S + 'SG_SIMD_2020/SG_SIMD_2020.shp', ignore_geometry=True)
n_s = len(s)
sco = frame('S', s['DataZone'], s['DZName'], None, s['LAName'])
S_SRC = {'imd': 'Rankv2', 'income': 'IncRankv2', 'employment': 'EmpRank', 'health': 'HlthRank', 'education': 'EduRank',
         'access': 'GAccRank', 'crime': 'CrimeRank', 'housing': 'HouseRank'}
for m, c in S_SRC.items():
    sco[f'{m} rank'] = pd.to_numeric(s[c], errors='coerce').values
    if m == 'imd':
        sco[f'{m} decile'] = s['Decilev2'].values
    else:
        sco[f'{m} decile'] = decile_from_rank(sco[f'{m} rank'], n_s).values
        derived.append(('S', m))

# ── Northern Ireland: NIMDM 2017 (ranks only; one sheet per domain) ────────────
x = pd.ExcelFile(S + 'NIMDM17_SOAresults.xls')
mdm = x.parse('MDM')
mdm.columns = [re.sub(r'\s+', ' ', str(c)).strip() for c in mdm.columns]
n_n = len(mdm)
ni = frame('N', mdm['SOA2001'], mdm['SOA2001_name'], None, mdm['LGD2014NAME'])
N_SRC = {'imd': 'Multiple Deprivation Measure Rank', 'income': 'Income Domain Rank', 'employment': 'Employment Domain Rank',
         'health': 'Health Deprivation and Disability Domain Rank', 'education': 'Education, Skills and Training Domain Rank',
         'access': 'Access to Services Domain Rank', 'living': 'Living Environment Domain Rank',
         'crime': 'Crime and Disorder Domain Rank'}
for m, p in N_SRC.items():
    c = next(c for c in mdm.columns if c.startswith(p))
    ni[f'{m} rank'] = pd.to_numeric(mdm[c], errors='coerce').values
idac = x.parse('IDAC and IDAP').set_index('SOA2001')
idac.columns = [re.sub(r'\s+', ' ', str(c)).strip() for c in idac.columns]
ni['idaci rank'] = pd.to_numeric(idac.loc[mdm['SOA2001'], next(c for c in idac.columns if 'aged 15 and under' in c and '(Rank)' in c)].values, errors='coerce')
ni['idaopi rank'] = pd.to_numeric(idac.loc[mdm['SOA2001'], next(c for c in idac.columns if 'aged 65 and over' in c and '(Rank)' in c)].values, errors='coerce')
for m in list(N_SRC) + ['idaci', 'idaopi']:
    ni[f'{m} decile'] = decile_from_rank(ni[f'{m} rank'], n_n).values
    derived.append(('N', m))

# ── Together ───────────────────────────────────────────────────────────────────
out = pd.concat([eng, wal, sco, ni], ignore_index=True)
cols = ['code', 'name', 'nation', 'la_code', 'la_name'] + [f'{m} {k}' for m in MEASURES for k in ('decile', 'rank')]
for c in cols:
    if c not in out:
        out[c] = pd.NA
out = out[cols]
for c in cols[5:]:
    v = pd.to_numeric(out[c], errors='coerce')
    if c.endswith('decile'):
        out[c] = v.astype('Int64')
    else:   # ranks: whole numbers, except Scotland's tied areas, which share a half rank (e.g. 5955.5)
        out[c] = v.map(lambda x: '' if pd.isna(x) else (str(int(x)) if x % 1 == 0 else str(x)))
out.to_csv('data/deprivation-uk.csv', index=False)
pd.DataFrame(derived, columns=['nation', 'measure']).to_csv('data/deprivation-uk-derived.csv', index=False)
print('data/deprivation-uk.csv', out.shape)
print(out.groupby('nation').agg(**{f'{m}': (f'{m} decile', 'count') for m in MEASURES}).to_string())
print('ranks present:', out.groupby('nation').agg(**{f'{m}': (f'{m} rank', lambda s: (s != '').sum()) for m in MEASURES}).to_string())

# England's local-authority summaries (rank of average rank), unchanged apart from short headers.
lad = pd.read_csv(S + 'IoD2025_LAD_Summaries_lower-tier_Rank_of_average_rank.csv')
LAD = {'Local Authority District code': 'la_code', 'Local Authority District name': 'la_name', 'Index of Multiple': 'imd',
       'Income -': 'income', 'Employment -': 'employment', 'Education': 'education', 'Health': 'health', 'Crime': 'crime',
       'Barriers': 'barriers', 'Living': 'living', 'IDACI': 'idaci', 'IDAOPI': 'idaopi'}
lad.columns = [next(v for k, v in LAD.items() if c.startswith(k)) for c in lad.columns]
lad.to_csv('data/deprivation-england-lad.csv', index=False)
print('data/deprivation-england-lad.csv', lad.shape)
