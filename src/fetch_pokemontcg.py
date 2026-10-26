"""Snapshot TCGplayer + Cardmarket prices for each card from the Pokemon TCG API (pokemontcg.io).

Free. Without a key: 1,000 requests/day, 30/min. With a free key (dev.pokemontcg.io): 20,000/day.
Prices are a daily snapshot (low/mid/high/market listings on TCGplayer, avg1/7/30 + trend on
Cardmarket), not a sale history, so run this daily (cron) to build your own time series.

In the Claude cloud environment the key is a network secret and the proxy adds the X-Api-Key
header. Elsewhere, set POKEMONTCG_API_KEY (optional).

Usage: python src/fetch_pokemontcg.py
Appends to data/raw/pokemontcg_snapshot.csv (one row per card per day).
"""
import csv
import os
from datetime import date

from netutil import get  # local helper; run from repo root: python src/fetch_*.py

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = ["snapshot_date", "ptcg_id", "name", "set", "release_date", "rarity", "tcgplayer_variant",
          "tcg_low", "tcg_mid", "tcg_high", "tcg_market", "tcg_updated",
          "cm_avg1", "cm_avg7", "cm_avg30", "cm_trend", "cm_low", "cm_avg_sell"]


def main():
    key = os.environ.get("POKEMONTCG_API_KEY")
    headers = {"X-Api-Key": key} if key else {}
    with open(os.path.join(ROOT, "data", "cards.csv")) as f:
        cards = list(csv.DictReader(f))
    out = os.path.join(ROOT, "data", "raw", "pokemontcg_snapshot.csv")
    new = not os.path.exists(out)
    with open(out, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        if new:
            w.writeheader()
        for c in cards:
            d = get(f"https://api.pokemontcg.io/v2/cards/{c['ptcg_id']}", headers, delay=2.1)["data"]
            tp, cm = d.get("tcgplayer", {}), d.get("cardmarket", {}).get("prices", {})
            # Pick the variant with the highest market price (holofoil for most chase cards).
            variants = tp.get("prices", {})
            vname, v = max(variants.items(), key=lambda kv: kv[1].get("market") or 0) if variants else ("", {})
            w.writerow({
                "snapshot_date": date.today().isoformat(), "ptcg_id": d["id"], "name": d["name"],
                "set": d["set"]["name"], "release_date": d["set"]["releaseDate"].replace("/", "-"),
                "rarity": d.get("rarity"), "tcgplayer_variant": vname,
                "tcg_low": v.get("low"), "tcg_mid": v.get("mid"), "tcg_high": v.get("high"),
                "tcg_market": v.get("market"), "tcg_updated": tp.get("updatedAt"),
                "cm_avg1": cm.get("avg1"), "cm_avg7": cm.get("avg7"), "cm_avg30": cm.get("avg30"),
                "cm_trend": cm.get("trendPrice"), "cm_low": cm.get("lowPrice"), "cm_avg_sell": cm.get("averageSellPrice"),
            })
            print("ok", d["id"], vname, v.get("market"))


if __name__ == "__main__":
    main()
