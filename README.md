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
  coast isn't traced twice. The **coastline** is a separate layer (the outer edge of the four nations, on like the other
  outlines, listed first in the Outlines menu, drawn with the same thin line as local authorities); it includes Northern
  Ireland's land border with Ireland.
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
- **Click panel**: every dataset that has values for the area, whichever mode is active (a dataset with nothing for that kind of area is left out). One coloured block per measure the area's nation has, with the
  decile inside and the nation's own name; hovering shows the rank within the nation. England's areas also get their
  local authority's rank.
- **Indicators behind a domain**: click a decile block or its name in the click panel to open the indicators the
  domain is calculated from (raw values, with the nation's median for context). Nothing is loaded until then: first
  `data/indicators/index.json`, then one small CSV per nation and domain (`data/indicators/<N>-<measure>.csv`). Built by
  `python3 tools/build_indicators.py` from the originals in `source/`. Which nations have indicators for a measure is
  `indicators` in `js/config.js` → `measures[]`; overall deprivation has none (it is built from the domains). Open
  domains stay open as other areas are clicked. Values stored as fractions in the originals are shown as percentages.
- **Links**: `#E01033653` opens the area and moves the map there, using the one-point-per-area files
  (`data/*-centroids.csv`, `tools/build_centroids.py`), read only when a link or Back/Forward opens an area.

### Fuel poverty (England and Scotland)

`data/fuel-poverty.csv` is built by `python3 tools/build_fuel_poverty.py` from DESNZ's *Sub-regional fuel poverty
in England, 2026 report (2024 data)* detailed tables (put the .xlsx in `source/`; Open Government Licence v3.0). It has two
views: **local authorities** (the reliable one, drawn from `data/tiles/lad-2026.pmtiles`, an optional area set that is only
drawn for measures listing it in `areas`) and **LSOAs** (finer, but modelled: use for general patterns, not for ranking
individual LSOAs). Rates are coloured in classes (`classes` in `js/config.js`), not deciles. The figure is England's Low Income
Low Energy Efficiency measure. Scotland (32 councils, SHCS 2022–24, put in `source/shcs-local-authority-tables-2022-2024.ods`) uses the 10%-of-income definition, so it has the same colours but its own class edges (`classes.breaks` per nation): compare areas within a nation only. For comparisons, each English LSOA and Scottish data zone can also take its council's rate (`lad rate inherited` in the CSV, the measure "Local authority rate (shared by its areas)", `compareOnly` in the config so it isn't a map or click-panel measure): rough, area-level, and Wales has none. Wales publishes national figures only and Northern Ireland none below NI level, so neither is mapped.


### Energy efficiency (EPC), all four nations

`data/epc.csv` is built by `python3 tools/build_epc.py` (Scotland needs `pip install py7zr`). Sources, saved in `source/`:
- **England and Wales (LSOAs):** MHCLG live tables LT_1 (median score), LT_2 (% in band C or above), LT_3 (median CO2) for 2026,
  sheets `*_2`, as `epc-LT_<n>-….ods`. Only homes with an EPC in the last ten years count; the tables give no counts and suppress
  nothing, so thin areas cannot be flagged.
- **Scotland (2011 data zones):** the Scottish Government's domestic EPC extract Q4 2016 to Q3 2026 from statistics.gov.scot
  (`scotland-epc-….7z`, 41 CSVs). Each certificate carries its data zone; the script keeps one current certificate per building,
  drops impossible scores (the extract is not cleansed) and takes the median score and CO2 and the share in band C or above per
  zone (6,973 zones, at least 26 certificates each). The certificate count is in the click-panel tooltip. Address fields are not
  used, so the Royal Mail address-data conditions do not apply to what is published here.
- **Northern Ireland (11 councils):** NISRA Census 2021 table CT0063, sheet "Accommodation type", summed per council. Only the
  share of homes *with* an EPC that are in band C or above is mapped; about half of homes have none (shown in the tooltip).

Each measure has its own `classes` in `js/config.js`; `breaks` is one list for every nation or one per nation, and nations with
the same edges share a legend column. A measure's `areas` lists the area sets drawn for it and `where` limits one of them to some
nations (NI councils come from the local authority tiles, which also hold other nations' councils). Certificates are calculated
differently in each nation and NI's figure is a different statistic, so each nation has its own edges: compare areas within a
nation only.

## Compare two measures

"Compare two measures" in the control panel colours the map by two measures at once on a 3 × 3 grid (palette in `bivariate.colours` in `js/config.js`). Pick the measure for the horizontal axis ("Across") and the vertical one ("Up"); choices that share no area with the other axis, or are the same measure, are greyed out.

- Each area is put in the best, middle or worst third of **its own nation** on each measure (`computeThirds` in `js/app.js`; ties share a third by the middle of their rank, so deciles split 3 / 4 / 3). The darkest cell is worst on both. A measure's `worse: 'low'` in the config marks a low number as the bad end (deprivation deciles and the EPC measures); otherwise high is bad.
- The thirds are stored in feature state (`<dataset>:<measure>:third`), so changing the pair only changes the paint expression. Areas without both values are grey.
- The pair is in the address: `#bi=deprivation.imd,fuelpoverty.lsoa` (with an area code too: `#E01000001&bi=…`).
- The legend (`js/legendgrid.js`, drawn as SVG on screen and as vectors in the PDF) is a borderless grid with an arrow up its left side and one along its bottom (they don't meet), "best on both" / "worst on both" at the corners, the vertical measure's name as right-aligned horizontal text beside its arrow and the horizontal one below.
- Modes (Compare two measures, Deprivation, Fuel poverty, Energy efficiency) are chosen with a radio button; only the chosen mode's measures, selectors and opacity slider are active. Choosing a mode unfolds its group and folds the others; folding by hand still works.

## PDF export

The "Export PDF" group in the control panel saves the map as a vector PDF (areas, outlines, legend, scale bar, compass and credits are paths and text, so they stay sharp at any size). Choose the current view or the whole UK, a paper size (A4 to A0) and landscape or portrait.

- The shapes are read back from the map at the zoom being exported and simplified lightly, so the PDF matches the screen. Detail follows the window size: a larger window gives a more detailed PDF.
- Furniture is a fixed physical size on any paper: legend 100 mm wide (bottom left), compass 10 mm across with the scale bar beside it (bottom right), credits in one line underneath (shrunk to fit the page width). Outline weights are the live map's, in points, whatever the paper.
- "Exact shapes (slow)" reads the full-resolution boundaries instead: the map visits the region one screen at a time at a high zoom (one screen pixel about 0.03 mm of paper, up to the tiles' top zoom 12; at most 2500 screens) and adds each screen's shapes to the PDF as they arrive, skipping pieces already seen. Areas go into a transparency group so overlapping tile pieces leave no seams. Whole UK on A3 took about 50 s (7.6 MB) in a headless test.
- The base map is a picture (place names a separate transparent picture above the data), because it is drawn from tiles.
- `js/pdf.js` is a small PDF writer (one page, Helvetica, opacity, images); `js/export.js` turns the map into a page; `js/scalebar.js` is the stepped scale bar shared with the live map.
- Not included: the Doto face (Helvetica is used) and the selected-area highlight.

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
- `tools/build_tiles.py` – boundaries → PMTiles; `tools/build_centroids.py` – boundaries → one point per area; `tools/build_deprivation.py` – the four nations' deprivation downloads → site CSVs; `tools/build_indicators.py` – their underlying indicators → `data/indicators/`; `tools/build_epc.py` – MHCLG EPC live tables → `data/epc.csv`; `tools/build_epc.py` – EPC tables, register extract and census table → `data/epc.csv`; `tools/build_fuel_poverty.py` – DESNZ fuel poverty tables and the Scottish House Condition Survey council tables → `data/fuel-poverty.csv`; `tools/serve.py` – local test server with byte-range support
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
