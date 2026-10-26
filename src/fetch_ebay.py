"""Active eBay listings (asking prices and supply) through the official eBay Browse API.

Needs a free eBay developer account (developer.ebay.com): set EBAY_CLIENT_ID and
EBAY_CLIENT_SECRET. Default limit is 5,000 Browse calls/day.

What you get: how many copies are listed now and at what asking prices, which feeds the
"listed vs sold" part of the Spread factor and a supply signal for Liquidity.
What you do not get: sold prices. Sold data lives in the Marketplace Insights API, which eBay
only grants to approved partners, and scraping eBay's sold-listings pages breaks their user
agreement. For sold prices use PriceCharting (fetch_pricecharting.py), which aggregates eBay sales.

Usage: python src/fetch_ebay.py
Writes data/raw/ebay_active_<date>.csv.
"""
import base64
import csv
import os
import statistics
import sys
from datetime import date
from urllib.parse import urlencode

from netutil import get

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
TCG_CATEGORY = "183454"  # CCG Individual Cards


def app_token(cid, secret):
    auth = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    body = urlencode({"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"}).encode()
    return get(TOKEN_URL, {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
               data=body)["access_token"]


def main():
    cid, secret = os.environ.get("EBAY_CLIENT_ID"), os.environ.get("EBAY_CLIENT_SECRET")
    if not (cid and secret):
        sys.exit("set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET")
    headers = {"Authorization": f"Bearer {app_token(cid, secret)}", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"}
    with open(os.path.join(ROOT, "data", "cards.csv")) as f:
        cards = list(csv.DictReader(f))
    out = os.path.join(ROOT, "data", "raw", f"ebay_active_{date.today().isoformat()}.csv")
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["card_key", "query", "listing_type", "total_listings", "sampled", "ask_min", "ask_median", "ask_max"])
        for c in cards:
            q = f"{c['name'].split(' (')[0]} {c['number']} {c['set']}"
            for kind, filt in (("raw", "-psa -bgs -cgc -graded"), ("psa10", "psa 10")):
                params = urlencode({"q": f"{q} {filt}", "category_ids": TCG_CATEGORY, "limit": 200,
                                    "filter": "buyingOptions:{FIXED_PRICE},priceCurrency:USD"})
                d = get(f"{SEARCH_URL}?{params}", headers, delay=0.5)
                asks = [float(i["price"]["value"]) for i in d.get("itemSummaries", []) if "price" in i]
                w.writerow([c["card_key"], f"{q} {filt}", kind, d.get("total", 0), len(asks),
                            min(asks, default=""), statistics.median(asks) if asks else "", max(asks, default="")])
            print("ok", c["card_key"])
    print("wrote", out)


if __name__ == "__main__":
    main()
