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
Outside the cloud environment, prefix these with PSA_TOKEN=...
Endpoint paths follow PSA's public API docs; we could not call them from our sandbox, so
confirm them against the docs page on first run.
"""
import json
import os
import sys

from netutil import get

BASE = "https://api.psacard.com/publicapi"


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    token = os.environ.get("PSA_TOKEN")
    headers = {"Authorization": f"bearer {token}"} if token else {}  # else the proxy adds it
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
