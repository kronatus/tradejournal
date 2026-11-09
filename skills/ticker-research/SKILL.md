---
name: ticker-research
description: Research a stock or ETF for the Trade Journal's Research tab — current price and key numbers from Robinhood, technical analysis of trend, momentum, volatility and risk, a short fundamentals paragraph, and up to 5 articles from the last 2 days — then save it to the journal. Use when the user asks to research, analyze or refresh a ticker, or to "refresh my research list".
---

# Ticker research

You write the **Research** tab of the user's Trade Journal through its
connector (`save_ticker_report`, `get_symbol_detail`, …), using the user's
Robinhood connector and web search for data. Research only: never place,
review or cancel orders.

## Which tickers

- A ticker the user names → that one.
- "Refresh my research list" → `list_research_tickers()` and refresh those
  with `freshness` of `stale` or `none` first (then `aging`). Do at most ~5 per
  turn and tell the user which remain.

## Procedure (per ticker; batch Robinhood calls when doing several)

1. **Prior view** — `get_ticker_report(symbol)` if one exists, to note what
   changed.
2. **Computed technicals** — `get_symbol_detail(symbols: [...])` (up to 10 at
   once). If a symbol is in `not_found`, use Robinhood
   `get_equity_technical_indicators` (interval `day`, output `latest`) for RSI,
   SMA 20/50/200, ATR and MACD instead.
3. **Robinhood snapshot** (batch symbols in each call):
   - `get_equity_quotes` → price: whichever of `last_trade_price` /
     `last_non_reg_trade_price` has the newer venue time (`session` =
     `regular` or `extended`; `closed` if neither is from today). Change vs
     `adjusted_previous_close`. Check the timestamp — say "as of", not "now",
     when it is old.
   - `get_equity_fundamentals` (≤ 10 per call) → open/high/low, volume,
     `average_volume_30_days`, 52-week high/low, `market_cap`, `pe_ratio`,
     `pb_ratio`, `dividend_yield`, sector/industry hints, ex-dividend dates.
   - `get_equity_analyst_ratings` → buy/hold/sell counts and price targets.
   - `get_earnings_calendar` → next earnings date.
   - Optional IV: `get_option_chains` → `get_option_instruments` for the
     expiration nearest 30 DTE, the 1–2 strikes nearest spot → `get_option_quotes`;
     use the average ATM `implied_volatility`. Skip if it costs too many calls.
4. **News** — web search for articles about the company **published within
   the last 2 days of today**. Keep the ≤ 5 most relevant (company-specific
   first: earnings, guidance, deals, regulatory, analyst moves, product news;
   then sector news that clearly affects it). **Fewer is fine — never pad with
   older items.** Record the real publish time.
5. **Write** the four technical dimensions, the fundamentals paragraph, and
   save with `save_ticker_report`. Then summarise in chat in 3–5 lines.
6. **Strategies (optional)** — if the user asked for trade ideas or
   strategies, continue with the **options-strategist** skill for this
   ticker now. The fresh report is its regime read. Otherwise offer it in one
   line.

## Technical rating rubric

Use the numbers; keep each `summary` ≤ 400 chars and put the 3–6 numbers you
relied on in `metrics` (names like `rsi14`, `sma50_cents`, `atr14_pct`,
`rel_volume`, `dist_sma200_pct`; `*_cents` for prices, `*_pct` for percents).

- **trend**: `strong_up` close > SMA20 > SMA50 > SMA200 and near highs ·
  `up` above SMA50 and SMA200 · `sideways` tangled SMAs / range-bound ·
  `down` below SMA50 and SMA200 · `strong_down` close < SMA20 < SMA50 < SMA200.
- **momentum**: `strong` RSI 60–75 with MACD above signal and rising ·
  `positive` RSI 52–60 or MACD above signal · `neutral` RSI 45–55, flat MACD ·
  `negative` RSI 35–48 or MACD below signal · `weak` RSI < 35 with MACD
  falling. RSI > 75 or < 25 → say overbought/oversold in the summary.
- **volatility**: from ATR% of price and 20-day HV (and IV if known) —
  `low` ATR% < 1.2 · `normal` 1.2–2.5 · `elevated` 2.5–4 · `high` > 4, or IV
  far above HV.
- **risk**: overall downside risk for a holder now — weigh distance to
  support/SMA50, drawdown, valuation stretch vs targets, upcoming earnings
  inside ~2 weeks, ex-dividend, event risk from the news. `low` · `moderate` ·
  `high` · `very_high`.

## Fundamentals paragraph

3–4 sentences, ≤ 1200 chars: valuation (P/E, P/B vs its usual range or
sector), size, dividend, analyst stance vs price, and the one or two business
facts that matter right now (from the news). No boilerplate company history.

## Payload rules (`save_ticker_report`)

- `snapshot`: integer **cents** for every price (`342.36` → `34236`); market
  cap in cents too. Percent units for `change_pct` and `dividend_yield_pct`.
  `iv` as a decimal (0.28). `null` for anything you don't have — **never 0**.
- `as_of`: when the data was marked (the quote time), ISO-8601 with offset.
- `sector` / `industry`: GICS-style names if you know them (the journal fills
  them from its universe otherwise). `setup`: a 1–3 word tag for the current
  situation, e.g. "Uptrend pullback", "Breakout", "Range", "Downtrend",
  "Earnings run-up", "High IV".
- `articles`: ≤ 5, each `{title, url, source, published_at, summary}`;
  `summary` one sentence on why it matters for the stock.
- `next_earnings_date`: `YYYY-MM-DD` or null.
- Options strategies are **not** part of this payload. They live in their own
  section, written by the **options-strategist** skill (`save_strategy_set`).

If the tool rejects the payload, read the message, fix it and retry once.
This is research for the user's own decisions, not advice.
