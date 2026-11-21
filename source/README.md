# source/

Originals as downloaded (deprivation indices, boundary files, rasters), before any tidying. The build scripts in
`tools/` (added in step 2) read from here and write the files the site uses. Nothing in this folder is read by the page. The downloads themselves are listed in `.gitignore` (too big for GitHub's 100 MB file limit and not needed by the site); only this note is kept in the repository.

Expected files (names as `tools/build_deprivation.py` reads them):
- England, IoD 2025: `File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv`, `File_8_IoD2025_Underlying_Indicators.xlsx`,
  `IoD2025_LAD_Summaries_lower-tier_Rank_of_average_rank.csv`
- Wales, WIMD 2025: `WIMD2025_ranks_and_groups_LSOA.csv`, `WIMD2025_indicators_<domain>.csv` (seven files), `WIMD2025_indicators_by_decile.csv`
- Scotland, SIMD 2020v2: `SG_SIMD_2020/` (the GIS shapefile: boundaries, ranks, deciles and indicators), `SIMD2020v2_ranks.xlsx`, `SIMD2020v2_indicators.xlsx`
- Northern Ireland, NIMDM 2017: `NIMDM17_SOAresults.xls`; `OA_ni/` (2001 output areas) and `NI_lookup_SA2011_SOA2011_OA2001_2016.ods`
  (NISRA lookup), merged into `SOA2001_NI.gpkg` by `tools/build_ni_soa.py`
- Boundaries: `LSOA_2021_EW_BGC.gpkg`; outlines `Countries_Dec2021_UK_BGC.gpkg`, `Regions_Dec2021_EN_BGC.gpkg`, `LAD_May2026_UK_BGC.gpkg`
