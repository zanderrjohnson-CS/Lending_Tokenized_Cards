"""Snapshot TCGplayer + Cardmarket prices for each card from the Pokemon TCG API (pokemontcg.io).

Free. Without a key: 1,000 requests/day, 30/min. With a free key (dev.pokemontcg.io): 20,000/day.
Prices are a daily snapshot (low/mid/high/market listings on TCGplayer, avg1/7/30 + trend on
Cardmarket), not a sale history, so run this daily (cron) to build your own time series.
The prices are only as fresh as pokemontcg.io's own refresh of them: tcg_updated and cm_updated
record the date each block was last refreshed upstream (in Oct 2026 TCGplayer was stuck at
2026-10-15 and Cardmarket at 2026-07-01). compute_factors.py ignores prices older than a few days
and uses tcgcsv.com for TCGplayer prices instead.

In the Claude cloud environment the key is a network secret and the proxy adds the X-Api-Key
header. Elsewhere, set POKEMONTCG_API_KEY (optional).

Usage: python src/fetch_pokemontcg.py [ptcg_id ...]   # ids to retry only those cards
Appends to data/raw/pokemontcg_snapshot.csv (one row per card per day).
"""
import csv
import os
import sys
from datetime import datetime, timezone

from netutil import get  # local helper; run from repo root: python src/fetch_*.py

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = ["snapshot_date", "ptcg_id", "name", "set", "release_date", "rarity", "tcgplayer_variant",
          "tcg_low", "tcg_mid", "tcg_high", "tcg_market", "tcg_updated",
          "cm_avg1", "cm_avg7", "cm_avg30", "cm_trend", "cm_low", "cm_avg_sell", "cm_updated"]


def main():
    key = os.environ.get("POKEMONTCG_API_KEY")
    headers = {"X-Api-Key": key} if key else {}
    with open(os.path.join(ROOT, "data", "cards.csv")) as f:
        cards = list(csv.DictReader(f))
    if sys.argv[1:]:
        cards = [c for c in cards if c["ptcg_id"] in sys.argv[1:]]
    out = os.path.join(ROOT, "data", "raw", "pokemontcg_snapshot.csv")
    today = datetime.now(timezone.utc).date().isoformat()
    # Re-running on the same day replaces that day's row for each card that succeeds, and keeps
    # the earlier row for a card that fails this time.
    kept = []
    if os.path.exists(out):
        with open(out) as f:
            kept = list(csv.DictReader(f))
    retry = {r["ptcg_id"] for r in kept if r["snapshot_date"] == today}
    failed = []
    rows = {}
    for c in cards:
        try:
            d = get(f"https://api.pokemontcg.io/v2/cards/{c['ptcg_id']}", headers, delay=2.1)["data"]
        except Exception as e:  # the API is flaky (500/502s); keep going and report at the end
            print("FAILED", c["ptcg_id"], e)
            if c["ptcg_id"] not in retry:
                failed.append(c["ptcg_id"])
            continue
        tp, cm = d.get("tcgplayer", {}), d.get("cardmarket", {}).get("prices", {})
        cm_updated = (d.get("cardmarket", {}).get("updatedAt") or "").replace("/", "-")
        # Pick the variant with the highest market price (holofoil for most chase cards).
        variants = tp.get("prices", {})
        vname, v = max(variants.items(), key=lambda kv: kv[1].get("market") or 0) if variants else ("", {})
        rows[d["id"]] = {
            "snapshot_date": today, "ptcg_id": d["id"], "name": d["name"],
            "set": d["set"]["name"], "release_date": d["set"]["releaseDate"].replace("/", "-"),
            "rarity": d.get("rarity"), "tcgplayer_variant": vname,
            "tcg_low": v.get("low"), "tcg_mid": v.get("mid"), "tcg_high": v.get("high"),
            "tcg_market": v.get("market"), "tcg_updated": (tp.get("updatedAt") or "").replace("/", "-"),
            "cm_avg1": cm.get("avg1"), "cm_avg7": cm.get("avg7"), "cm_avg30": cm.get("avg30"),
            "cm_trend": cm.get("trendPrice"), "cm_low": cm.get("lowPrice"), "cm_avg_sell": cm.get("averageSellPrice"), "cm_updated": cm_updated,
        }
        print("ok", d["id"], vname, v.get("market"), "tcgplayer updated", rows[d["id"]]["tcg_updated"], "cardmarket updated", cm_updated)
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(r for r in kept if not (r["snapshot_date"] == today and r["ptcg_id"] in rows))
        w.writerows(rows.values())
    if failed:
        print("failed (re-run later):", " ".join(failed))


if __name__ == "__main__":
    main()
