"""Backfill daily TCGplayer prices for every Pokemon card from tcgcsv.com's dated archives.

tcgcsv publishes one 7z archive per day (from 2024-02-08) holding TCGplayer's price feed for all
categories. We download each day, keep category 3 (Pokemon, English), and write one compact
pickle file per day: date, productId, subType, low, mid, high, market, directLow.
Rows with no market price, or a market price under MIN_MARKET, are dropped to keep the data small.

Also writes product metadata (name, set, number, rarity, set release date) from the live catalog.

Usage: python src/backfill_tcgcsv.py OUT_DIR [START] [END] [STEP_DAYS] [WORKERS]
Needs: pandas, and the 7z command (apt install 7zip) or pip install py7zr
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ProcessPoolExecutor
from datetime import date, timedelta

import pandas as pd
import py7zr

POKEMON = "3"
MIN_MARKET = 1.0
ARCHIVE = "https://tcgcsv.com/archive/tcgplayer/prices-{d}.ppmd.7z"
UA = {"User-Agent": "pokemon-card-safety-score/0.2 (hackathon research)"}


def fetch(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 1))


def one_day(args):
    d, out_dir = args
    dest = os.path.join(out_dir, "prices", f"{d}.pkl.gz")
    if os.path.exists(dest):
        return d, -1
    try:
        blob = fetch(ARCHIVE.format(d=d))
    except Exception as e:
        return d, f"download failed: {e}"
    tmp = tempfile.mkdtemp()
    try:
        arc = os.path.join(tmp, "a.7z")
        with open(arc, "wb") as fh:
            fh.write(blob)
        if shutil.which("7z"):  # native 7-Zip is ~10x faster than py7zr on these PPMd archives
            subprocess.run(["7z", "x", "-y", "-o" + tmp, arc, f"*/{POKEMON}/*/prices", "-r"],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            with py7zr.SevenZipFile(arc) as z:
                names = [n for n in z.getnames() if n.count("/") == 3 and n.split("/")[1] == POKEMON]
                z.extract(path=tmp, targets=names)
        rows = []
        for f in glob.glob(os.path.join(tmp, "*", POKEMON, "*", "prices")):
            gid = int(f.split(os.sep)[-2])
            try:
                res = json.load(open(f)).get("results", [])
            except Exception:
                continue
            for r in res:
                m = r.get("marketPrice")
                if m is None or m < MIN_MARKET:
                    continue
                rows.append((gid, r["productId"], r.get("subTypeName"), r.get("lowPrice"), r.get("midPrice"),
                             r.get("highPrice"), m, r.get("directLowPrice")))
        df = pd.DataFrame(rows, columns=["group_id", "product_id", "sub_type", "low", "mid", "high", "market",
                                         "direct_low"])
        df.insert(0, "date", pd.Timestamp(d))
        df.to_pickle(dest + ".tmp", compression="gzip")
        os.replace(dest + ".tmp", dest)
        return d, len(df)
    except Exception as e:
        return d, f"extract failed: {e}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def catalog(out_dir):
    """Product metadata for all Pokemon sets from the live tcgcsv catalog."""
    dest = os.path.join(out_dir, "products.pkl.gz")
    if os.path.exists(dest):
        return
    groups = json.loads(fetch(f"https://tcgcsv.com/tcgplayer/{POKEMON}/groups"))["results"]
    rows = []
    for g in groups:
        prods = json.loads(fetch(f"https://tcgcsv.com/tcgplayer/{POKEMON}/{g['groupId']}/products"))["results"]
        for p in prods:
            ext = {e["name"]: e["value"] for e in p.get("extendedData", [])}
            rows.append({"product_id": p["productId"], "name": p["name"], "group_id": g["groupId"],
                         "set_name": g["name"], "set_published": g.get("publishedOn"),
                         "number": ext.get("Number"), "rarity": ext.get("Rarity"),
                         "card_type": ext.get("CardType"), "is_card": "Number" in ext})
        time.sleep(0.2)
    pd.DataFrame(rows).to_pickle(dest, compression="gzip")
    print("catalog:", len(rows), "products in", len(groups), "sets")


def main():
    out_dir = sys.argv[1]
    start = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date(2024, 2, 8)
    end = date.fromisoformat(sys.argv[3]) if len(sys.argv) > 3 else date.today() - timedelta(days=1)
    step = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    workers = int(sys.argv[5]) if len(sys.argv) > 5 else 4
    os.makedirs(os.path.join(out_dir, "prices"), exist_ok=True)
    catalog(out_dir)
    days, d = [], start
    while d <= end:
        days.append((d.isoformat(), out_dir))
        d += timedelta(days=step)
    print(len(days), "days to fetch")
    with ProcessPoolExecutor(workers) as ex:
        for i, (d, n) in enumerate(ex.map(one_day, days)):
            if not isinstance(n, int) or i % 25 == 0:
                print(i, d, n, flush=True)


if __name__ == "__main__":
    main()
