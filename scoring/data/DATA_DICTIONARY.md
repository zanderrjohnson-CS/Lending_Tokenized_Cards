# Data dictionary (real data)

## sales_unified.csv (one row per graded-card sale)
sale_id, venue (collector_crypt/magiceden, courtyard), chain, sale_type (fixed_price | marketplace_sale), tx, sale_ts (UTC; Courtyard timestamps are interpolated between chunk-boundary block times, error under a minute), price_usd, price_native, currency (SOL | USDC), buyer_hash / seller_hash (salted SHA-256, 32 hex chars), token_ref (mint or token id), card_key (category|year|set|number|name|language, no grade), category, year, set_name, card_name, card_number, language, grade_company, grade (numeric, half grades kept), grade_label, cert_number.

## series_features.csv (one row per card_key x grade_company x grade)
Every column is computed inside the series only. A PSA 10 and PSA 9 of the same card never share statistics. Blank means unknown, not zero.
- Volume: n_sales, n_tokens, n_sales_7d/30d/90d, median_gap_days, days_since_last_sale
- Price: last_price, median_price, mean_price, median_30d, median_7d, p10, p90, min/max
- Dispersion (disagreement between sales): log_price_std, mad_over_median, iqr_over_median, last_vs_median_logratio
- Volatility (realized, not option-implied): realized_vol_per_sale, realized_vol_per_sqrt_day, repeat_sale_n, repeat_sale_abs_logret (same token sold twice)
- Venue disagreement: n_venues, cross_venue_logdiff (log ratio of venue medians)
- Wash-trade signals: distinct_buyers/sellers, top_buyer_share, top_seller_share, self_trades, repeat_pair_trades, high_volume_wallet_share

## grade_ladder.csv
Same card across grades with the median price and ratio to the next lower grade.
