# Portrait of a Nation

Interactive map of the UK for visualising data: switch between datasets, colour the areas, click an
area to see its local information. A static site (GitHub Pages), no build step on the page, no paid services.
Working title: the repository's name; change `title` in `js/config.js`.

> **Status.** Deprivation for all four nations on one UK-wide dataset, over an OpenFreeMap base map (on/off, opacity,
> place names), with outlines of nations, England's regions and local authorities (each switchable) and a dataset
> opacity slider. Planned next: the indicators behind each decile, loaded on demand; more datasets; vector PDF export;
> bivariate maps.

Started from the code of the Atlas of Warmth (`i-blazevicius/atlas-of-warmth`, commit `018269d`). Code is
copied, not shared: if the same bug has to be fixed in both, extract the shared part then.

## Look

One look for now, the QGIS style (plain, white, cartographic), in `data/styles.json`: page fonts and colours (`css`),
map colours and the 10-class colour ramp (`map`). Settings it leaves out go back to the built-in values in
`css/style.css`. (A dark look, Sad Earth, was dropped; it is in the Atlas repository if wanted again.)

## How the data gets onto the map

- **Base map**: OpenFreeMap's Positron style (free, no key, no limits; its attribution is shown bottom right).
  Its layers are slotted around the data: place names above, everything else below. If it can't be reached the
  data is shown without it and a problem is listed. Set in `js/config.js` → `underlay`.
- **Shapes**: one PMTiles file per boundary set, holding only the area code, read by byte ranges straight from GitHub
  Pages: `data/tiles/lsoa-2021-ew.pmtiles` (England and Wales LSOAs 2021) and `data/tiles/dz-2011-s.pmtiles`
  (Scotland's data zones 2011) and `data/tiles/soa-2001-n.pmtiles` (Northern Ireland's SOAs 2001, merged from NISRA's 2001
  output areas by `tools/build_ni_soa.py`, as NISRA's own SOA download was unavailable). `js/config.js` → `areas` says which codes each file holds. Rebuild only when
  boundaries change: `python3 tools/build_tiles.py <boundaries> data/tiles/<name>.pmtiles` (set `CODE_FIELD=` to
  the code column; needs `geopandas` and [tippecanoe](https://github.com/felt/tippecanoe), `TIPPECANOE=` if it isn't on
  the PATH). Each rebuilt file adds its size to the repository's history, so don't rebuild casually.
- **Outlines**: `data/tiles/outlines.pmtiles`, built by `python3 tools/build_outlines.py` from ONS Countries and Regions
  (Dec 2021, BGC) and Local Authority Districts (May 2026, BGC). Only borders between neighbouring areas are kept, so the
  coast isn't traced twice; Northern Ireland's land border with Ireland is dropped with it (the base map shows it).
  Each level has a white casing so it reads over dark colours; widths and colours in `js/config.js` → `outlines`.
- **Values**: plain CSV keyed by area code, read by the page and written into each area's feature state once at load
  (~0.2 s for 43,500 areas). Switching measure only changes the colour expression; data changes never touch the tiles.
- **Deprivation** (`data/deprivation-uk.csv`, built by `python3 tools/build_deprivation.py` from the originals in
  `source/`): one row per small area with a decile and rank for each measure. Each nation ranks only its own areas,
  so deciles are not comparable across borders (the legend says so). Measures are matched across nations only where
  the domains plainly correspond; the rest stay separate and other nations show "no data". Each nation's own name for
  a measure is in `js/config.js` → `measures[].names`. England, Wales and Scotland's overall SIMD come with official
  deciles; Scotland's domain deciles and all of Northern Ireland's are derived from the ranks by the same rule
  (listed in `data/deprivation-uk-derived.csv`). Scotland's tied domain ranks are kept as half ranks (e.g. 5955.5).
- **Click panel**: only datasets that are switched on. One coloured block per measure the area's nation has, with the
  decile inside and the nation's own name; hovering shows the rank within the nation. England's areas also get their
  local authority's rank.
- **Links**: `#E01033653` opens the area and moves the map there, using the one-point-per-area files
  (`data/*-centroids.csv`, `tools/build_centroids.py`), read only when a link or Back/Forward opens an area.

## Addresses

An area has its own address (the map moves to it), so Back and Forward work and any area can be bookmarked or shared:
`…/portrait-of-a-nation/#E06000001`. Area codes are ONS codes (`E`, `W`, `S` or `N` followed by 8 digits) or Northern Ireland's 2001 SOA codes (`95AA01S1`).

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
- `tools/build_tiles.py` – boundaries → PMTiles; `tools/build_centroids.py` – boundaries → one point per area; `tools/build_deprivation.py` – the four nations' deprivation downloads → site CSVs; `tools/serve.py` – local test server with byte-range support
- `js/styles.js` – the looks
- `js/config.js` – settings
- `css/style.css` – styling (built-in values are the QGIS look)
- `data/styles.json` – the looks and their fonts, map colours and the 10-class colour ramp
- `data/tiles/` – PMTiles boundaries; `data/deprivation-uk.csv` – deprivation deciles and ranks, UK; `data/deprivation-england-lad.csv` – England's local-authority summaries
- `source/` – originals as downloaded (Excel, CSV, JSON, boundary files) for the build scripts to read. The files themselves are
  git-ignored (too big for GitHub's 100 MB per-file limit); only the folder's note is committed
- `lib/` – MapLibre GL JS 6.18 (BSD licence), PMTiles 4.5 (BSD-3-Clause) and Papa Parse 5.5 (MIT), kept here so the page has no outside
  dependencies apart from Google Fonts

## Testing locally

Serve the folder with `python3 tools/serve.py .` and open `http://localhost:8765/`. Python's own `http.server` won't do: PMTiles needs byte-range requests. In the cloud workspace the
map is checked with headless Chrome (`puppeteer-core`, SwiftShader for software WebGL).

## Look and base-map settings

- **Accent colour** is black (`--accent` and `map.accent` in `data/styles.json`). The pink one is `#d6336c`: paste it back in both places to restore it.
- **Title font** is Doto (`--font-title` in `data/styles.json`).
- **Base-map labels** outside the UK are hidden using `data/uk-mask.json` (rebuild with `tools/build_uk_mask.py`). Road numbers are left out; street names stay. Both are switches under `underlay` in `js/config.js`.
- **Zoom-out limit** stops where `view.extent` (js/config.js) just fits the window, and the view cannot be dragged past that extent; fully zoomed out it is held in place (`view.wallSlack` sets how far).
