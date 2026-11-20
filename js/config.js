// ─────────────────────────────────────────────────────────────
//  Settings. Everything you are likely to want to change lives in this file.
//  Fonts and colours of the page and map come from the styles in data/styles.json;
//  css/style.css holds the built-in values.
//  If the map stops loading after an edit here, it shows error E1: undo the last change on GitHub.
// ─────────────────────────────────────────────────────────────

export default {

  // Working title (the repository's name). Shown in the control panel and the browser tab.
  title: 'Portrait of a Nation',

  data: {
    styles: 'data/styles.json',        // the two looks: QGIS (default) and Sad Earth
    // Datasets, boundaries and PMTiles are added here as they are built (steps 2 and 3).
  },

  // Starting view: the whole UK. [longitude, latitude], zoom.
  view: {
    center: [-3.0, 54.6],
    zoom: 5.2,
    minZoom: 3,
    maxZoom: 14,
  },
};
