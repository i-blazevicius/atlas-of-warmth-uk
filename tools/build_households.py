"""Households per small area -> data/households.csv (code, households, basis).

England and Wales: Census 2021 TS041 by LSOA (ONS), one CSV of both nations.
Scotland: NRS small area household estimates by 2011 data zone, 2025 sheet ("occupied dwellings" is NRS's household count).
Northern Ireland: Census 2011 households by SOA (NISRA), scaled so each local government district (2014 boundaries)
  adds up to its Census 2021 total (MS-E01). Rough: an SOA's share of its district is assumed unchanged since 2011.
Inputs go in source/ (names below); run: python3 tools/build_households.py
"""
import pandas as pd

S = 'source/'
EW = S + 'TS041-2021-lsoa-england-wales.csv'
SC = S + 'household-estimates-by-2011-data-zones.xlsx'
NI11 = S + 'NI_census-2011-households-table.xlsx'
NI21 = S + 'NI_census-2021-ms-e01.xlsx'
LOOKUP = S + 'NI_lookup_SA2011_SOA2011_OA2001_2016.ods'

# The 26 districts of 2011 grouped into the 11 of 2014 (names as in the NISRA lookup, upper case).
NEW = {
    'Antrim and Newtownabbey': ['ANTRIM', 'NEWTOWNABBEY'],
    'Armagh City, Banbridge and Craigavon': ['ARMAGH', 'BANBRIDGE', 'CRAIGAVON'],
    'Belfast': ['BELFAST'],
    'Causeway Coast and Glens': ['BALLYMONEY', 'COLERAINE', 'LIMAVADY', 'MOYLE'],
    'Derry City and Strabane': ['DERRY', 'STRABANE'],
    'Fermanagh and Omagh': ['FERMANAGH', 'OMAGH'],
    'Lisburn and Castlereagh': ['LISBURN', 'CASTLEREAGH'],
    'Mid and East Antrim': ['BALLYMENA', 'CARRICKFERGUS', 'LARNE'],
    'Mid Ulster': ['COOKSTOWN', 'DUNGANNON', 'MAGHERAFELT'],
    'Newry, Mourne and Down': ['DOWN', 'NEWRY AND MOURNE'],
    'Ards and North Down': ['ARDS', 'NORTH DOWN'],
}

ew = pd.read_csv(EW).iloc[:, [0, 2]]
ew.columns = ['code', 'households']
ew['basis'] = 'Census 2021'

sc = pd.read_excel(SC, sheet_name='2025', header=3)[['Data Zone code', 'Occupied dwellings']]
sc.columns = ['code', 'households']
sc['basis'] = 'Council tax records 2025'

ni = pd.read_excel(NI11, sheet_name='SOA', header=4)[['SOA Code', 'Households']]
ni.columns = ['code', 'h11']
look = pd.read_excel(LOOKUP, sheet_name='SOA', header=4)[['SOA Code', 'LGD1992NAME']]
ni = ni.merge(look, left_on='code', right_on='SOA Code', how='left')
back = {old: new for new, olds in NEW.items() for old in olds}
ni['lgd'] = ni['LGD1992NAME'].str.upper().str.replace('&', 'AND', regex=False).map(back)
assert ni.lgd.notna().all(), ni[ni.lgd.isna()]
t21 = pd.read_excel(NI21, sheet_name='LGD', header=5).set_index('Geography')['All households']
assert set(NEW) <= set(t21.index), set(NEW) - set(t21.index)
ni['households'] = ni.h11 * ni.lgd.map(t21) / ni.groupby('lgd').h11.transform('sum')
ni['basis'] = 'Census 2011, scaled to 2021 district totals'

out = pd.concat([ew, sc, ni[['code', 'households', 'basis']]], ignore_index=True)
out['households'] = out.households.round().astype(int)
out.to_csv('data/households.csv', index=False)
print(out.groupby(out.code.str[0]).households.agg(['count', 'sum']))
