"""Collector Crypt (Solana) via Helius free plan: full mint list (DAS) + parsed per-mint history.

Collection address (from DAS `grouping` on a Collector Crypt NFT; ME collection `collector_crypt`):
  CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf
Key comes from HELIUS_API_KEY in scoring/.env. Free plan = 1M credits/month, so everything is cached,
throttled and resumable; watch usage in the Helius dashboard.

  python -m scoring.pipeline.collect.helius mints [--max-pages N]
  python -m scoring.pipeline.collect.helius history [--limit N] [--from-sales]
"""
import argparse, json, os, time
from .common import RAW, get_json, cached_json, load_env

COLLECTION = "CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf"
OUT = RAW / "collector_crypt" / "helius"


def rpc_url():
    load_env()
    return f"https://mainnet.helius-rpc.com/?api-key={os.environ['HELIUS_API_KEY']}"


def mints(max_pages=50, throttle=0.3):
    d = OUT / "assets"; d.mkdir(parents=True, exist_ok=True)
    page = 1
    while page <= max_pages:
        f = d / f"page_{page:05d}.json"
        if not f.exists():
            r = get_json(rpc_url(), data={"jsonrpc": "2.0", "id": 1, "method": "getAssetsByGroup",
                         "params": {"groupKey": "collection", "groupValue": COLLECTION, "page": page, "limit": 1000}})
            res = r.get("result", {})
            f.write_text(json.dumps(res)); time.sleep(throttle)
        else:
            res = json.loads(f.read_text())
        n = len(res.get("items", []))
        print("page", page, n, "total", res.get("total"), flush=True)
        if n < 1000: break
        page += 1


def sold_mints():
    import glob
    s = set()
    for fn in glob.glob(str(RAW / "collector_crypt" / "activities" / "*.json")):
        for r in json.loads(open(fn).read()):
            if r["type"] == "buyNow": s.add(r["tokenMint"])
    return sorted(s)


def history(limit=None, mint_list=None, throttle=0.25, pages=3):
    load_env()
    key = os.environ["HELIUS_API_KEY"]
    ms = mint_list or sold_mints()
    if limit: ms = ms[:limit]
    for i, m in enumerate(ms):
        f = OUT / "history" / f"{m}.json"
        if f.exists(): continue
        allrows, before = [], None
        for _ in range(pages):
            u = f"https://api.helius.xyz/v0/addresses/{m}/transactions?api-key={key}&limit=100" + (f"&before={before}" if before else "")
            rows = get_json(u) or []
            allrows += rows
            if len(rows) < 100: break
            before = rows[-1]["signature"]; time.sleep(throttle)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(allrows)); time.sleep(throttle)
        if i % 25 == 0: print(i, len(ms), flush=True)


STREAMS = {
    # name: (address whose history is paged, Helius type filter)
    "buybacks": ("GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3", "BUYBACK"),      # CC gacha buyback wallet (platform)
    "cc_sales": ("8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX", "NFT_SALE"),      # CC marketplace fee wallet (dense; the program address scan is too sparse)
}


def crawl(name, max_calls=500, stop_ts=0, throttle=0.25):
    """Page an address's history backwards with a type filter. ~100 credits per call on the free plan.
    State (last signature) is saved so the next run continues where this one stopped."""
    load_env()
    key = os.environ["HELIUS_API_KEY"]
    addr, typ = STREAMS[name]
    d = OUT / name; d.mkdir(parents=True, exist_ok=True)
    st = d / "_state.json"
    state = json.loads(st.read_text()) if st.exists() else {"before": None, "page": 0, "done": False}
    calls = 0
    while calls < max_calls and not state["done"]:
        u = f"https://api.helius.xyz/v0/addresses/{addr}/transactions?api-key={key}&limit=100&type={typ}"
        if state["before"]: u += f"&before={state['before']}"
        rows = get_json(u) or []
        calls += 1
        if not rows:
            state["done"] = True; break
        state["page"] += 1
        (d / f"page_{state['page']:06d}.json").write_text(json.dumps(rows))
        # cursor must be the last row of the *unfiltered* scan; filtered rows may be sparse, so use last row signature
        state["before"] = rows[-1]["signature"]
        st.write_text(json.dumps(state))
        if state["page"] % 20 == 0:
            print(name, "page", state["page"], "oldest", rows[-1]["timestamp"], flush=True)
        if stop_ts and rows[-1]["timestamp"] < stop_ts:
            state["done"] = True
        time.sleep(throttle)
    st.write_text(json.dumps(state))
    print(name, "calls", calls, "state", state)


CC_COLLECTIONS = {
    "CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf",  # legacy Metaplex NFTs (DAS grouping on ME-listed cards)
    "CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac",  # newer Metaplex Core assets (most recent cards)
}


def tx_accounts(x):
    a = {t["mint"] for t in x.get("tokenTransfers", []) if t.get("tokenStandard") != "Fungible"}
    a |= {n["mint"] for n in (x.get("events", {}).get("nft", {}).get("nfts") or [])}
    a |= {d["account"] for d in x.get("accountData", [])}
    return a


def asset_batch(throttle=0.3):
    """Resolve each crawled tx to its Collector Crypt asset. Enhanced API often omits the NFT (Core assets),
    so every account key in the tx is run through DAS getAssetBatch (1000 ids / call, ~10 credits).
    Hits (assets in a CC collection) are saved with full metadata; all checked addresses are remembered."""
    import glob
    accs = set()
    for name in STREAMS:
        for fn in glob.glob(str(OUT / name / "page_*.json")):
            for x in json.loads(open(fn).read()):
                accs |= tx_accounts(x)
    d = OUT / "asset_batch"; d.mkdir(parents=True, exist_ok=True)
    chk = d / "_checked.json"
    checked = set(json.loads(chk.read_text())) if chk.exists() else set()
    todo = sorted(accs - checked)
    print(len(accs), "addresses;", len(todo), "to check", flush=True)
    for i in range(0, len(todo), 1000):
        ids = todo[i:i + 1000]
        r = get_json(rpc_url(), data={"jsonrpc": "2.0", "id": 1, "method": "getAssetBatch", "params": {"ids": ids}})
        hits = {}
        for a in (r.get("result") or []):
            if a and any(g.get("group_value") in CC_COLLECTIONS for g in a.get("grouping", [])):
                hits[a["id"]] = a
        if hits:
            (d / f"hits_{int(time.time())}_{i}.json").write_text(json.dumps(hits))
        checked |= set(ids)
        chk.write_text(json.dumps(sorted(checked)))
        time.sleep(throttle)
        if (i // 1000) % 20 == 0: print("checked", i + len(ids), "of", len(todo), flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["mints", "history", "crawl", "assets"])
    ap.add_argument("--max-pages", type=int, default=50)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--stream", choices=list(STREAMS))
    ap.add_argument("--max-calls", type=int, default=500)
    ap.add_argument("--stop-ts", type=int, default=0)
    a = ap.parse_args()
    if a.cmd == "mints": mints(a.max_pages)
    elif a.cmd == "history": history(a.limit)
    elif a.cmd == "crawl": crawl(a.stream, a.max_calls, a.stop_ts)
    else: asset_batch()
