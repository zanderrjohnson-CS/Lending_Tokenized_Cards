"""Shared helpers for real-data collection: cached, throttled, resumable HTTP.

Rules (see scoring/data/SOURCES.md): free sources only, official/public APIs only,
cache every response to disk, never re-request something already cached.
"""
import hashlib, json, os, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # scoring/
RAW = ROOT / "data" / "raw" / "real"                 # gitignored
UA = "CardCredit-hackathon-data-collector/0.1 (non-commercial research)"


def load_env():
    """Load scoring/.env (gitignored) into os.environ if present."""
    for p in (ROOT / ".env", ROOT.parent / ".env"):
        if p.exists():
            for line in p.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def get_json(url, *, headers=None, data=None, retries=6, base_delay=2.0, timeout=45):
    """GET (or POST json if data is given) with exponential backoff on 429/5xx."""
    h = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        h.update(headers)
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(base_delay * (2 ** i))
                continue
            if e.code == 404:
                return None
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            time.sleep(base_delay * (2 ** i))
    raise RuntimeError(f"giving up on {url}: {last}")


def cached_json(path: Path, url, *, throttle=0.5, **kw):
    """Return cached JSON at path, else fetch, write unchanged to disk, sleep."""
    path = Path(path)
    if path.exists():
        return json.loads(path.read_text())
    obj = get_json(url, **kw)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj))
    tmp.replace(path)
    time.sleep(throttle)
    return obj


def hash_wallet(addr: str, salt: str | None = None) -> str:
    """Salted SHA-256 of a wallet address. Salt comes from WALLET_HASH_SALT (never committed)."""
    salt = salt if salt is not None else os.environ.get("WALLET_HASH_SALT", "")
    return hashlib.sha256((salt + addr).encode()).hexdigest()[:32]
