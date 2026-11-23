"""Community data packs -> compact files for the map.

Inputs (unzipped into source/community/): census/, cni/ and map/ from the three packs.
Outputs:
  data/cni.csv                     Community Needs Index, one row per map area (LSOA, data zone, SOA), deciles per nation.
                                   Wales' LSOAs take their MSOA's values, Scotland's data zones their intermediate zone's.
  data/community-spaces.csv        Changes in community spaces per council: window, category, stock_a, stock_b, gains, losses.
  data/councils.csv                council code, name.
  data/communities/<topic>.csv     Census counts (broad groups only) per map area, both censuses, one file per topic.
  data/communities/index.json      Groups, labels, years and notes for the page.

Run: python3 tools/build_community_data.py [source/community]
Broad and detail groups count the same people, so only the broad grain is written (the detail grain is never added to it).
Counts of 2011 areas that were split between 2021 areas are fractional; they are kept to one decimal.
"""
import json
import sys
from pathlib import Path

import pandas as pd

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else 'source/community')
OUT = Path('data')
(OUT / 'communities').mkdir(parents=True, exist_ok=True)


def tile_codes():
    codes = {}
    for key, f in [('lsoa', 'lsoa-2021-ew'), ('dz', 'dz-2011-s'), ('soa', 'soa-2001-n')]:
        codes[key] = list(pd.read_csv(OUT / f'{f}-centroids.csv')['code'])
    return codes


TILES = tile_codes()
ALL_TILES = set().union(*TILES.values())


# ── Community Needs Index ──────────────────────────────────────────────────────────────────────────
def build_cni():
    scores = pd.read_csv(SRC / 'cni/cni_scores.csv')
    look = pd.read_csv(SRC / 'cni/cni_tile_lookup.csv')
    dep = pd.read_csv(OUT / 'deprivation-uk.csv', usecols=['code', 'name', 'nation', 'la_code', 'la_name'])
    s = scores.rename(columns={'area_code': 'cni_area', 'area_name': 'cni area name', 'area_level': 'cni area level'})
    m = look.merge(s, left_on='cni_area_code', right_on='cni_area', how='left').rename(columns={'tile_code': 'code'})
    m = m[m['code'].isin(ALL_TILES)]
    m = dep.merge(m, on='code', how='inner')
    m['inherited'] = (m['cni_area'] != m['code']).astype(int)
    out = pd.DataFrame({
        'code': m['code'], 'name': m['name'], 'nation': m['nation_x'] if 'nation_x' in m else m['nation'],
        'la_code': m['la_code'], 'la_name': m['la_name'],
        'cni decile': m['cni_decile'], 'cni rank': m['cni_rank_in_nation'], 'cni score': m['cni_score'].round(1),
        'civic decile': m['civic_assets_decile'], 'civic score': m['civic_assets_score'].round(1),
        'connected decile': m['connectedness_decile'], 'connected score': m['connectedness_score'].round(1),
        'engaged decile': m['engaged_decile'], 'engaged score': m['engaged_score'].round(1),
        'left behind': m['left_behind'],
        # Only where the area takes a larger area's values: that area's name and kind.
        'cni area': m['cni area name'].where(m['inherited'] == 1, ''),
        'cni area level': m['cni area level'].where(m['inherited'] == 1, ''),
        'inherited': m['inherited'],
    })
    out.to_csv(OUT / 'cni.csv', index=False)
    print('cni.csv', len(out), 'areas;', int(out['inherited'].sum()), 'inherit a parent area’s values;', int(out['cni decile'].isna().sum()), 'without values')


# ── Community spaces ───────────────────────────────────────────────────────────────────────────────
def build_spaces():
    a = pd.read_csv(SRC / 'map/area_changes_lad.csv')
    names = pd.read_csv(SRC / 'map/council_names.csv')
    lad = set(pd.read_csv(OUT / 'lad-2026-centroids.csv')['code'])
    extra = sorted(set(a['area_code']) - lad)
    print('councils in the data but not on the map (dropped):', extra)
    a = a[a['area_code'].isin(lad)]
    out = a[['area_code', 'window', 'category', 'stock_a', 'stock_b', 'gains', 'losses']].copy()
    out.insert(2, 'layer', a['layer'])
    out.columns = ['code', 'window', 'layer', 'category', 'stock_a', 'stock_b', 'gains', 'losses']
    for c in ['stock_a', 'stock_b', 'gains', 'losses']:
        out[c] = out[c].map(lambda v: '' if pd.isna(v) else str(int(v)) if float(v).is_integer() else str(round(v, 1)))
    out.to_csv(OUT / 'community-spaces.csv', index=False)
    names = names[names['code'].isin(lad)]
    names.to_csv(OUT / 'councils.csv', index=False)
    cats = json.load(open(SRC / 'map/categories.json'))
    json.dump({'categories': cats['categories'], 'layers': [{k: v for k, v in l.items() if k != 'categories'} for l in cats['layers']],
               'rules': cats['rules'], 'notes': cats['notes']}, open(OUT / 'community-spaces.json', 'w'), indent=1)
    print('community-spaces.csv', len(out), 'rows;', a['area_code'].nunique(), 'councils')


# ── Census ─────────────────────────────────────────────────────────────────────────────────────────
def build_census():
    cats = json.load(open(SRC / 'census/census_categories.json'))
    c = pd.read_csv(SRC / 'census/census_changes_zone.csv.gz')
    c = c[c['grain'] == 'broad']                    # never mix grains: broad and detail count the same people
    # NI tiles are 2001 SOAs; each takes the super data zone that holds it (a few water/odd areas have none).
    lk = pd.read_csv(SRC / 'census/lookup_soa01_tile_to_sdz21.csv').dropna()
    ni = lk.merge(c[c['area_level'] == 'sdz21'], left_on='sdz21_code', right_on='area_code').drop(columns=['area_code'])
    ni = ni.rename(columns={'soa01_code': 'area_code'})
    ni['area_code'] = ni['area_code']
    c = pd.concat([c[c['area_level'] != 'sdz21'], ni.drop(columns=['sdz21_code'])], ignore_index=True)
    c = c[c['area_code'].isin(ALL_TILES)]
    index = {'years': cats['years'], 'notes': cats['notes'], 'topics': {}}
    for topic, grains in cats['topics'].items():
        order = list(grains['broad'])
        t = c[c['topic'] == topic]
        wide = t.pivot_table(index='area_code', columns='category', values=['count_a', 'count_b'], aggfunc='first')
        tot = t.groupby('area_code')[['total_a', 'total_b']].first()
        out = pd.DataFrame(index=wide.index)
        out['total_a'], out['total_b'] = tot['total_a'], tot['total_b']
        for k in order:
            out[f'{k}_a'] = wide[('count_a', k)] if ('count_a', k) in wide else 0
            out[f'{k}_b'] = wide[('count_b', k)] if ('count_b', k) in wide else 0
        out = out.fillna(0).round(1)
        def fmt(v):
            return str(int(v)) if float(v).is_integer() else str(v)
        out = out.astype(float).map(fmt)
        out.index.name = 'code'
        out.to_csv(OUT / 'communities' / f'{topic}.csv')
        q = t.groupby('area_level')['quality'].agg(lambda s: sorted(set(s))).to_dict()
        index['topics'][topic] = {'categories': [{'id': k, 'label': grains['broad'][k]} for k in order], 'quality': q}
        print(f'communities/{topic}.csv', len(out), 'areas,', len(order), 'groups')
    json.dump(index, open(OUT / 'communities' / 'index.json', 'w'), indent=1)


build_cni()
build_spaces()
build_census()
