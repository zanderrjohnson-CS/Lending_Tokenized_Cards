"""Pull per-grade prices, sales volume and recent sold listings from PriceCharting.

Two modes:
  api   (recommended) Official API, needs a paid PriceCharting subscription token
        (https://www.pricecharting.com/api-documentation). Returns current per-grade prices and
        a sales-volume figure. Prices come back in pennies. No sale-by-sale history.
  page  Reads the public card page, which lists the ~30 most recent eBay and ~30 most recent
        TCGplayer ungraded sales plus per-grade tables. Their terms restrict automated
        scraping, so treat this as a low-volume demo path only (one request every few seconds,
        a handful of cards) and switch to the API for anything real. Selectors checked against
        the live pages on 2026-10-26.

Usage:
  PRICECHARTING_TOKEN=... python src/fetch_pricecharting.py api
  python src/fetch_pricecharting.py page
Writes data/raw/pricecharting_<date>.txt in the same format compute_factors.py reads.
"""
import csv
import os
import re
import sys
from datetime import date
from html.parser import HTMLParser
from urllib.parse import quote

from netutil import get

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# PriceCharting reuses its video-game field names for card grades.
API_GRADE_FIELDS = {
    "loose-price": "Ungraded", "cib-price": "Grade 7", "new-price": "Grade 8",
    "graded-price": "Grade 9", "box-only-price": "Grade 9.5", "manual-only-price": "PSA 10",
}


def via_api(card, token):
    d = get(f"https://www.pricecharting.com/api/product?t={token}&q={quote(card['name'] + ' ' + card['set'])}")
    lines = [f"# api product id={d.get('id')} name={d.get('product-name')} console={d.get('console-name')}"]
    vol = d.get("sales-volume")
    for field, grade in API_GRADE_FIELDS.items():
        if d.get(field) is not None:
            # API gives one total yearly volume, not per grade; it is attached to Ungraded only.
            v = f"{vol} sales per year" if grade == "Ungraded" and vol else "0 sales per year"
            lines.append(f"GRADE|{grade}|{d[field] / 100:.2f}|{v}")
    return lines


class SalesTableParser(HTMLParser):
    """Collects rows from the completed-sales tables and the per-grade price summary."""

    def __init__(self):
        super().__init__()
        self.section, self.row, self.cell, self.rows, self.text = None, None, None, [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "") or ""
        m = re.search(r"completed-auctions-([\w-]+)", cls)
        if tag == "div" and m:
            self.section = m.group(1)  # e.g. used (ungraded), graded, manual-only (PSA 10)
        elif tag == "tr" and self.section:
            self.row = {"section": self.section, "id": a.get("id", "")}
        elif tag == "td" and self.row is not None:
            self.cell, self.text = cls, []
        elif tag == "span" and self.row is not None and "js-price" in cls:
            self.cell, self.text = "price", []

    def handle_data(self, data):
        if self.cell is not None:
            self.text.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "span") and self.cell is not None and self.row is not None:
            val = " ".join("".join(self.text).split())
            key = "price" if self.cell == "price" else ("date" if "date" in self.cell else "title" if "title" in self.cell else None)
            if key and key not in self.row:
                self.row[key] = val
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row.get("date") and self.row.get("price"):
                self.rows.append(self.row)
            self.row = None


def via_page(card):
    html = get(f"https://www.pricecharting.com/game/{card['pricecharting_path']}", as_json=False, delay=4.0)
    p = SalesTableParser()
    p.feed(html)
    lines = []
    for r in p.rows:
        if r["section"] != "used":  # keep ungraded sales; graded tables vary by page
            continue
        price = float(re.sub(r"[^\d.]", "", r["price"]) or 0)
        venue = "TCGplayer" if "TCGPlayer" in r.get("title", "") or r["id"].startswith("tcg") else "eBay"
        lines.append(f"SALE|{r['date']}|{price:.2f}|{venue}")
    # Per-grade summary: the price table near the top has ids like used_price, graded_price ...,
    # and the row under it has the sales volume per grade, keyed by its completed-sales tab.
    for field, tab, grade in (("used_price", "used", "Ungraded"), ("complete_price", "cib", "Grade 7"),
                              ("new_price", "new", "Grade 8"), ("graded_price", "graded", "Grade 9"),
                              ("box_only_price", "box-only", "Grade 9.5"), ("manual_only_price", "manual-only", "PSA 10")):
        m = re.search(rf'id="{field}".*?\$([\d,]+\.\d\d)', html, re.S)
        v = re.search(rf'data-show-tab="completed-auctions-{tab}">.*?<a href="#">([^<]+)</a>', html, re.S)
        if m:
            vol = v.group(1).strip() if v else "0 sales per year"
            lines.insert(0, f"GRADE|{grade}|{m.group(1).replace(',', '')}|{vol}")
    if not p.rows:
        print(f"  warning: no sale rows parsed for {card['card_key']}; selectors probably need updating")
    return lines


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "page"
    token = os.environ.get("PRICECHARTING_TOKEN")
    if mode == "api" and not token:
        sys.exit("set PRICECHARTING_TOKEN for api mode")
    with open(os.path.join(ROOT, "data", "cards.csv")) as f:
        cards = list(csv.DictReader(f))
    out = os.path.join(ROOT, "data", "raw", f"pricecharting_{date.today().isoformat()}.txt")
    with open(out, "w") as f:
        f.write(f"# PriceCharting {mode} pull {date.today().isoformat()}\n")
        for c in cards:
            lines = via_api(c, token) if mode == "api" else via_page(c)
            f.write(f"\n== {c['card_key']}\n" + "\n".join(lines) + "\n")
            print("ok", c["card_key"], len(lines), "lines")
    print("wrote", out)


if __name__ == "__main__":
    main()
