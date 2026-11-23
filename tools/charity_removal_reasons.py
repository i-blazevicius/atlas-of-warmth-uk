#!/usr/bin/env python3
"""National count of removed England & Wales hall/centre charities by window, split into probable closures and
successions (assets passed to another charity), from the Charity Commission event history.
Usage: python tools/charity_removal_reasons.py --register R.txt --events E.txt --out source/map_data_council"""
import argparse
from pathlib import Path

import pandas as pd

from prepare_charity_candidates import classify

SUCCESSION = ("Amalgamated", "Transfer of funds", "Funds transferred (incor)", "Funds transferred (gi)",
              "Funds transferred (s.74)", "Asset transfer")
WINDOWS = ["2022-2025", "2020-2025", "2018-2025", "2015-2025"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--register", required=True)
    ap.add_argument("--events", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    kw = dict(sep="\t", dtype=str, quoting=3, on_bad_lines="skip")
    ch = pd.read_csv(a.register, **kw)
    ch = ch[ch.charity_name.map(classify).notna()].drop_duplicates("organisation_number")
    ev = pd.read_csv(a.events, **kw)
    rm = ev[ev.event_type == "Removed"].merge(ch[["organisation_number"]], on="organisation_number")
    rm["date"] = pd.to_datetime(rm.date_of_event.str[:10], errors="coerce")
    has_transfer = set(ev[ev.event_type == "Asset transfer out"].organisation_number)
    rm["group"] = [("succession" if (r in SUCCESSION or o in has_transfer) else
                    "probable_closure" if r in ("Ceased to exist", "Does not operate", "Removed by application",
                                                "Voluntary removal", "Funds spent up (s.75)", "Funds spent (by trustees)")
                    else "other") for r, o in zip(rm.reason.fillna(""), rm.organisation_number)]
    rows = []
    for w in WINDOWS:
        ya, yb = (int(v) for v in w.split("-"))
        s = rm[(rm.date > pd.Timestamp(f"{ya}-01-01")) & (rm.date <= pd.Timestamp(f"{yb}-01-01"))]
        for g, n in s.group.value_counts().items():
            rows.append({"window": w, "region": "England and Wales", "removal_type": g, "charities": int(n)})
    out = pd.DataFrame(rows)
    out.to_csv(Path(a.out) / "national_removals.csv", index=False)
    print(out.pivot(index="window", columns="removal_type", values="charities"))


if __name__ == "__main__":
    main()
