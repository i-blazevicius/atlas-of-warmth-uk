#!/usr/bin/env python3
"""Administrative outlines -> one PMTiles file with three line layers, drawn over the data.

  python3 tools/build_outlines.py

Reads from source/: Countries (Dec 2021, UK, BGC), Regions (Dec 2021, England, BGC) and Local Authority Districts
(May 2026, UK, BGC), all from the ONS Open Geography Portal. Only the borders *between* neighbouring areas are kept, not the
coastline (the base map and the data already show the coast), so each layer is a set of lines:
  nations   borders between England, Wales and Scotland
  regions   borders between England's nine regions
  coast     the outer edge of the four nations (added last, below)
  lads      borders between local authorities (London boroughs, Welsh principal areas, Scottish council areas,
            Northern Ireland's districts)
Writes data/tiles/outlines.pmtiles (needs geopandas and tippecanoe; TIPPECANOE= if not on the PATH).
Note: Northern Ireland's land border with Ireland is the edge of the UK files, so it is dropped with the coast."""
import os, subprocess, tempfile
import geopandas as gpd
from shapely.geometry import MultiLineString
from shapely.ops import linemerge

S = 'source/'
FILES = {'nations': ('Countries_Dec2021_UK_BGC.gpkg', 'CTRY21NM'),
         'regions': ('Regions_Dec2021_EN_BGC.gpkg', 'RGN21NM'),
         'lads': ('LAD_May2026_UK_BGC.gpkg', 'LAD26NM')}
tmp = tempfile.mkdtemp()
args = []
for layer, (f, name) in FILES.items():
    g = gpd.read_file(S + f).to_crs(27700)              # metres, so the 1 m tolerance below means something
    g = g.reset_index(drop=True)
    g['geometry'] = g.geometry.make_valid()
    # Each pair of neighbouring areas shares a stretch of border: the intersection of their outlines.
    # Borders shared with nothing (coast, and NI's land border with Ireland) never appear.
    pairs = gpd.sjoin(g[['geometry']], g[['geometry']], predicate='intersects')
    pairs = pairs[pairs.index < pairs['index_right']]
    lines = []
    for i, j in zip(pairs.index, pairs['index_right']):
        shared = g.geometry[i].boundary.intersection(g.geometry[j].boundary)
        if shared.is_empty:
            continue
        if shared.geom_type == 'GeometryCollection':          # keep the line parts, drop stray touching points
            shared = [x for x in shared.geoms if 'Line' in x.geom_type]
            shared = MultiLineString([c for x in shared for c in (x.geoms if hasattr(x, 'geoms') else [x])]) if shared else None
        if shared is not None and shared.geom_type == 'MultiLineString':
            shared = linemerge(shared)                         # join the pieces into continuous lines
        if shared is not None:
            lines.append(shared)
    out = gpd.GeoDataFrame({'layer': [layer] * len(lines)}, geometry=lines, crs=27700).explode(index_parts=False)
    out = out[out.geom_type.isin(['LineString', 'MultiLineString'])].to_crs(4326)   # drop single touching points
    print(f'{layer}: {len(g)} areas, {len(pairs)} neighbouring pairs -> {len(out)} border lines')
    path = f'{tmp}/{layer}.geojsonl'
    out.to_file(path, driver='GeoJSONSeq', COORDINATE_PRECISION=6)
    args += ['-L', f'{layer}:{path}']
# Coastline: the outer edge of the four nations' union (it includes Northern Ireland's land border with Ireland, which is the
# edge of the UK files).
g = gpd.read_file(S + FILES['nations'][0]).to_crs(27700)
edge = g.geometry.make_valid().union_all().boundary
coast = gpd.GeoDataFrame({'layer': ['coast']}, geometry=[edge], crs=27700).explode(index_parts=False).to_crs(4326)
print(f'coast: {len(coast)} lines')
path = f'{tmp}/coast.geojsonl'
coast.to_file(path, driver='GeoJSONSeq', COORDINATE_PRECISION=6)
args += ['-L', f'coast:{path}']
cmd = [os.environ.get('TIPPECANOE', 'tippecanoe'), '-o', 'data/tiles/outlines.pmtiles', '--force', '-Z3', '-z12', '-q',
       '--no-tile-size-limit', '--no-feature-limit', '--simplification=4'] + args
subprocess.run(cmd, check=True)
print(f'data/tiles/outlines.pmtiles: {os.path.getsize("data/tiles/outlines.pmtiles") / 1e6:.1f} MB')
