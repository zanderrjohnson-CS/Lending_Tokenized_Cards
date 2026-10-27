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
Daily mode reads cert numbers from data/psa_certs.csv (card_key,cert_number), looks up the certs
and spec populations fetched least recently (never-fetched first), caches every response under
data/raw/psa/, records what was fetched when in data/raw/psa_state.json, and stops on HTTP 429.
Outside the cloud environment, prefix these with PSA_TOKEN=...
Endpoint paths follow PSA's public API docs; we could not call them from our sandbox, so
confirm them against the docs page on first run.
"""
import csv
import json
import os
import sys
import urllib.error
from datetime import datetime, timezone

from netutil import get

BASE = "https://api.psacard.com/publicapi"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERTS = os.path.join(ROOT, "data", "psa_certs.csv")
CACHE = os.path.join(ROOT, "data", "raw", "psa")
STATE = os.path.join(ROOT, "data", "raw", "psa_state.json")


def daily(headers, max_calls):
    today = datetime.now(timezone.utc).date().isoformat()
    state = {"certs": {}, "specs": {}, "runs": []}
    if os.path.exists(STATE):
        with open(STATE) as f:
            state.update(json.load(f))
    certs = []
    if os.path.exists(CERTS):
        with open(CERTS) as f:
            certs = [r for r in csv.DictReader(f) if (r.get("cert_number") or "").strip()]
    # Work items: every cert, plus every specID learned from a cert. Specs first-seen get priority
    # by sorting on last-fetched date ("" for never), so coverage rotates across days.
    todo = [("cert", r["cert_number"].strip(), r["card_key"]) for r in certs]
    todo += [("spec", sid, v.get("card_key", "")) for sid, v in state["specs"].items()]
    last = lambda kind, k: state["certs" if kind == "cert" else "specs"].get(k, {}).get("fetched", "")
    todo = [t for t in todo if last(t[0], t[1]) != today]
    todo.sort(key=lambda t: (last(t[0], t[1]), t[0] != "cert"))
    calls, fetched, stop = 0, [], None
    os.makedirs(CACHE, exist_ok=True)
    while todo and calls < max_calls:
        kind, key, card = todo.pop(0)
        url = f"{BASE}/cert/GetByCertNumber/{key}" if kind == "cert" else f"{BASE}/pop/GetPSASpecPopulation/{key}"
        calls += 1
        try:
            d = get(url, headers, retries=1)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                stop = "HTTP 429"
                break
            print("FAILED", kind, key, e)
            continue
        with open(os.path.join(CACHE, f"{kind}_{key}_{today}.json"), "w") as f:
            json.dump(d, f, indent=2)
        bucket = state["certs" if kind == "cert" else "specs"]
        bucket[key] = {"card_key": card, "fetched": today}
        fetched.append(f"{kind}:{key}")
        spec = (d.get("PSACert") or {}).get("SpecID") if kind == "cert" and isinstance(d, dict) else None
        if spec and str(spec) not in state["specs"]:
            state["specs"][str(spec)] = {"card_key": card, "fetched": ""}
            todo.append(("spec", str(spec), card))
    state["runs"] = [r for r in state["runs"] if r.get("date") != today] + [
        {"date": today, "calls": calls, "fetched": fetched, "stopped": stop}]
    with open(STATE, "w") as f:
        json.dump(state, f, indent=2, sort_keys=True)
    print(f"psa daily: {calls} calls, {len(fetched)} cached" + (f", stopped on {stop}" if stop else "")
          + ("" if certs else f" (no cert numbers in {os.path.relpath(CERTS, ROOT)}; nothing to call)"))


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
