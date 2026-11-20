// ─────────────────────────────────────────────────────────────
//  Settings. Everything you are likely to want to change lives in this file.
//  Fonts and colours of the page and map come from the looks in data/styles.json;
//  css/style.css holds the built-in values.
//  If the map stops loading after an edit here, it shows error E1: undo the last change on GitHub.
// ─────────────────────────────────────────────────────────────

export default {

  // Working title (the repository's name). Shown in the control panel and the browser tab.
  title: 'Portrait of a Nation',

  data: {
    styles: 'data/styles.json',        // the two looks: QGIS (default) and Sad Earth
  },

  // Boundaries: PMTiles files holding only the shapes and the area code (tools/build_tiles.py).
  // The same boundary set can serve several datasets.
  areas: {
    lsoa: {
      file: 'data/tiles/lsoa-2021-ew.pmtiles',
      layer: 'areas',                  // layer name inside the file
      code: 'code',                    // the property holding the ONS area code
      label: 'LSOA (2021), England and Wales',
    },
  },

  // Datasets. Columns are found by header text (exact, then "starts with"), never by position.
  // Each measure is one map layer: `value` is the column that colours the map (a decile, 1 = most deprived),
  // `rank` the column shown as a rank in the click panel.
  datasets: [
    {
      id: 'imd-england',
      label: 'Indices of deprivation 2025: England',
      file: 'data/imd-england.csv',
      areas: 'lsoa',                   // which boundaries (above)
      key: 'LSOA code',                // the column holding the area code
      name: 'LSOA name',
      parent: { code: 'Local authority code', name: 'Local authority name' },
      source: 'Ministry of Housing, Communities and Local Government, English indices of deprivation 2025 (Open Government Licence v3.0). Boundaries: ONS, LSOA December 2021 BGC (Open Government Licence v3.0).',
      scale: 'decile',                 // 1…10, 1 = most deprived 10% of England's LSOAs
      total: 33755,                    // areas ranked (for "rank 120 of 33,755")
      measures: [
        { id: 'imd', label: 'Index of Multiple Deprivation', value: 'IMD decile', rank: 'IMD rank' },
        { id: 'income', label: 'Income', value: 'Income decile', rank: 'Income rank' },
        { id: 'employment', label: 'Employment', value: 'Employment decile', rank: 'Employment rank' },
        { id: 'education', label: 'Education, skills and training', value: 'Education decile', rank: 'Education rank' },
        { id: 'health', label: 'Health and disability', value: 'Health decile', rank: 'Health rank' },
        { id: 'crime', label: 'Crime', value: 'Crime decile', rank: 'Crime rank' },
        { id: 'housing', label: 'Barriers to housing and services', value: 'Housing barriers decile', rank: 'Housing barriers rank' },
        { id: 'living', label: 'Living environment', value: 'Living environment decile', rank: 'Living environment rank' },
        { id: 'idaci', label: 'Income deprivation affecting children (IDACI)', value: 'IDACI decile', rank: 'IDACI rank' },
        { id: 'idaopi', label: 'Income deprivation affecting older people (IDAOPI)', value: 'IDAOPI decile', rank: 'IDAOPI rank' },
      ],
      // Local authority comparison: rank of average rank, one row per local authority.
      parentRanks: { file: 'data/imd-england-lad.csv', key: 'Local authority code', label: 'local authorities' },
    },
  ],

  // Starting view: the whole UK. [longitude, latitude], zoom.
  view: {
    center: [-2.6, 53.6],
    zoom: 5.6,
    minZoom: 4,
    maxZoom: 14,
  },
};
