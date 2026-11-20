#!/usr/bin/env python3
"""Boundaries -> PMTiles (shapes and area code only; the data is joined in the browser).

  python3 tools/build_tiles.py source/LSOA_2021_EW_BGC.gpkg data/tiles/lsoa-2021-ew.pmtiles

Needs: geopandas (pip install geopandas pyogrio) and tippecanoe >= 2.x (https://github.com/felt/tippecanoe;
set TIPPECANOE=/path/to/tippecanoe if it is not on the PATH).
Only the area code is kept in the tiles, so changing or adding data never means rebuilding them.
Rebuild only when the boundaries change (a new vintage, another nation)."""
import os, subprocess, sys, tempfile
import geopandas as gpd

src, out = sys.argv[1], sys.argv[2]
code_field = os.environ.get('CODE_FIELD', 'CODE')       # the code column in the source file
layer = os.environ.get('LAYER', 'areas')               # layer name inside the tiles
minz, maxz = os.environ.get('MINZ', '4'), os.environ.get('MAXZ', '12')

g = gpd.read_file(src)[[code_field, 'geometry']].rename(columns={code_field: 'code'})
g = g.to_crs(4326)
g['geometry'] = g.geometry.make_valid()
print(f'{len(g)} areas; codes start with', sorted(g.code.str[0].unique()))
tmp = tempfile.mktemp(suffix='.geojsonl')
g.to_file(tmp, driver='GeoJSONSeq', COORDINATE_PRECISION=6)   # one feature per line, so tippecanoe can read in parallel
cmd = [os.environ.get('TIPPECANOE', 'tippecanoe'), '-o', out, '--force', '-l', layer, f'-Z{minz}', f'-z{maxz}',
       '--detect-shared-borders', '--coalesce-smallest-as-needed', '--no-tile-size-limit', '--no-feature-limit',
       '--read-parallel', '-q', tmp]
print(' '.join(cmd)); subprocess.run(cmd, check=True); os.remove(tmp)
print(f'{out}: {os.path.getsize(out) / 1e6:.1f} MB')
