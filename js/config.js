// ─────────────────────────────────────────────────────────────
//  Settings. Everything you are likely to want to change lives in this file.
//  Fonts and colours of the page and map come from data/styles.json; css/style.css holds the built-in values.
//  If the map stops loading after an edit here, it shows error E1: undo the last change on GitHub.
// ─────────────────────────────────────────────────────────────

export default {

  // Working title (the repository's name). Shown in the control panel and the browser tab.
  title: 'Portrait of a Nation',

  data: {
    styles: 'data/styles.json',
  },

  // Base map under the data: OpenFreeMap (free, no key; attribution is shown automatically, bottom right).
  // Place names are drawn above the data; everything else below it.
  underlay: {
    style: 'https://tiles.openfreemap.org/styles/positron',
    label: 'Base map',
    opacity: 1,                       // starting opacity, 0…1
    labels: true,                     // place names on at start
    labelsMask: 'data/uk-mask.json',  // labels outside this outline are hidden (tools/build_uk_mask.py); remove to show all
    hideRoadNumbers: true,            // road numbers and motorway shields are never drawn; street names stay
  },

  // Boundaries: PMTiles files holding only the shapes and the area code (tools/build_tiles.py).
  // `codes` says which area codes each file holds, so a dataset row finds its shape.
  areas: {
    lsoa: {
      file: 'data/tiles/lsoa-2021-ew.pmtiles',
      layer: 'areas', code: 'code',
      codes: '^[EW]01',
      centroids: 'data/lsoa-2021-ew-centroids.csv',   // one point per area, to move to an area opened by a link
      label: 'LSOA (2021), England and Wales',
    },
    dz: {
      file: 'data/tiles/dz-2011-s.pmtiles',
      layer: 'areas', code: 'code',
      codes: '^S01',
      centroids: 'data/dz-2011-s-centroids.csv',
      label: 'Data zones (2011), Scotland',
    },
    soa: {
      file: 'data/tiles/soa-2001-n.pmtiles',
      layer: 'areas', code: 'code',
      codes: '^95',
      centroids: 'data/soa-2001-n-centroids.csv',
      label: 'Super Output Areas (2001), Northern Ireland',   // built from the 2001 output areas: tools/build_ni_soa.py
    },
  },

  // Administrative outlines over the data (tools/build_outlines.py): only borders between neighbouring areas, no coast.
  // Each has a white casing under it so it reads over dark colours. `width` is [at zoom 5, at zoom 12] in pixels;
  // `from` is the zoom it fades in at.
  outlines: {
    file: 'data/tiles/outlines.pmtiles',
    layers: [
      { id: 'lads', label: 'Local authorities', color: '#3a3a3a', width: [0.35, 1.1], from: 6, on: true },
      { id: 'regions', label: 'Regions (England)', color: '#222222', width: [0.6, 1.8], from: 4, on: true },
      { id: 'nations', label: 'Nations', color: '#111111', width: [1.1, 2.6], from: 3, on: true },
    ],
  },

  // The four nations, as they appear in the `nation` column of a dataset.
  nations: { E: 'England', W: 'Wales', S: 'Scotland', N: 'Northern Ireland' },

  // Datasets. Columns are found by header text (exact, then "starts with"), never by position.
  // Each measure colours the map by `<id> decile` and shows `<id> rank` on hover in the click panel.
  // `names` gives each nation's own name for the measure; a nation not listed has no value for it.
  datasets: [
    {
      id: 'deprivation',
      label: 'Deprivation',
      file: 'data/deprivation-uk.csv',
      key: 'code', name: 'name', nation: 'nation',
      parent: { code: 'la_code', name: 'la_name' },
      opacity: 0.8,                   // starting opacity, 0…1
      // Areas ranked in each nation, for "rank 120 of 33,755".
      totals: { E: 33755, W: 1917, S: 6976, N: 890 },
      note: 'Deciles are calculated separately for each nation (1 = most deprived 10% of that nation’s areas), from different indicators, so they are not comparable across borders.',
      sources: {
        E: 'English indices of deprivation 2025 (MHCLG), LSOA 2021.',
        W: 'Welsh Index of Multiple Deprivation 2025 (Welsh Government), LSOA 2021.',
        S: 'Scottish Index of Multiple Deprivation 2020v2 (Scottish Government), data zones 2011. Domain deciles derived from the ranks.',
        N: 'Northern Ireland Multiple Deprivation Measure 2017 (NISRA), SOA 2001 (shapes merged from NISRA’s 2001 output areas). Deciles derived from the ranks.',
      },
      licence: 'Data and boundaries under the Open Government Licence v3.0.',
      measures: [
        { id: 'imd', label: 'Overall deprivation',
          names: { E: 'Index of Multiple Deprivation', W: 'Welsh Index of Multiple Deprivation', S: 'Scottish Index of Multiple Deprivation', N: 'Multiple Deprivation Measure' } },
        { id: 'income', label: 'Income', names: { E: 'Income', W: 'Income', S: 'Income', N: 'Income' } },
        { id: 'employment', label: 'Employment', names: { E: 'Employment', W: 'Employment', S: 'Employment', N: 'Employment' } },
        { id: 'health', label: 'Health',
          names: { E: 'Health deprivation and disability', W: 'Health', S: 'Health', N: 'Health deprivation and disability' } },
        { id: 'education', label: 'Education',
          names: { E: 'Education, skills and training', W: 'Education', S: 'Education, skills and training', N: 'Education, skills and training' } },
        { id: 'crime', label: 'Crime', names: { E: 'Crime', W: 'Community safety', S: 'Crime', N: 'Crime and disorder' } },
        { id: 'access', label: 'Access to services', names: { W: 'Access to services', S: 'Geographic access to services', N: 'Access to services' } },
        { id: 'housing', label: 'Housing', names: { W: 'Housing', S: 'Housing' } },
        { id: 'barriers', label: 'Barriers to housing and services', names: { E: 'Barriers to housing and services' } },
        { id: 'living', label: 'Living environment', names: { E: 'Living environment', N: 'Living environment' } },
        { id: 'physical', label: 'Physical environment', names: { W: 'Physical environment' } },
        { id: 'idaci', label: 'Income deprivation affecting children',
          names: { E: 'Income deprivation affecting children (IDACI)', N: 'Children in income-deprived households' } },
        { id: 'idaopi', label: 'Income deprivation affecting older people',
          names: { E: 'Income deprivation affecting older people (IDAOPI)', N: 'Older people in income-deprived households' } },
      ],
      // England's local authorities: rank of average rank, one row per local authority.
      parentRanks: { file: 'data/deprivation-england-lad.csv', key: 'la_code', label: 'local authorities in England' },
    },
  ],

  // Credits for the boundaries, shown with the base map's in the map's attribution (bottom right).
  attribution: 'Boundaries: Office for National Statistics, Scottish Government, NISRA; Open Government Licence v3.0. Contains OS data © Crown copyright and database right 2026.',

  // Starting view: the whole UK. [longitude, latitude], zoom.
  view: {
    center: [-3.2, 55.0],
    zoom: 5.0,
    minZoom: 4,                       // the floor; the map also stops at the data's full extent (below)
    wallPadding: 0,                   // degrees of slack beyond the extent: the view's centre can't be dragged past it
    extent: [[-8.7, 49.8], [1.9, 60.9]],   // [[west, south], [east, north]]: zooming out stops when this just fits
    maxZoom: 15,
  },
};
