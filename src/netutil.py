"""Tiny stdlib HTTP helper shared by the fetchers (polite delay, retries, JSON)."""
import json
import time
import urllib.error
import urllib.request

UA = "pokemon-card-safety-score/0.1 (hackathon research)"
_last = [0.0]


def get(url, headers=None, delay=1.0, retries=6, as_json=True, data=None):
    wait = delay - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})}, data=data)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                _last[0] = time.time()
                body = r.read()
                return json.loads(body) if as_json else body.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            # A daily quota (PSA: 100 calls/day) will not clear with a retry, so stop right away.
            quota = e.code == 429 and b"quota" in (e.read() or b"").lower()
            if e.code in (429, 500, 502, 503, 504) and not quota and attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
