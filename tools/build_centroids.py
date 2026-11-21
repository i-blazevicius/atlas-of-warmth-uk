#!/usr/bin/env python3
"""Boundaries -> a small CSV of one point per area (code, lon, lat), so the page can fly to an area it opens from a link.

  python3 tools/build_centroids.py source/LSOA_2021_EW_BGC.gpkg data/lsoa-2021-ew-centroids.csv

Uses a point guaranteed to lie inside each area (not the geometric centre, which can fall outside odd shapes)."""
import os, sys
import geopandas as gpd

src, out = sys.argv[1], sys.argv[2]
code_field = os.environ.get('CODE_FIELD', 'CODE')
g = gpd.read_file(src)[[code_field, 'geometry']].rename(columns={code_field: 'code'}).to_crs(4326)
p = g.geometry.make_valid().representative_point()
g['lon'], g['lat'] = p.x.round(5), p.y.round(5)
g[['code', 'lon', 'lat']].to_csv(out, index=False)
print(f'{out}: {len(g)} areas, {os.path.getsize(out) / 1e6:.2f} MB')
