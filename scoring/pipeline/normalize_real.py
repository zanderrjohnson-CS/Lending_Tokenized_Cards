"""Normalize raw real-data pulls into one sales table + one cards table (stdlib only).

  python -m scoring.pipeline.normalize_real
Outputs (gitignored): scoring/data/cleaned/real/sales_unified.csv, listings_cc.csv
Wallets are salted-SHA256 hashed here; raw addresses never leave data/raw.
Grade is kept per row and card_key excludes grade: every statistic must be computed per
(card_key, grade_company, grade) so a PSA 10 and PSA 9 of the same card are separate series.
"""
import bisect, csv, datetime as dt, glob, json, re
from pathlib import Path
from .collect.common import RAW, ROOT, load_env, hash_wallet
from .collect import courtyard as cy

OUT = ROOT / "data" / "cleaned" / "real"
COLS = ["sale_id", "venue", "chain", "sale_type", "tx", "sale_ts", "price_usd", "price_native", "currency",
        "buyer_hash", "seller_hash", "token_ref", "card_key", "category", "year", "set_name", "card_name",
        "card_number", "language", "grade_company", "grade", "grade_label", "cert_number", "insured_value_usd"]


def slug(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower().replace("é", "e")).strip()


def num_grade(x):
    """'10', 'GEM MINT 10', 'NM 7', '10 GEM MINT', '9.5' -> float; None if no number (e.g. Authentic)."""
    m = re.findall(r"\d+(?:\.\d+)?", str(x or ""))
    return float(m[0]) if m else None


def lang_from(text):
    t = (text or "").lower()
    for l in ("japanese", "english", "korean", "chinese", "french", "german", "italian", "spanish"):
        if l in t:
            return l.capitalize()
    return ""


def sol_usd():
    rows = json.loads((RAW / "fx" / "sol_usd_daily_binance.json").read_text())
    return {dt.datetime.fromtimestamp(r[0] / 1000, dt.UTC).date(): float(r[4]) for r in rows}


def card_key(cat, year, set_name, number, name, lang):
    return "|".join(slug(x) for x in (cat, year, set_name, number, name, lang))


def collector_crypt(fx):
    seen, out = set(), []
    for f in sorted(glob.glob(str(RAW / "collector_crypt" / "activities" / "*.json"))):
        for r in json.loads(Path(f).read_text()):
            if r["type"] != "buyNow" or (r["signature"], r["tokenMint"]) in seen:
                continue
            seen.add((r["signature"], r["tokenMint"]))
            tp = RAW / "collector_crypt" / "tokens" / f"{r['tokenMint']}.json"
            if not tp.exists():
                continue
            t = json.loads(tp.read_text())
            if not t or "attributes" not in t:
                continue
            a = {x.get("trait_type"): x.get("value") for x in t["attributes"]}
            g = num_grade(a.get("GradeNum") or a.get("The Grade"))
            if a.get("Type") != "Card" or g is None or not a.get("Grading Company"):
                continue
            ts = dt.datetime.fromtimestamp(r["blockTime"], dt.UTC)
            rate = fx.get(ts.date()) or fx[max(d for d in fx if d <= ts.date())]
            lang = lang_from(a.get("Set")) or lang_from(t.get("name"))
            sname = re.sub(r"\s*-\s*(1st Edition\s*-\s*)?(English|Japanese|Korean|Chinese)\s*$", "", a.get("Set") or "")
            out.append(dict(
                sale_id="cc:" + r["signature"][:20] + ":" + r["tokenMint"][:6], venue="collector_crypt/magiceden",
                chain="solana", sale_type="fixed_price", tx=r["signature"], sale_ts=ts.isoformat(),
                price_usd=round(r["price"] * rate, 2), price_native=r["price"], currency="SOL",
                buyer_hash=hash_wallet(r.get("buyer", "")), seller_hash=hash_wallet(r.get("seller", "")),
                token_ref=r["tokenMint"], category=a.get("Category"), year=a.get("Year"), set_name=sname,
                card_name=a.get("Card Name"), card_number=a.get("Serial Number"), language=lang,
                grade_company=a.get("Grading Company").replace(" Trading Cards", ""), grade=g,
                grade_label=a.get("The Grade"), cert_number=a.get("Grading ID"), insured_value_usd=a.get("Insured Value"),
                card_key=card_key(a.get("Category"), a.get("Year"), sname, a.get("Serial Number"), a.get("Card Name"), lang)))
    return out


USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
GACHA = "GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3"
H = RAW / "collector_crypt" / "helius"


def helius_assets():
    """mint/asset id -> (name, attrs) for every resolved Collector Crypt asset (DAS hits + ME token files)."""
    out = {}
    for f in glob.glob(str(H / "asset_batch" / "hits_*.json")):
        for k, a in json.loads(Path(f).read_text()).items():
            md = a["content"]["metadata"]
            out[k] = (md.get("name"), {x.get("trait_type"): x.get("value") for x in md.get("attributes", [])})
    for f in glob.glob(str(RAW / "collector_crypt" / "tokens" / "*.json")):
        t = json.loads(Path(f).read_text())
        if t and "attributes" in t:
            out.setdefault(Path(f).stem, (t.get("name"), {x.get("trait_type"): x.get("value") for x in t["attributes"]}))
    return out


def cc_row(kind, x, mint, name, a, price, buyer, seller, venue, sale_type):
    g = num_grade(a.get("GradeNum") or a.get("The Grade"))
    if a.get("Type") != "Card" or g is None or not a.get("Grading Company"):
        return None
    ts = dt.datetime.fromtimestamp(x["timestamp"], dt.UTC)
    lang = lang_from(a.get("Set")) or lang_from(name)
    sname = re.sub(r"\s*-\s*(1st Edition\s*-\s*)?(English|Japanese|Korean|Chinese)\s*$", "", a.get("Set") or "")
    return dict(
        sale_id=f"{kind}:{x['signature'][:20]}:{mint[:6]}", venue=venue, chain="solana", sale_type=sale_type,
        tx=x["signature"], sale_ts=ts.isoformat(), price_usd=round(price, 2), price_native=round(price, 4), currency="USDC",
        buyer_hash=hash_wallet(buyer), seller_hash=hash_wallet(seller), token_ref=mint, category=a.get("Category"),
        year=a.get("Year"), set_name=sname, card_name=a.get("Card Name"), card_number=a.get("Serial Number"),
        language=lang, grade_company=a["Grading Company"].replace(" Trading Cards", "").replace("BGS", "Beckett"), grade=g,
        grade_label=a.get("The Grade"), cert_number=a.get("Grading ID"), insured_value_usd=a.get("Insured Value"),
        card_key=card_key(a.get("Category"), a.get("Year"), sname, a.get("Serial Number"), a.get("Card Name"), lang))


def helius_cc():
    """Collector Crypt marketplace sales (fee-wallet crawl) and gacha buybacks (platform pays USDC for the card)."""
    assets = helius_assets()
    sales, buybacks, seen = [], [], set()
    for stream in ("cc_sales", "buybacks"):
        for f in sorted(glob.glob(str(H / stream / "page_*.json"))):
            for x in json.loads(Path(f).read_text()):
                if x["signature"] in seen:
                    continue
                seen.add(x["signature"])
                from .collect.helius import tx_accounts
                mint = next((m for m in tx_accounts(x) if m in assets), None)
                if not mint:
                    continue
                name, a = assets[mint]
                if stream == "cc_sales":
                    e = x.get("events", {}).get("nft", {})
                    buyer, seller = e.get("buyer"), e.get("seller")
                    price = sum(t["tokenAmount"] for t in x["tokenTransfers"] if t["mint"] == USDC_MINT and t["fromUserAccount"] == buyer)
                    if not price or not buyer:
                        continue
                    r = cc_row("cch", x, mint, name, a, price, buyer, seller, "collector_crypt", e.get("saleType", "INSTANT_SALE").lower())
                    if r: sales.append(r)
                else:
                    pay = [t for t in x["tokenTransfers"] if t["mint"] == USDC_MINT and t["fromUserAccount"] == GACHA]
                    if not pay:
                        continue
                    seller = pay[0]["toUserAccount"]
                    r = cc_row("bb", x, mint, name, a, sum(t["tokenAmount"] for t in pay), "PLATFORM:collector_crypt_gacha", seller, "collector_crypt_buyback", "buyback")
                    if r: buybacks.append(r)
    return sales, buybacks


def courtyard():
    out = []
    # block -> timestamp via linear interpolation from a few anchors would be lossy; use cached block times
    bt = json.loads((RAW / "courtyard" / "block_times.json").read_text()) if (RAW / "courtyard" / "block_times.json").exists() else {}
    keys = sorted(int(k) for k in bt)
    for s in cy.sales():
        h = f"0x{s['token_id']:064x}"
        tp = RAW / "courtyard" / "tokens" / f"{h}.json"
        if not tp.exists():
            continue
        t = json.loads(tp.read_text())
        if not t:
            continue
        a = {}
        for x in t.get("attributes", []):
            if x.get("trait_type"):
                a[x["trait_type"]] = x["value"]
        fp = t.get("token_info", {}).get("proof_of_integrity", {}).get("fingerprint", "")
        parts = [p.strip() for p in fp.split("|")]
        grader, cert = a.get("Grader"), a.get("Serial")
        if len(parts) >= 4 and not grader:
            m = re.match(r"([A-Za-z]+)\s+(\S+)", parts[1])
            grader, cert = (m.group(1), m.group(2)) if m else (None, None)
        gl = a.get("Grade") or (parts[3] if len(parts) >= 4 else "")
        g = num_grade(gl)
        if g is None or not grader:
            continue
        b = s["block"]
        if not keys:
            continue
        if b < keys[0] or b > keys[-1]:
            continue   # no block-time anchor on both sides: skip rather than extrapolate a timestamp
        i = min(bisect.bisect_right(keys, b) - 1, len(keys) - 2)
        b0, b1 = keys[i], keys[i + 1]
        ts0, ts1 = bt[str(b0)], bt[str(b1)]
        ts = dt.datetime.fromtimestamp(ts0 + (ts1 - ts0) * (b - b0) / (b1 - b0), dt.UTC)
        lang = a.get("Language", "")
        name = a.get("Title/Subject") or t.get("name")
        out.append(dict(
            sale_id="cy:" + s["tx"][:20] + f":{s['token_id'] % 10**6}", venue="courtyard", chain="polygon",
            sale_type="marketplace_sale", tx=s["tx"], sale_ts=ts.isoformat(), price_usd=round(s["usdc"], 2),
            price_native=s["usdc"], currency="USDC", buyer_hash=hash_wallet(s["buyer"]), seller_hash=hash_wallet(s["seller"]),
            token_ref=h, category=a.get("Category"), year=a.get("Year"), set_name=a.get("Set"), card_name=name,
            card_number=a.get("Card Number"), language=lang, grade_company=grader, grade=g, grade_label=gl,
            cert_number=cert, insured_value_usd="", card_key=card_key(a.get("Category"), a.get("Year"), a.get("Set"), a.get("Card Number"), name, lang)))
    return out


def main():
    load_env()
    OUT.mkdir(parents=True, exist_ok=True)
    fx = sol_usd()
    hs, bb = helius_cc()
    rows, sigs = [], set()
    for r in hs + collector_crypt(fx) + courtyard():   # Helius first, so duplicate signatures keep the Helius row
        if r["tx"] in sigs and r["venue"].startswith("collector_crypt"):
            continue
        sigs.add(r["tx"]); rows.append(r)
    rows.sort(key=lambda r: r["sale_ts"])
    bb.sort(key=lambda r: r["sale_ts"])
    with open(OUT / "buybacks.csv", "w", newline="") as f:
        w = csv.DictWriter(f, COLS); w.writeheader(); w.writerows(bb)
    print(len(bb), "buybacks ->", OUT / "buybacks.csv")
    with open(OUT / "sales_unified.csv", "w", newline="") as f:
        w = csv.DictWriter(f, COLS)
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} graded sales -> {OUT/'sales_unified.csv'}")


if __name__ == "__main__":
    main()
