"""Daily TCGplayer price snapshots for every Pokemon product, via tcgcsv.com.

tcgcsv.com republishes TCGplayer's catalog and price feed once a day as plain JSON/CSV, free and
without a key (TCGplayer's own API stopped issuing new developer keys). Fields per product:
lowPrice, midPrice, highPrice, marketPrice, directLowPrice. No individual sales.

Run daily to build a price history: every run appends today's prices for the cards in
data/cards.csv. tcgcsv also hosts dated archives (see https://tcgcsv.com/faq) that you can use to
backfill history; those are 7z files and are not handled here.

Usage: python src/fetch_tcgcsv.py
Appends to data/raw/tcgcsv_prices.csv (re-running on the same UTC day replaces that day's rows).
"""
import csv
import os
import re
from datetime import datetime, timezone

from netutil import get

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POKEMON = 3  # TCGplayer category id for Pokemon (English)

# TCGplayer group (set) names for the starter cards. Extend as you add cards.
SET_NAMES = {
    "Base Set (Unlimited)": "Base Set", "Evolving Skies": "SWSH07: Evolving Skies",
    "Fusion Strike": "SWSH08: Fusion Strike", "Lost Origin": "SWSH11: Lost Origin",
    "Silver Tempest": "SWSH12: Silver Tempest", "Scarlet & Violet 151": "SV: Scarlet & Violet 151",
    "Obsidian Flames": "SV03: Obsidian Flames", "SV Black Star Promo": "SV: Scarlet & Violet Promo Cards",
}


def main():
    with open(os.path.join(ROOT, "data", "cards.csv")) as f:
        cards = list(csv.DictReader(f))
    groups = {g["name"]: g["groupId"] for g in get(f"https://tcgcsv.com/tcgplayer/{POKEMON}/groups")["results"]}
    out = os.path.join(ROOT, "data", "raw", "tcgcsv_prices.csv")
    today = datetime.now(timezone.utc).date().isoformat()
    # tcgcsv refreshes once a day (around 20:00 UTC), so a morning run gets the previous day's prices.
    # price_date is the date of that refresh, which compute_factors.py uses to spot stale prices.
    price_date = get("https://tcgcsv.com/last-updated.txt", as_json=False).strip()[:10]
    header = ["snapshot_date", "card_key", "product_id", "product_name", "sub_type",
              "low", "mid", "high", "market", "direct_low", "price_date"]
    kept = []
    if os.path.exists(out):
        with open(out) as f:
            kept = [[r.get(h) or "" for h in header] for r in csv.DictReader(f)]
    new_rows = []
    cache = {}
    for c in cards:
        gid = groups.get(SET_NAMES.get(c["set"], c["set"]))
        if not gid:
            print("  no tcgplayer group for", c["set"])
            continue
        if gid not in cache:
            products = get(f"https://tcgcsv.com/tcgplayer/{POKEMON}/{gid}/products")["results"]
            prices = get(f"https://tcgcsv.com/tcgplayer/{POKEMON}/{gid}/prices")["results"]
            cache[gid] = (products, prices)
        products, prices = cache[gid]
        num = c["number"].split("/")[0].replace("SVP ", "").lstrip("0")
        # Match on card number from extendedData; fall back to the name.
        match = [p for p in products
                 if any(e.get("name") == "Number" and re.sub(r"^0+", "", e["value"].split("/")[0]) == num
                        for e in p.get("extendedData", []))]
        for p in match:
            for pr in (x for x in prices if x["productId"] == p["productId"]):
                new_rows.append([today, c["card_key"], p["productId"], p["name"], pr["subTypeName"],
                              pr["lowPrice"], pr["midPrice"], pr["highPrice"], pr["marketPrice"], pr["directLowPrice"],
                                 price_date])
        print("ok", c["card_key"], [p["name"] for p in match])
    # Keep earlier days; replace today's rows only for cards fetched this run.
    done = {r[1] for r in new_rows}
    with open(out, "w", newline="") as f:
        cw = csv.writer(f)
        cw.writerow(header)
        cw.writerows(r for r in kept if not (r[0] == today and r[1] in done))
        cw.writerows(new_rows)


if __name__ == "__main__":
    main()
