"""Add the Ordnance Survey Points of Interest layer (layer id 'os') to the community-spaces data files.

Reads source/map/area_changes_os_lad.csv and source/map/categories_os.json (the supplement: same columns as
area_changes_lad.csv, council level, Great Britain only) and writes its rows and categories into
data/community-spaces.csv and data/community-spaces.json. Any earlier 'os' rows are replaced first, so it can be
re-run. tools/build_community_data.py calls this after it rebuilds the other layers.

    python3 tools/add_os_layer.py
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'source/map', ROOT / 'data'
LAYER = 'os'


def add_os_layer():
    rows = list(csv.DictReader(open(SRC / 'area_changes_os_lad.csv', newline='')))
    sup = json.load(open(SRC / 'categories_os.json'))
    councils = {r['code'] for r in csv.DictReader(open(OUT / 'councils.csv', newline=''))}
    fields = ['code', 'window', 'layer', 'category', 'stock_a', 'stock_b', 'gains', 'losses']
    kept = [r for r in csv.DictReader(open(OUT / 'community-spaces.csv', newline='')) if r['layer'] != LAYER]
    new = [{'code': r['area_code'], 'window': r['window'], 'layer': LAYER, 'category': r['category'],
            'stock_a': r['stock_a'], 'stock_b': r['stock_b'], 'gains': r['gains'], 'losses': r['losses']}
           for r in rows if r['area_code'] in councils]
    dropped = {r['area_code'] for r in rows} - councils
    with open(OUT / 'community-spaces.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n')
        w.writeheader()
        w.writerows(kept + new)

    meta = json.load(open(OUT / 'community-spaces.json'))
    meta['layers'] = [l for l in meta['layers'] if l['id'] != LAYER] + [{k: v for k, v in l.items() if k != 'categories'} for l in sup['layers']]
    meta['categories'] = [c for c in meta['categories'] if c['layer'] != LAYER] + sup['categories']
    meta['releases'] = {**meta.get('releases', {}), LAYER: sup['releases']}
    meta['notes'] = {**meta['notes'], LAYER: sup['notes']['scope'] + ' ' + sup['notes']['dates'] + ' ' + sup['notes']['gains_losses'] + ' ' + sup['notes']['2015'] + ' ' + sup['notes']['use']}
    json.dump(meta, open(OUT / 'community-spaces.json', 'w'), indent=1)
    print(f'os layer: {len(new)} rows, {len({r["code"] for r in new})} councils; not on the map (dropped): {sorted(dropped)}')


if __name__ == '__main__':
    add_os_layer()
