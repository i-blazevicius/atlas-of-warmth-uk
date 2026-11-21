# Portrait of a Nation

Interactive map of the UK for visualising data: switch between datasets, colour the areas, click an
area to see its local information. A static site (GitHub Pages), no build step on the page, no paid services.
Working title: the repository's name; change `title` in `js/config.js`.

> **Status: step 1 of the revised plan done.** England's Indices of Deprivation 2025 on the QGIS-style map, with
> foldable control and legend panels, a compact click panel and links that move the map to the area. Planned next:
> (2) OpenFreeMap underlay with its own opacity/visibility, an opacity slider for the data layer and administrative
> outlines (nations, England's regions, local authorities); (3) the dataset panel (several datasets, on/off,
> opacity) and Wales, Scotland and Northern Ireland; (4) the indicators behind each decile, loaded on demand;
> (5) more datasets; (6) vector PDF export; (7) bivariate maps.

Started from the code of the Atlas of Warmth (`i-blazevicius/atlas-of-warmth`, commit `018269d`). Code is
copied, not shared: if the same bug has to be fixed in both, extract the shared part then.

## Look

One look for now, the QGIS style (plain, white, cartographic), in `data/styles.json`: page fonts and colours (`css`),
map colours and the 10-class colour ramp (`map`). Settings it leaves out go back to the built-in values in
`css/style.css`. (A dark look, Sad Earth, was dropped; it is in the Atlas repository if wanted again.)

## How the data gets onto the map

- **Shapes** are in a PMTiles file (`data/tiles/lsoa-2021-ew.pmtiles`, England and Wales LSOAs, 2021) holding only the
  area code. MapLibre reads it by byte ranges straight from GitHub Pages. Rebuild only when boundaries change:
  `python3 tools/build_tiles.py source/<boundaries>.gpkg data/tiles/<name>.pmtiles`
  (needs `geopandas` and [tippecanoe](https://github.com/felt/tippecanoe); set `TIPPECANOE=` if it isn't on the PATH).
  Each rebuilt file adds ~30 MB to the repository's history, so don't rebuild casually.
- **Values** are plain CSV files keyed by area code (`data/imd-england.csv`), read by the page and written into
  each area's feature state once at load (~0.1 s for 33,755 areas). Switching measure only changes the colour
  expression. Reformatting a dataset or adding a derived column means re-running `python3 tools/build_data.py`
  (or editing the CSV): the tiles are not touched.
- **Datasets and measures** are listed in `js/config.js` → `datasets`. Columns are found by header text.
- **Click panel**: one coloured block per measure with the decile number inside; hovering a block or its label shows the
  exact rank. A note gives the local authority's rank.
- **Links**: `#E01033653` opens the area and moves the map there. The one-point-per-area file for this
  (`data/lsoa-2021-ew-centroids.csv`, `tools/build_centroids.py`) is read only when a link or Back/Forward opens an area.

## Addresses

An area has its own address (the map moves to it), so Back and Forward work and any area can be bookmarked or shared:
`…/portrait-of-a-nation/#E06000001`. Area codes are ONS codes: `E`, `W`, `S` or `N` followed by 8 digits.

## When something goes wrong

If the page cannot start, a box in the middle of the page gives a code and says what happened:

| Code | Meaning | What to do |
|---|---|---|
| E1 | `js/config.js` can't be read: a comma, bracket or quote is missing or extra | On GitHub, open the file's History and correct or undo the last change |
| E2 | A dataset or sheet couldn't be reached, or answered with an error | Check the internet connection, then the links in `js/config.js` → `data` |
| E3 | A Google Sheet tab came back as a web page instead of data: it is no longer published | Google Sheets → File → Share → Publish to web |
| E4 | *(reserved)* A dataset has no area-code column | Check the header row of the dataset |
| E5 | A file of the site itself (the looks file, boundaries) is missing or not valid | Check that it is in the repository, and its History if it was edited |
| E6 | Anything else: an error in the code | If it started after an edit on GitHub, undo that edit |

Smaller problems don't stop the map. They are listed in the control panel under the title: a renamed
column, an area code the boundaries don't know, and so on.

Columns in datasets are matched by **header text** (exact, then "starts with"), never by position.

## Files

- `index.html` – the map
- `js/head.js` – shared start of every page: fonts, the last-used look, stylesheets, the error box
- `js/app.js` – map behaviour, addresses, panels
- `js/core.js` – errors, small problems, reading CSV files
- `tools/build_tiles.py` – boundaries → PMTiles; `tools/build_centroids.py` – boundaries → one point per area; `tools/build_data.py` – deprivation downloads → site CSVs; `tools/serve.py` – local test server with byte-range support
- `js/styles.js` – the looks
- `js/config.js` – settings
- `css/style.css` – styling (built-in values are the QGIS look)
- `data/styles.json` – the looks and their fonts, map colours and the 10-class colour ramp
- `data/tiles/` – PMTiles boundaries; `data/imd-england*.csv` – England's deprivation ranks and deciles (LSOA, and local-authority summaries)
- `source/` – originals as downloaded (Excel, CSV, JSON, boundary files) for the build scripts to read. The files themselves are
  git-ignored (too big for GitHub's 100 MB per-file limit); only the folder's note is committed
- `lib/` – MapLibre GL JS 6.18 (BSD licence), PMTiles 4.5 (BSD-3-Clause) and Papa Parse 5.5 (MIT), kept here so the page has no outside
  dependencies apart from Google Fonts

## Testing locally

Serve the folder with `python3 tools/serve.py .` and open `http://localhost:8765/`. Python's own `http.server` won't do: PMTiles needs byte-range requests. In the cloud workspace the
map is checked with headless Chrome (`puppeteer-core`, SwiftShader for software WebGL).
