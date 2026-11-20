# Portrait of a Nation

Interactive map of the UK for visualising data: switch between datasets, colour the areas, click an
area to see its local information. A static site (GitHub Pages), no build step on the page, no paid services.
Working title: the repository's name; change `title` in `js/config.js`.

> **Status: step 1 of 4.** The page shell, the two looks, the error system and hash addresses are in place.
> There are no datasets or boundaries yet. Planned order: (1) this scaffold, (2) a PMTiles pipeline and the
> QGIS-style map with one nation's data, (3) the other nations, the dataset switcher and the click panel,
> (4) vector PDF export.

Started from the code of the Atlas of Warmth (`i-blazevicius/atlas-of-warmth`, commit `018269d`). Code is
copied, not shared: if the same bug has to be fixed in both, extract the shared part then.

## Looks

Two, in `data/styles.json`: **QGIS** (default; plain, white, cartographic) and **Sad Earth** (dark, carried over
from the Atlas). The visitor's choice is remembered in their browser. Each look sets the page's fonts and
colours (`css`) and the map's colours (`map`). Settings a look leaves out go back to the built-in values in
`css/style.css`.

## Addresses

An area has its own address, so Back and Forward work and any area can be bookmarked or shared:
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
- `js/styles.js` – the looks
- `js/config.js` – settings
- `css/style.css` – styling (built-in values are the QGIS look)
- `data/styles.json` – the looks and their fonts
- `source/` – originals as downloaded (Excel, CSV, JSON, boundary files) for the build scripts to read. GitHub Pages
  serves everything in the repository, so keep files here well under GitHub's 100 MB per-file limit
- `lib/` – MapLibre GL JS 6.18 (BSD licence) and Papa Parse 5.5 (MIT), kept here so the page has no outside
  dependencies apart from Google Fonts

## Testing locally

Serve the folder (`python3 -m http.server 8765`) and open `http://localhost:8765/`. In the cloud workspace the
map is checked with headless Chrome (`puppeteer-core`, SwiftShader for software WebGL).
