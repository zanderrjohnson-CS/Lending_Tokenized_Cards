"""Collector Crypt (Solana) sales via Magic Eden's public v2 API (no key needed).

Covers sales that happened on Magic Eden only. Platform buybacks / gacha pulls are NOT on
Magic Eden and need Helius or Dune (see SOURCES.md). Raw responses are saved unchanged.

  python -m scoring.pipeline.collect.collector_crypt activities [--max-pages N]
  python -m scoring.pipeline.collect.collector_crypt tokens [--limit N]
"""
import argparse, json, time
from .common import RAW, get_json, cached_json

BASE = "https://api-mainnet.magiceden.dev/v2"
SYMBOL = "collector_crypt"   # ME collection symbol; ME shows Collector Crypt as the verified collection
OUT = RAW / "collector_crypt"


def activities(max_pages=100, page=500, throttle=1.0):
    d = OUT / "activities"
    d.mkdir(parents=True, exist_ok=True)
    for i in range(max_pages):
        off = i * page
        f = d / f"offset_{off:06d}.json"
        if f.exists():
            continue
        try:
            rows = get_json(f"{BASE}/collections/{SYMBOL}/activities?offset={off}&limit={page}")
        except Exception as e:  # ME caps depth with HTTP 400
            print("stop at offset", off, e); break
        if not rows:
            print("empty page at", off); break
        f.write_text(json.dumps(rows))
        print(f"offset {off}: {len(rows)} rows, oldest blockTime {rows[-1].get('blockTime')}")
        time.sleep(throttle)


def sale_mints():
    seen = {}
    for f in sorted((OUT / "activities").glob("offset_*.json")):
        for r in json.loads(f.read_text()):
            if r.get("type") == "buyNow":
                seen.setdefault(r["tokenMint"], 0)
                seen[r["tokenMint"]] += 1
    return seen


def tokens(limit=None, throttle=0.7):
    mints = list(sale_mints())
    if limit: mints = mints[:limit]
    n = 0
    for m in mints:
        p = OUT / "tokens" / f"{m}.json"
        new = not p.exists()
        cached_json(p, f"{BASE}/tokens/{m}", throttle=throttle)
        n += new
    print(f"{len(mints)} sold mints, {n} newly fetched")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["activities", "tokens"])
    ap.add_argument("--max-pages", type=int, default=100)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    activities(a.max_pages) if a.cmd == "activities" else tokens(a.limit)
