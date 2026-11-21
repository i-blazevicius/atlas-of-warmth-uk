"""Builds data/uk-mask.json: a coarse UK outline (GeoJSON) used to hide base-map labels outside the UK.
Source: the Countries geopackage in source/. Buffered ~3 km so coastal towns and islands stay in; simplified to stay small."""
import json, os, geopandas as gpd
S = os.path.join(os.path.dirname(__file__), '..', 'source') + os.sep
g = gpd.read_file(S + 'Countries_Dec2021_UK_BGC.gpkg').to_crs(27700)
u = g.geometry.simplify(1500).buffer(3000).union_all().simplify(1500)   # simplify first: the full-detail union is far too heavy
out = gpd.GeoSeries([u], crs=27700).to_crs(4326)
geom = json.loads(out.to_json())['features'][0]['geometry']
def rnd(c): return [round(x, 3) for x in c] if isinstance(c[0], float) else [rnd(i) for i in c]
geom['coordinates'] = rnd(geom['coordinates'])
json.dump({'type': 'Feature', 'properties': {}, 'geometry': geom}, open(os.path.join(os.path.dirname(__file__), '..', 'data', 'uk-mask.json'), 'w'), separators=(',', ':'))
b = out.total_bounds
print('bounds', [round(x, 2) for x in b])
