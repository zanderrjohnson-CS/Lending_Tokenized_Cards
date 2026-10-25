"""Daily SOL/USD (and POL/MATIC not needed: Courtyard pays USDC). Free Binance public market data."""
import json, sys
from .common import RAW, get_json

def main():
    out = RAW / "fx" / "sol_usd_daily_binance.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    rows, start = [], 1609459200000  # 2021-01-01
    while True:
        k = get_json(f"https://data-api.binance.vision/api/v3/klines?symbol=SOLUSDT&interval=1d&limit=1000&startTime={start}")
        if not k: break
        rows += k
        start = k[-1][0] + 86400000
        if len(k) < 1000: break
    out.write_text(json.dumps(rows))
    print(f"saved {len(rows)} daily candles -> {out}")

if __name__ == "__main__":
    main()
