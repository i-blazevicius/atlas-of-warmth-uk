"""Hand-made town -> NI council (May 2026 LAD codes) for the towns that appear in CCNI addresses."""
C = {"AN": "N09000001", "AB": "N09000002", "BE": "N09000003", "CC": "N09000004", "DS": "N09000005", "FO": "N09000006",
     "LC": "N09000007", "ME": "N09000008", "MU": "N09000009", "NM": "N09000010", "AD": "N09000011"}
T = {
 "AN": "antrim newtownabbey ballyclare crumlin doagh jordanstown whiteabbey toomebridge randalstown templepatrick",
 "AB": "craigavon armagh banbridge portadown lurgan waringstown tassagh markethill hilltown? richhill keady tandragee gilford dromore? loughbrickland",
 "BE": "belfast",
 "CC": "ballymoney limavady coleraine ballycastle portstewart portrush dungiven bushmills stranocum rathlin portballintrae macosquin rasharkin garvagh castlerock greysteel ballintoy cushendall",
 "DS": "londonderry derry strabane castlederg claudy sion mills newbuildings eglinton",
 "FO": "omagh enniskillen fivemiletown? tempo ballinamallard lisnaskea florencecourt irvinestown lisnarick belleek ederney kesh dromore",
 "LC": "lisburn hillsborough carryduff moneyreagh dundonald castlereagh moira dromara",
 "ME": "carrickfergus larne ballymena whitehead ahoghill ballycarry ballynure glengormley broughshane cullybackey kells",
 "MU": "dungannon cookstown magherafelt maghera draperstown coalisland castledawson augher aughnacloy ballygawley clogher stewartstown",
 "NM": "newry downpatrick newcastle kilkeel crossmaglen castlewellan warrenpoint killough hackballscross rathfriland ballynahinch seaforde saintfield forkhill camlough bessbrook",
 "AD": "bangor newtownards holywood comber donaghadee greyabbey craigavad crawfordsburn newtonards north down millisle",
}
OVERRIDE = {"fivemiletown": "FO", "hilltown": "NM", "dromore": "AB", "mourne and down": "NM", "down": None,
            "magheralin": "AB", "drumbo": "LC", "moira": "LC", "lisburn": "LC", "foylesprings": "CC", "cavanaleck": "FO",
            "belvoir estate": "BE", "ballycastle": "CC", "kilkeel": "NM", "tempo": "FO", "augher": "MU", "clogher": "MU"}
LOOK = {}
for k, words in T.items():
    for w in words.replace("?", "").split():
        LOOK[w] = k
# multi-word names
for k, w in (("DS", "sion mills"), ("AD", "north down"), ("NM", "mourne and down")):
    LOOK[w] = k
for w, k in OVERRIDE.items():
    if k:
        LOOK[w] = k


def council(town):
    t = str(town).lower().strip(" .")
    t = t.replace("co down", "").replace("co.", "").strip()
    if t in LOOK:
        return C[LOOK[t]]
    for w, k in LOOK.items():
        if len(w) > 5 and w in t:
            return C[k]
    return None
