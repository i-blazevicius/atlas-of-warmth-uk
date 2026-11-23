import json, re, subprocess
def get(u, n=60):
    return subprocess.run(["curl", "-s", "-m", str(n), u], capture_output=True, text=True).stdout
print("== Nomis geography codelist for NM_141_1")
raw = get("https://www.nomisweb.co.uk/api/v01/dataset/NM_141_1/geography.def.sdmx.json")
print(len(raw), "bytes")
for m in sorted(set(re.findall(r'"([^"]*(?:ntermediate|ata [Zz]one|ouncil area|Scotland)[^"]*)"', raw)))[:50]:
    print("  ", m)
print("== direct type tests")
for t in ["TYPE317", "TYPE318", "TYPE299", "TYPE298", "TYPE295", "TYPE296", "TYPE424", "TYPE423", "TYPE432", "TYPE446", "TYPE447", "TYPE480"]:
    s = get(f"https://www.nomisweb.co.uk/api/v01/dataset/NM_141_1/geography/{t}.def.sdmx.json", 30)
    try:
        k = json.loads(s)["structure"]["codelists"]["codelist"][0]
        print(t, k.get("name", {}).get("value"), len(k.get("code", [])))
    except Exception:
        print(t, "n/a")
print("== boundary reachability")
for u in ["https://maps.gov.scot/ATOM/shapefiles/SG_IntermediateZone_Bdry_2001.zip",
          "https://maps.gov.scot/ATOM/shapefiles/SG_DataZoneBdry_2011.zip",
          "https://www.nrscotland.gov.uk/files/statistics/geography/2020/2011-data-zone-lookup.xlsx"]:
    r = subprocess.run(["curl", "-sIL", "-m", "30", "-o", "/dev/null", "-w", "%{http_code} %{size_download}", u],
                       capture_output=True, text=True)
    print(u, "->", r.stdout)
