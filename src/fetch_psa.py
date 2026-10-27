"""PSA cert verification and population counts through the PSA Public API.

Needs a free PSA account and API token (https://www.psacard.com/publicapi). In the Claude cloud
environment the token is a network secret, and the proxy adds the Authorization header, so
nothing needs to be set. Elsewhere, set PSA_TOKEN.
The free tier allows about 100 calls a day, so cache results.

Two uses for the score:
  * Authenticity: verify the cert number a borrower pledges (card, grade, and that it exists).
  * Population: total graded copies and the PSA 10 share for the card's spec. The public pop
    report pages need a login, so the API is the only clean route.

Usage:
  python src/fetch_psa.py cert 12345678
  python src/fetch_psa.py pop <specID>   # specID comes back in a cert lookup
  python src/fetch_psa.py daily [max_calls]   # scheduled run, default 90 calls
The PSA API has no search by card name, so a spec ID (PSA's id for one card + variety, which the
population endpoint needs) can only be learned from a cert lookup. Daily mode verifies the pledged
certs in data/psa_certs.csv (card_key,cert_number) first; for any card still without a spec ID it
looks up certs that sellers put in PriceCharting listing titles (CERT lines written by
fetch_pricecharting.py), checks the cert really is that card, and keeps its spec ID. Then it pulls
populations by spec ID, least recently fetched first, into data/raw/psa_pop.csv. Every response is
cached under data/raw/psa/, what was fetched when is in data/raw/psa_state.json, and it stops on
HTTP 429.
Outside the cloud environment, prefix these with PSA_TOKEN=...
Endpoint paths follow PSA's public API docs; we could not call them from our sandbox, so
confirm them against the docs page on first run.
"""
import csv
import glob
import json
import os
import re
import sys
import urllib.error
from datetime import datetime, timezone

from netutil import get

BASE = "https://api.psacard.com/publicapi"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERTS = os.path.join(ROOT, "data", "psa_certs.csv")
CACHE = os.path.join(ROOT, "data", "raw", "psa")
STATE = os.path.join(ROOT, "data", "raw", "psa_state.json")
POP = os.path.join(ROOT, "data", "raw", "psa_pop.csv")


def pc_cert_candidates():
    """card_key -> PSA cert numbers seen in PriceCharting graded listing titles, newest pull first."""
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "raw", "pricecharting_*.txt")), reverse=True):
        key = None
        with open(path) as f:
            for line in f:
                if line.startswith("== "):
                    key = line[3:].strip()
                elif line.startswith("CERT|") and key:
                    cert = line.split("|")[1]
                    if cert not in out.setdefault(key, []):
                        out[key].append(cert)
    return out


def cert_matches(card, c):
    """Does a cert lookup describe this card? Listing titles can be wrong, so check before trusting
    the spec ID: same Pokemon in Subject, same card number, and no 1st Edition / Shadowless variety
    for an Unlimited card."""
    subject = (c.get("Subject") or "").upper()
    if card["name"].split()[0].upper() not in subject:
        return False
    want = re.sub(r"\D", "", card["number"].split("/")[0]).lstrip("0")
    got = re.sub(r"\D", "", str(c.get("CardNumber") or "")).lstrip("0")
    if want and got and want != got:
        return False
    variety = (c.get("Variety") or "").upper()
    label = (card["name"] + " " + card["set"]).upper()
    return not any(v in variety and v not in label for v in ("1ST EDITION", "SHADOWLESS"))


def pop_counts(d):
    """Pull total and per-grade counts out of a GetPSASpecPopulation response."""
    pop = d.get("PSAPop", d) if isinstance(d, dict) else {}
    get_n = lambda *ks: next((pop[k] for k in ks if isinstance(pop.get(k), (int, float))), None)
    return {"total": get_n("Total", "TotalPopulation"), "psa10": get_n("Grade10", "PSA10", "10"),
            "psa9": get_n("Grade9", "PSA9", "9"), "description": (d.get("Description") or pop.get("Description") or "") if isinstance(d, dict) else ""}


def append_pop(today, rows):
    fields = ["date", "card_key", "spec_id", "description", "total", "psa10", "psa9"]
    kept = []
    if os.path.exists(POP):
        with open(POP) as f:
            done = {(today, r["spec_id"]) for r in rows}
            kept = [r for r in csv.DictReader(f) if (r["date"], r["spec_id"]) not in done]
    with open(POP, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(kept + rows)


def daily(headers, max_calls):
    today = datetime.now(timezone.utc).date().isoformat()
    state = {"certs": {}, "specs": {}, "runs": []}
    if os.path.exists(STATE):
        with open(STATE) as f:
            state.update(json.load(f))
    with open(os.path.join(ROOT, "data", "cards.csv")) as f:
        cards = {c["card_key"]: c for c in csv.DictReader(f)}
    certs = []
    if os.path.exists(CERTS):
        with open(CERTS) as f:
            certs = [r for r in csv.DictReader(f) if (r.get("cert_number") or "").strip()]
    # Work items, in priority order:
    #   1. pledged certs from data/psa_certs.csv (borrower slabs to verify), least recently checked first;
    #   2. for each card with no verified spec ID yet, up to 2 untried certs from PriceCharting listing
    #      titles (one lookup reveals the card's spec ID, so pop counts work without a pledged cert);
    #   3. population by spec ID, never-fetched first, then least recently fetched.
    last = lambda kind, k: state["certs" if kind == "cert" else "specs"].get(k, {}).get("fetched", "")
    has_spec = {v.get("card_key") for v in state["specs"].values()}
    todo = sorted((("cert", r["cert_number"].strip(), r["card_key"]) for r in certs
                   if last("cert", r["cert_number"].strip()) != today), key=lambda t: last(*t[:2]))
    for key, found in pc_cert_candidates().items():
        if key in cards and key not in has_spec:
            todo += [("cert", c, key) for c in found if c not in state["certs"]][:2]
    specs = [("spec", sid, v.get("card_key", "")) for sid, v in state["specs"].items() if last("spec", sid) != today]
    todo += sorted(specs, key=lambda t: last(*t[:2]))
    calls, fetched, stop, pops = 0, [], None, []
    os.makedirs(CACHE, exist_ok=True)
    while todo and calls < max_calls:
        kind, key, card = todo.pop(0)
        if kind == "cert" and card in has_spec and key not in {r["cert_number"].strip() for r in certs}:
            continue  # an earlier candidate already gave this card its spec ID
        url = f"{BASE}/cert/GetByCertNumber/{key}" if kind == "cert" else f"{BASE}/pop/GetPSASpecPopulation/{key}"
        calls += 1
        try:
            d = get(url, headers, retries=1)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                stop = "HTTP 429"
                break
            print("FAILED", kind, key, e)
            if kind == "cert":  # e.g. a bad number from a listing title: don't try it again
                state["certs"][key] = {"card_key": card, "fetched": today, "error": f"HTTP {e.code}"}
            continue
        with open(os.path.join(CACHE, f"{kind}_{key}_{today}.json"), "w") as f:
            json.dump(d, f, indent=2)
        fetched.append(f"{kind}:{key}")
        if kind == "spec":
            state["specs"][key]["fetched"] = today
            pops.append({"date": today, "card_key": card, "spec_id": key, **pop_counts(d)})
            continue
        c = (d.get("PSACert") or {}) if isinstance(d, dict) else {}
        ok = bool(c) and card in cards and cert_matches(cards[card], c)
        state["certs"][key] = {"card_key": card, "fetched": today, "matches_card": ok,
                               "spec_id": str(c.get("SpecID") or ""), "grade": c.get("CardGrade")}
        spec = str(c.get("SpecID") or "")
        if not ok:
            print(f"cert {key} does not match {card}: {c.get('Year')} {c.get('Subject')} {c.get('Variety')} #{c.get('CardNumber')}")
        elif spec and spec not in state["specs"]:
            state["specs"][spec] = {"card_key": card, "fetched": ""}
            has_spec.add(card)
            todo.insert(0, ("spec", spec, card))
    if pops:
        append_pop(today, pops)
    state["runs"] = [r for r in state["runs"] if r.get("date") != today] + [
        {"date": today, "calls": calls, "fetched": fetched, "stopped": stop}]
    with open(STATE, "w") as f:
        json.dump(state, f, indent=2, sort_keys=True)
    missing = sorted(set(cards) - has_spec)
    print(f"psa daily: {calls} calls, {len(fetched)} cached" + (f", stopped on {stop}" if stop else "")
          + (f"; no spec ID yet for {', '.join(missing)}" if missing else ""))


def main():
    token = os.environ.get("PSA_TOKEN")
    headers = {"Authorization": f"bearer {token}"} if token else {}  # else the proxy adds it
    if len(sys.argv) >= 2 and sys.argv[1] == "daily":
        return daily(headers, int(sys.argv[2]) if len(sys.argv) > 2 else 90)
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    kind, arg = sys.argv[1], sys.argv[2]
    if kind == "cert":
        d = get(f"{BASE}/cert/GetByCertNumber/{arg}", headers)
    elif kind == "pop":
        d = get(f"{BASE}/pop/GetPSASpecPopulation/{arg}", headers)
    else:
        sys.exit("kind must be cert or pop")
    print(json.dumps(d, indent=2))


if __name__ == "__main__":
    main()
