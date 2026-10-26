"""Courtyard (Polygon) secondary sales from public chain data, via a free public RPC.

Contract (official docs + Polygonscan-visible; "Graded Cards" registry used by current mints):
  NFT:         0x251BE3A17Af4892035C37ebf5890F4a4D889dcAD
  Marketplace: 0x5e4943373c2198625bd441ae0629e9e7b4fb4797  (buyer USDC -> marketplace -> seller USDC)
  USDC (native): 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359
A secondary sale = an NFT Transfer (neither side zero address nor the Courtyard vault wallet) in a
tx that also has a USDC Transfer into the marketplace contract. Mints (from 0x0) are pack/vault
tokenizations, burns (to 0x0) are redemptions; vault wallet 0x66dbff.. is a platform wallet and
must never count as a wash-trade counterparty.

  python -m scoring.pipeline.collect.courtyard logs --days 7
  python -m scoring.pipeline.collect.courtyard tokens --limit 20
"""
import argparse, gzip, json, time
from .common import RAW, get_json, cached_json, UA

RPC = "https://polygon-bor-rpc.publicnode.com"   # free; max 10,000 blocks per getLogs
NFT = "0x251BE3A17Af4892035C37ebf5890F4a4D889dcAD"
MARKET = "0x5e4943373c2198625bd441ae0629e9e7b4fb4797"
USDC = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"
VAULT = "0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
CHUNK = 10_000
OUT = RAW / "courtyard"


def rpc(method, params):
    r = get_json(RPC, data={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in r:
        raise RuntimeError(r["error"])
    return r["result"]


def pad(addr):
    return "0x" + addr.lower().replace("0x", "").rjust(64, "0")


def get_logs(flt, lo, hi, depth=0):
    """eth_getLogs with retry; on timeout / too-many-results split the range in half."""
    for attempt in range(3):
        try:
            return rpc("eth_getLogs", [{**flt, "fromBlock": hex(lo), "toBlock": hex(hi)}])
        except RuntimeError as e:
            time.sleep(2 * (attempt + 1))
    if hi - lo < 200 or depth > 6:
        raise RuntimeError(f"cannot fetch {lo}-{hi}")
    mid = (lo + hi) // 2
    return get_logs(flt, lo, mid, depth + 1) + get_logs(flt, mid + 1, hi, depth + 1)


def logs(days=7, throttle=0.3, only=None, reverse=False):
    head = int(rpc("eth_blockNumber", []), 16) - 100       # stay clear of reorgs
    start = head - int(days * 86400 / 2.1)                   # ~2.1s Polygon blocks
    start -= start % CHUNK
    for kind, flt in (("nft", {"address": NFT, "topics": [TRANSFER]}),
                      ("pay", {"address": USDC, "topics": [TRANSFER, None, pad(MARKET)]})):
        if only and kind != only:
            continue
        d = OUT / kind
        d.mkdir(parents=True, exist_ok=True)
        for lo in (reversed(range(start, head, CHUNK)) if reverse else range(start, head, CHUNK)):
            f = d / f"blocks_{lo}.json.gz"
            if f.exists():
                continue
            hi = min(lo + CHUNK - 1, head)
            res = get_logs(flt, lo, hi)
            f.write_bytes(gzip.compress(json.dumps({"from": lo, "to": hi, "logs": res}).encode()))
            print(kind, lo, len(res), flush=True)
            time.sleep(throttle)


def block_times():
    """Timestamp anchor for every chunk boundary (sales get interpolated timestamps between anchors)."""
    f = OUT / "block_times.json"
    bt = json.loads(f.read_text()) if f.exists() else {}
    los = sorted({int(p.stem.split("_")[1].split(".")[0]) for p in (OUT / "nft").glob("*.json.gz")})
    pts = set(los) | {l + CHUNK for l in los}
    for b in sorted(pts):
        if str(b) in bt: continue
        blk = None
        for url in (RPC, "https://1rpc.io/matic", "https://polygon-bor-rpc.publicnode.com"):
            try:
                r = get_json(url, data={"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": [hex(b), False]}, retries=2, base_delay=1)
                blk = r.get("result")
                if blk: break
            except Exception:
                continue
        if blk: bt[str(b)] = int(blk["timestamp"], 16); f.write_text(json.dumps(bt))
    f.write_text(json.dumps(bt))
    print(len(bt), "anchors")


def sales():
    """Join payments with secondary NFT transfers (derived view, raw untouched)."""
    pays = {}
    for f in (OUT / "pay").glob("*.json.gz"):
        for l in json.loads(gzip.decompress(f.read_bytes()))["logs"]:
            pays.setdefault(l["transactionHash"], []).append(l)
    z = "0" * 64
    out = []
    for f in (OUT / "nft").glob("*.json.gz"):
        for l in json.loads(gzip.decompress(f.read_bytes()))["logs"]:
            frm, to = l["topics"][1][2:], l["topics"][2][2:]
            if frm == z or to == z or VAULT[2:] in (frm[-40:], to[-40:]):
                continue
            p = pays.get(l["transactionHash"])
            if p:
                out.append({"tx": l["transactionHash"], "block": int(l["blockNumber"], 16),
                            "token_id": int(l["topics"][3], 16), "seller": "0x" + frm[-40:],
                            "buyer": "0x" + to[-40:], "usdc": sum(int(x["data"], 16) for x in p) / 1e6,
                            "n_nft_in_tx": None})
    return out


def tokens(limit=None, throttle=0.25, workers=4, loop=False):
    """Fetch tokenURI metadata (same JSON wallets read) for every token that has a sale.
    Tokens with more sales first (repeat sales matter most for volatility). Resumable."""
    import collections, concurrent.futures as cf, threading
    while True:
        s = sales()
        cnt = collections.Counter(x["token_id"] for x in s)
        ids = [t for t, _ in cnt.most_common()]
        todo = [t for t in ids if not (OUT / "tokens" / f"0x{t:064x}.json").exists()]
        if limit: todo = todo[:limit]
        print(f"{len(s)} sales, {len(ids)} tokens, {len(todo)} to fetch", flush=True)
        lock, last = threading.Lock(), [0.0]

        def one(t):
            h = f"0x{t:064x}"
            with lock:  # global pacing across threads
                wait = last[0] + throttle - time.time()
                if wait > 0: time.sleep(wait)
                last[0] = time.time()
            try:
                cached_json(OUT / "tokens" / f"{h}.json",
                            f"https://api.courtyard.io/index/token/polygon/{NFT}/{h}/metadata.json", throttle=0)
            except Exception as e:
                print("fail", h, e, flush=True)
        with cf.ThreadPoolExecutor(workers) as ex:
            list(ex.map(one, todo))
        if not loop or not todo:
            break
        time.sleep(60)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["logs", "tokens", "sales", "block_times"])
    ap.add_argument("--days", type=float, default=7)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--reverse", action="store_true")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--only", choices=["nft", "pay"])
    a = ap.parse_args()
    if a.cmd == "logs": logs(a.days, only=a.only, reverse=a.reverse)
    elif a.cmd == "block_times": block_times()
    elif a.cmd == "tokens": tokens(a.limit, loop=a.loop)
    else: print(len(sales()))
