"""Sanity check: our per-grade median sale price vs the Kaggle sold-price reference (PSA 9 / PSA 10, English).

  python -m scoring.pipeline.validate_real
Join key = normalized card name + collector number. Prints coverage and the median ratio (ours / reference).
"""
import csv, re, statistics as st, math
from .collect.common import ROOT, RAW

D = ROOT / "data" / "cleaned" / "real"
REF = RAW / "datasets" / "pokemon-card-sold-price-reference" / "gemsnipe-card-sold-price-reference.csv"


def n(s): return re.sub(r"[^a-z0-9]", "", (s or "").lower())
def num(s):
    m = re.match(r"0*(\d+)", (s or "").strip()); return m.group(1) if m else n(s)


def main():
    ref = {}
    for r in csv.DictReader(open(REF)):
        ref[(n(r["name"]), num(r["local_id"]))] = r
    rows = [r for r in csv.DictReader(open(D / "series_features.csv"))
            if r["grade_company"] == "PSA" and r["language"] in ("English", "") and int(r["n_sales"]) >= 3]
    out = {9.0: [], 10.0: []}
    for r in rows:
        g = float(r["grade"])
        if g not in out: continue
        k = (n(r["card_name"]), num(r["card_number"]))
        ref_r = ref.get(k)
        col = "psa10_price_usd" if g == 10 else "psa9_price_usd"
        if ref_r and ref_r[col]:
            out[g].append((float(r["median_price"]), float(ref_r[col]), r["card_name"], r["set_name"], int(r["n_sales"])))
    for g, xs in out.items():
        if not xs: print(f"PSA {g:g}: no matches"); continue
        ratios = [a / b for a, b, *_ in xs]
        logs = [math.log(x) for x in ratios]
        corr = None
        if len(xs) > 2:
            la, lb = [math.log(a) for a, *_ in xs], [math.log(b) for _, b, *_ in xs]
            ma, mb = st.mean(la), st.mean(lb)
            corr = sum((x - ma) * (y - mb) for x, y in zip(la, lb)) / math.sqrt(sum((x - ma) ** 2 for x in la) * sum((y - mb) ** 2 for y in lb))
        print(f"PSA {g:g}: {len(xs)} matched series; median ours/ref = {st.median(ratios):.2f}; "
              f"log-price correlation = {corr if corr is None else round(corr, 2)}; within 2x: {sum(0.5 <= r <= 2 for r in ratios)/len(ratios):.0%}")


if __name__ == "__main__":
    main()
