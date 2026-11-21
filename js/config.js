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
    // An optional area set is drawn only for a measure that lists it in its `areas` (the others are drawn for every measure
    // without an `areas` list). `lines: false` leaves out its own boundary lines (the outlines below draw local authorities).
    lad: {
      file: 'data/tiles/lad-2026.pmtiles',
      layer: 'areas', code: 'code',
      codes: '^(E0[6-9]|W06|S12|N09)',
      centroids: 'data/lad-2026-centroids.csv',
      label: 'Local authorities (May 2026)',
      optional: true, lines: false,
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
        { id: 'income', label: 'Income', indicators: 'EWSN', names: { E: 'Income', W: 'Income', S: 'Income', N: 'Income' } },
        { id: 'employment', label: 'Employment', indicators: 'EWSN', names: { E: 'Employment', W: 'Employment', S: 'Employment', N: 'Employment' } },
        { id: 'health', label: 'Health', indicators: 'EWSN',
          names: { E: 'Health deprivation and disability', W: 'Health', S: 'Health', N: 'Health deprivation and disability' } },
        { id: 'education', label: 'Education', indicators: 'EWSN',
          names: { E: 'Education, skills and training', W: 'Education', S: 'Education, skills and training', N: 'Education, skills and training' } },
        { id: 'crime', label: 'Crime', indicators: 'EWSN', names: { E: 'Crime', W: 'Community safety', S: 'Crime', N: 'Crime and disorder' } },
        { id: 'access', label: 'Access to services', indicators: 'WSN', names: { W: 'Access to services', S: 'Geographic access to services', N: 'Access to services' } },
        { id: 'housing', label: 'Housing', indicators: 'WS', names: { W: 'Housing', S: 'Housing' } },
        { id: 'barriers', label: 'Barriers to housing and services', indicators: 'E', names: { E: 'Barriers to housing and services' } },
        { id: 'living', label: 'Living environment', indicators: 'EN', names: { E: 'Living environment', N: 'Living environment' } },
        { id: 'physical', label: 'Physical environment', indicators: 'W', names: { W: 'Physical environment' } },
        { id: 'idaci', label: 'Income deprivation affecting children', indicators: 'EN',
          names: { E: 'Income deprivation affecting children (IDACI)', N: 'Children in income-deprived households' } },
        { id: 'idaopi', label: 'Income deprivation affecting older people', indicators: 'EN',
          names: { E: 'Income deprivation affecting older people (IDAOPI)', N: 'Older people in income-deprived households' } },
      ],
      // England's local authorities: rank of average rank, one row per local authority.
      // Indicators behind each domain, read only when a visitor expands a domain in the click panel (tools/build_indicators.py).
      // A measure's `indicators` lists the nations that have them (E, W, S, N).
      indicatorsDir: 'data/indicators/',
      parentRanks: { file: 'data/deprivation-england-lad.csv', key: 'la_code', label: 'local authorities in England' },
    },
    {
      id: 'fuelpoverty', label: 'Fuel poverty',
      file: 'data/fuel-poverty-england.csv',        // tools/build_fuel_poverty.py
      key: 'code', name: 'name', nation: 'nation',
      parent: { code: 'la_code', name: 'la_name' },
      opacity: 0.8,
      // Measures that are a rate, not a decile: coloured in classes. `breaks` are the class edges in the measure's unit.
      classes: { breaks: [8, 10, 12, 14, 16], colours: ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#2c7fb8', '#253494'], unit: '%' },
      note: 'England only, for now. Share of households in fuel poverty: low income and a home that is expensive to heat (the Low Income Low Energy Efficiency measure, 2024). Scotland and Wales define it differently, so their figures would not be comparable.',
      sources: { E: 'Sub-regional fuel poverty in England, 2026 report (2024 data), Department for Energy Security and Net Zero. Modelled from the English Housing Survey.' },
      licence: 'Open Government Licence v3.0.',
      measures: [
        { id: 'lad', label: 'Local authorities', kind: 'rate', value: 'lad rate', rank: null, areas: ['lad'],
          counts: ['fuel poor households', 'households'], names: { E: 'Households in fuel poverty' } },
        { id: 'lsoa', label: 'LSOAs (finer, less reliable)', kind: 'rate', value: 'lsoa rate', rank: null, areas: ['lsoa'],
          counts: ['fuel poor households', 'households'], names: { E: 'Households in fuel poverty' },
          caution: 'LSOA figures are modelled estimates: use them to spot general patterns and very high or low areas, not to rank or compare individual LSOAs.' },
      ],
    },
  ],

  // Credits for the boundaries, shown with the base map's in the map's attribution (bottom right).
  attribution: 'Boundaries: Office for National Statistics, Scottish Government, NISRA; Open Government Licence v3.0. Fuel poverty: DESNZ; Open Government Licence v3.0. Contains OS data © Crown copyright and database right 2026.',

  // Starting view: the whole UK. [longitude, latitude], zoom.
  view: {
    center: [-3.2, 55.0],
    zoom: 5.0,
    minZoom: 4,                       // the floor; the map also stops at the data's full extent (below)
    wallSlack: 0.25,                  // how far the extent may be dragged past the window's edge, as a share of the window (0 = flush)
    extent: [[-8.7, 49.8], [1.9, 60.9]],   // [[west, south], [east, north]]: zooming out stops when this just fits
    maxZoom: 15,
  },
};
