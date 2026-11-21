#!/usr/bin/env python3
"""The indicators behind each deprivation domain -> small CSVs the click panel loads on demand.

  python3 tools/build_indicators.py

Reads the originals in source/ (see source/README.md) and writes, in data/indicators/:
  <nation>-<measure>.csv   one row per small area: `code`, then one column per indicator (i1, i2, ...)
  index.json               for each nation and measure: the file, and each indicator's label, unit and the
                           nation's median (the middle value across that nation's areas, for context)

The page reads index.json and one CSV only when a visitor expands a domain in the click panel, so none of it is
loaded with the map. Values are raw indicator values (not ranks), rounded to 3 decimals. Proportions stored
as fractions in the originals are turned into percentages here.

Measures: imd has no indicators (it is built from the domains). A nation lists only the measures it has data for.
"""
import json
import os
import re
import pandas as pd

S = 'source/'
OUT = 'data/indicators/'
os.makedirs(OUT, exist_ok=True)
index = {}


def num(s):
    return pd.to_numeric(s, errors='coerce')


def add(nation, measure, codes, cols):
    """cols: list of (label, unit, values). Writes one file for the nation and measure."""
    df = pd.DataFrame({'code': pd.Series(codes).values})
    meta = []
    for i, (label, unit, vals) in enumerate(cols, 1):
        v = num(pd.Series(vals).reset_index(drop=True)).round(3)
        if v.notna().sum() == 0:
            continue
        df[f'i{len(meta) + 1}'] = v
        med = float(v.median())
        meta.append({'id': f'i{len(meta) + 1}', 'label': label, 'unit': unit, 'median': round(med, 3)})
    if not meta:
        return
    df = df.dropna(how='all', subset=[m['id'] for m in meta])
    fn = f'{nation}-{measure}.csv'
    df.to_csv(OUT + fn, index=False)
    index.setdefault(nation, {})[measure] = {'file': fn, 'indicators': meta}
    print(f'  {fn}: {len(df)} areas, {len(meta)} indicators, {os.path.getsize(OUT + fn) // 1024} KB')


# ── England: IoD 2025. Domain scores (File 7, rates) and underlying indicators (File 8) ──────────
print('England')
f7 = pd.read_csv(S + 'File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv')
f7 = f7.set_index('LSOA code (2021)')
sheets = pd.read_excel(S + 'File_8_IoD2025_Underlying_Indicators.xlsx', sheet_name=None)
def sheet(name):
    d = sheets[name]
    return d.set_index('LSOA code (2021)')

def score(prefix):
    hit = [c for c in f7.columns if c.startswith(prefix) and 'Score' in c]
    assert len(hit) == 1, (prefix, hit)
    return num(f7[hit[0]]) * 100            # a proportion -> %

def eng_cols(df, skip=('LSOA name', 'Local Authority')):
    out = []
    for c in df.columns:
        if c.startswith(skip):
            continue
        label, unit = str(c).strip(), ''
        m = re.match(r"^(.*?),\s*rate per ([\d,]+) '(.*?)'$", label)
        if m:
            label, unit = m.group(1), f'per {m.group(2)}'
        out.append((label[0].upper() + label[1:], unit, df[c]))
    return out

inc = sheet('IoD25 Income Domain')
emp = sheet('IoD25 Employment Domain')
for measure, label, prefix, df, col in [
    ('income', 'People in income deprivation', 'Income Score', inc, 'Income Domain numerator'),
    ('employment', 'Working-age people in employment deprivation', 'Employment Score', emp, 'Employment Domain numerator'),
    ('idaci', 'Children in income-deprived families', 'Income Deprivation Affecting Children', inc,
     'Income Deprivation Affecting Children Index (IDACI) numerator'),
    ('idaopi', 'Older people in income-deprived households', 'Income Deprivation Affecting Older', inc,
     'Income Deprivation Affecting Older People Index (IDAOPI) numerator'),
]:
    codes = list(df.index)
    add('E', measure, codes, [
        (label + ' (rate)', '%', score(prefix).reindex(codes)),
        (label + ' (number of people)', 'people', df[col]),
    ])
for measure, name in [('health', 'IoD25 Health Domain'), ('education', 'IoD25 Education Domain'), ('crime', 'IoD25 Crime Domain'),
                      ('barriers', 'IoD25 Barriers Domain'), ('living', 'IoD25 Living Env Domain')]:
    d = sheet(name)
    add('E', measure, list(d.index), eng_cols(d))

# ── Wales: WIMD 2025 (long format: one row per area and indicator) ───────────────────────────────
print('Wales')
W_FILES = {
    'access-to-services': {'access': None},
    'community-safety': {'crime': None},
    'education': {'education': None},
    'health': {'health': None},
    'housing': {'housing': None},
    'physical-environment': {'physical': None},
    'income-and-employment': {'income': ['inc', 'inck', 'incp'], 'employment': ['emp']},
}
def wales_unit(desc, label):
    d = str(desc)
    if d == 'Percentage':
        return '%'
    if d.startswith('Rate per'):
        return d.replace('Rate ', '')
    if 'minutes' in label:
        return 'minutes'
    if 'µg' in label:
        return 'µg/m³'
    if d == 'Average points score':
        return 'points'
    return ''
for fn, measures in W_FILES.items():
    d = pd.read_csv(S + f'WIMD2025_indicators_{fn}.csv', dtype=str)
    d = d[d['Area code'].str.startswith('W01', na=False)]
    d['v'] = num(d['Data values'])
    d['Indicator_reference'] = d['Indicator_reference'].astype(str)
    order = d.drop_duplicates('Indicator_reference').sort_values('Indicator_sort', key=num)['Indicator_reference'].tolist()
    info = d.drop_duplicates('Indicator_reference').set_index('Indicator_reference')
    wide = d.pivot_table(index='Area code', columns='Indicator_reference', values='v', aggfunc='first')
    for measure, refs in measures.items():
        use = [r for r in order if (refs is None or r in refs)]
        cols = []
        for r in use:
            label = re.sub(r',\s*(minutes|µg per cubic meter)$', '', info.loc[r, 'Indicator'])
            cols.append((label, wales_unit(info.loc[r, 'Data description'], info.loc[r, 'Indicator']), wide[r]))
        add('W', measure, list(wide.index), cols)

# ── Scotland: SIMD 2020v2 ───────────────────────────────────────────────────────────────────────
print('Scotland')
sc = pd.read_excel(S + 'SIMD2020v2_indicators.xlsx', sheet_name='Data').set_index('Data_Zone')
def pct(col):                                # stored as a fraction in the original
    v = num(sc[col])
    assert v.max() <= 1.0001, (col, v.max())
    return v * 100
S_COLS = {
    'income': [('People in income deprivation (rate)', '%', pct('Income_rate')), ('People in income deprivation (number)', 'people', sc['Income_count'])],
    'employment': [('Working-age people in employment deprivation (rate)', '%', pct('Employment_rate')),
                   ('Working-age people in employment deprivation (number)', 'people', sc['Employment_count'])],
    'health': [('Comparative illness factor (standardised ratio)', '', sc['CIF']),
               ('Hospital stays related to alcohol use (standardised ratio)', '', sc['ALCOHOL']),
               ('Hospital stays related to drug use (standardised ratio)', '', sc['DRUG']),
               ('Standardised mortality ratio', '', sc['SMR']),
               ('People prescribed drugs for anxiety, depression or psychosis', '%', pct('DEPRESS')),
               ('Live singleton births of low birth weight', '%', pct('LBWT')),
               ('Emergency stays in hospital (standardised ratio)', '', sc['EMERG'])],
    'education': [('School pupil attendance', '%', pct('Attendance')),
                  ('Attainment of school leavers', 'score', sc['Attainment']),
                  ('Working-age people with no qualifications (standardised ratio)', '', sc['no_qualifications']),
                  ('16–19 year olds not in education, employment or training', '%', pct('not_participating')),
                  ('17–21 year olds entering university', '%', pct('University'))],
    'access': [('Drive time to a petrol station', 'minutes', sc['drive_petrol']), ('Drive time to a GP surgery', 'minutes', sc['drive_GP']),
               ('Drive time to a post office', 'minutes', sc['drive_post']), ('Drive time to a primary school', 'minutes', sc['drive_primary']),
               ('Drive time to a retail centre', 'minutes', sc['drive_retail']), ('Drive time to a secondary school', 'minutes', sc['drive_secondary']),
               ('Public transport time to a GP surgery', 'minutes', sc['PT_GP']), ('Public transport time to a post office', 'minutes', sc['PT_post']),
               ('Public transport time to a retail centre', 'minutes', sc['PT_retail']),
               ('Premises without superfast broadband (30 Mb/s)', '%', pct('Broadband'))],
    'crime': [('Recorded crimes (violence, sexual offences, housebreaking, vandalism, drugs, common assault)', 'per 10,000 people', sc['crime_rate'])],
    'housing': [('People in overcrowded households (rate)', '%', pct('overcrowded_rate')),
                ('People in households without central heating (rate)', '%', pct('nocentralheat_rate')),
                ('People in overcrowded households (number)', 'people', sc['overcrowded_count']),
                ('People in households without central heating (number)', 'people', sc['nocentralheat_count'])],
}
for measure, cols in S_COLS.items():
    add('S', measure, list(sc.index), cols)

# ── Northern Ireland: NIMDM 2017 (one sheet per domain; the value columns, not the rank columns) ─
print('Northern Ireland')
x = pd.ExcelFile(S + 'NIMDM17_SOAresults.xls')
N_SHEETS = {'Income': 'income', 'Employment': 'employment', 'Health and Disability': 'health', 'Education, Skills and Training ': 'education',
            'Access to Services': 'access', 'Living Environment': 'living', 'Crime and Disorder': 'crime'}
def ni_col(raw):
    h = re.sub(r'\s+', ' ', str(raw)).strip()
    unit = ''
    m = re.search(r'\((%|% of possible attendance|NI = 100|per [\d,]+ population)\)\s*$', h)
    if m:
        h = h[:m.start()].strip()
        unit = {'%': '%', '% of possible attendance': '%', 'NI = 100': '(NI = 100)'}.get(m.group(1), m.group(1).replace(' population', ' people'))
    h = h.replace('Standardized', 'Standardised')
    return h[0].upper() + h[1:], unit
def ni_cols(d, wanted):
    out = []
    for c in wanted:
        label, unit = ni_col(c)
        v = num(d[c])
        out.append((label, unit, v * 100 if unit == '%' else v))
    return out
for sheet_name, measure in N_SHEETS.items():
    d = x.parse(sheet_name)
    d.columns = [re.sub(r'\s+', ' ', str(c)).strip() for c in d.columns]
    vals = [c for c in d.columns[4:] if not re.search(r'\((rank)\)|Rank|Sub-Domain', c, flags=re.I)]
    if measure == 'income':
        d = d.rename(columns={vals[0]: 'Population in households with income below 60% of the NI median (%)'})
        vals = ['Population in households with income below 60% of the NI median (%)']
    if measure == 'employment':
        vals = [c for c in vals]
    add('N', measure, d['SOA2001'], ni_cols(d, vals))
d = x.parse('IDAC and IDAP')
d.columns = [re.sub(r'\s+', ' ', str(c)).strip() for c in d.columns]
kids = [c for c in d.columns if '15 and under' in c and c.endswith('(%)')]
olds = [c for c in d.columns if '65 and over' in c and c.endswith('(%)')]
assert len(kids) == 1 and len(olds) == 1
add('N', 'idaci', d['SOA2001'], [('Children aged 15 and under in households with income below 60% of the NI median', '%', num(d[kids[0]]) * 100)])
add('N', 'idaopi', d['SOA2001'], [('People aged 65 and over in households with income below 60% of the NI median', '%', num(d[olds[0]]) * 100)])

json.dump(index, open(OUT + 'index.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('Measures with indicators:', {n: sorted(v) for n, v in index.items()})
