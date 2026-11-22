// ─────────────────────────────────────────────────────────────
//  Settings. Everything you are likely to want to change lives in this file.
//  Fonts and colours of the page and map come from data/styles.json; css/style.css holds the built-in values.
//  If the map stops loading after an edit here, it shows error E1: undo the last change on GitHub.
// ─────────────────────────────────────────────────────────────

export default {

  // Working title (the repository's name). Shown in the control panel and the browser tab.
  title: 'Atlas of Warmth UK',

  // Households per small area (data/households.csv, built by tools/build_households.py): shown in the click panel and used for
  // the household count of a highlighted legend class.
  households: { file: 'data/households.csv' },

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
      // The coastline is drawn first (below the borders) but listed first in the menu; it is the outer edge of the four nations.
      { id: 'coast', label: 'Coastline', color: '#3a3a3a', width: [0.35, 1.1], from: 3, on: true, menuFirst: true },
      { id: 'lads', label: 'Local authorities', color: '#3a3a3a', width: [0.35, 1.1], from: 6, on: true },
      { id: 'regions', label: 'Regions (England)', color: '#222222', width: [0.6, 1.8], from: 4, on: true },
      { id: 'nations', label: 'Nations', color: '#111111', width: [1.1, 2.6], from: 3, on: true },
    ],
  },

  // Compare two measures: a 3 × 3 grid. Rows run from the best third of the vertical measure (bottom) to the worst (top),
  // columns from the best third of the horizontal one (left) to the worst (right); the darkest cell is worst on both.
  // A measure's `worse: 'low'` says a low number is the bad end (deprivation deciles and the EPC measures); otherwise high is bad.
  bivariate: {
    colours: [['#64acbe', '#627f8c', '#574249'], ['#b0d5df', '#ad9ea5', '#985356'], ['#e8e8e8', '#e4acac', '#c85a5a']],
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
      file: 'data/fuel-poverty.csv',        // tools/build_fuel_poverty.py
      key: 'code', name: 'name', nation: 'nation',
      parent: { code: 'la_code', name: 'la_name' },
      opacity: 0.8,
      // Measures that are a rate, not a decile: coloured in classes. `breaks` are the class edges in the measure's unit, one list per
      // nation (the same colours, but each nation's own edges: the definitions differ, so areas are only compared within a nation).
      classes: { breaks: { E: [8, 10, 12, 14, 16], S: [26, 29, 32, 35, 38] }, colours: ['#f2f6b4', '#c7e9b4', '#7fcdbb', '#41b6c4', '#2c7fb8', '#253494'], unit: '%' },
      note: 'Share of households in fuel poverty. The definitions differ (England: low income and an energy-inefficient home; Scotland: fuel costs above 10% of income, after housing costs), so each nation has its own class edges: compare areas within a nation only. Wales and Northern Ireland publish no figures for small areas.',
      sources: {
        E: 'Sub-regional fuel poverty in England, 2026 report (2024 data), Department for Energy Security and Net Zero. Modelled from the English Housing Survey.',
        S: 'Scottish House Condition Survey: Local Authority Analysis 2022-2024, Scottish Government. Survey estimates; rounded to whole per cent.',
      },
      licence: 'Open Government Licence v3.0.',
      measures: [
        { id: 'lad', label: 'Local authorities', kind: 'rate', value: 'lad rate', rank: null, areas: ['lad'],
          counts: ['fuel poor households', 'households'], names: { E: 'Households in fuel poverty', S: 'Households in fuel poverty' } },
        // Only for comparing with other measures: every LSOA / data zone takes its local authority's rate (rough, area-level).
        { id: 'ladi', label: 'Local authority rate (shared by its areas)', kind: 'rate', value: 'lad rate inherited', rank: null, areas: ['lsoa', 'dz'],
          compareOnly: true, names: { E: 'Local authority fuel poverty rate', S: 'Local authority fuel poverty rate' } },
        { id: 'lsoa', label: 'LSOAs', kind: 'rate', value: 'lsoa rate', rank: null, areas: ['lsoa', 'dz', 'soa'],
          counts: ['fuel poor households', 'households'], names: { E: 'Households in fuel poverty' },
          caution: 'LSOA figures are modelled estimates: use them to spot general patterns and very high or low areas, not to rank or compare individual LSOAs.' },
      ],
    },
    {
      id: 'epc', label: 'Energy efficiency (EPC)',
      file: 'data/epc.csv',                         // tools/build_epc.py
      key: 'code', name: 'name', nation: 'nation',
      parent: { code: 'la_code', name: 'la_name' },
      opacity: 0.8,
      note: 'Energy performance certificate (EPC) ratings of homes. Only homes with an EPC are counted (certificates are needed when a home is built, sold or let), so coverage is partial. Each nation calculates EPCs a little differently, so it has its own class edges: compare areas within a nation only. England and Wales: LSOAs; Scotland: data zones; Northern Ireland: councils (share of homes with an EPC that are in band C or above, from the 2021 Census).',
      sources: {
        E: 'Energy performance of new and existing dwellings in England and Wales: annual 2026 (live tables LT_1 to LT_3), Ministry of Housing, Communities and Local Government. EPCs lodged April 2016 to March 2026.',
        W: 'Energy performance of new and existing dwellings in England and Wales: annual 2026 (live tables LT_1 to LT_3), Ministry of Housing, Communities and Local Government. EPCs lodged April 2016 to March 2026.',
        S: 'Scottish Energy Performance Certificate Register, domestic EPC data Q4 2016 to Q3 2026, Scottish Government; one current certificate per building, aggregated here by 2011 data zone. Not cleansed by the publisher.',
        N: 'Census 2021 table CT0063, Energy Performance Certificate band by household characteristics, NISRA. Roughly half of households have no EPC.',
      },
      licence: 'Open Government Licence v3.0.',
      measures: [
        { id: 'score', label: 'Median energy rating', kind: 'rate', worse: 'low', value: 'epc score', rank: null, areas: ['lsoa', 'dz', 'soa'],
          counts: ['epc count', 'epc homes'],
          names: { E: 'Median EPC score (higher = more efficient)', W: 'Median EPC score (higher = more efficient)', S: 'Median EPC score (higher = more efficient)' },
          classes: { breaks: { E: [62, 65, 68, 71, 74], W: [62, 65, 68, 71, 74], S: [66, 68, 70, 72, 74] },
                     colours: ['#f2f6c0', '#c5e38f', '#9fd284', '#6fbb78', '#2f9b55', '#006837'] } },
        { id: 'bandc', label: 'Homes in band C or above', kind: 'rate', worse: 'low', value: 'epc band c', rank: null, areas: ['lsoa', 'dz', 'lad'], where: { lad: ['N'] }, unit: '%',
          counts: ['epc count', 'epc homes'],
          names: { E: 'Homes rated band C or above', W: 'Homes rated band C or above', S: 'Homes rated band C or above', N: 'Homes with an EPC rated band C or above' },
          classes: { breaks: { E: [30, 40, 50, 60, 70], W: [30, 40, 50, 60, 70], S: [40, 50, 60, 70, 80], N: [30, 33, 36, 38, 41] },
                     colours: ['#f2f6c0', '#c5e38f', '#9fd284', '#6fbb78', '#2f9b55', '#006837'] } },
        { id: 'co2', label: 'Median CO₂ emissions', kind: 'rate', value: 'epc co2', rank: null, areas: ['lsoa', 'dz', 'soa'], decimals: 1,
          counts: ['epc count', 'epc homes'],
          names: { E: 'Median CO₂ (tonnes a year)', W: 'Median CO₂ (tonnes a year)', S: 'Median CO₂ (tonnes a year)' },
          classes: { breaks: [2.5, 3, 3.5, 4, 4.5], colours: ['#006837', '#2f9b55', '#6fbb78', '#9fd284', '#c5e38f', '#f2f6c0'], unit: ' t' } },
      ],
    },
  ],

  // Credits for the boundaries, shown with the base map's in the map's attribution (bottom right).
  attribution: 'Boundaries: Office for National Statistics, Scottish Government, NISRA; Open Government Licence v3.0. Fuel poverty: DESNZ, Scottish Government; energy performance: MHCLG, Scottish Government, NISRA; Open Government Licence v3.0. Contains OS data © Crown copyright and database right 2026.',

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
