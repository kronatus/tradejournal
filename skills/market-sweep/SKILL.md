---
name: market-sweep
description: Run a market sweep for the Trade Journal's Pulse tab — find what is moving the S&P 500 and Nasdaq-100 (sector rotation, volume surges, breakouts, divergences), dig into the standouts with Robinhood and recent news, and publish highlights and picks. Use when the user asks for a market sweep, market pulse, "what's the market doing", "scan for opportunities", or "find unusual moves".
---

# Market sweep

You write the **Market Pulse** tab of the user's Trade Journal. The journal's
connector (tools such as `get_market_scan`, `post_market_sweep`) has already
done the mechanical work: every S&P 500 and Nasdaq-100 stock (~520) is scanned
in code each day. Your job is judgment — read the scan, investigate a few
names, and explain what matters.

## Budget

Aim for **~12–15 tool calls and ≤ 5 web searches** in total. The scan is
designed so you never need to look at the whole market yourself.

- **Never** loop Robinhood quotes/historicals over the universe or a sector.
- Robinhood is for the **5–8 names** you deep-dive, batched into single calls.
- Never place, review or cancel orders. This is research only.

## Procedure

1. **Read the market** — `get_market_scan()` (one call). It tops up missing
   sessions first; if `refresh.error` is set, mention the data is from
   `scan_date` and carry on.
   - `breadth`: advancers/decliners, % above 20/50-day, new highs/lows, cap-
     vs equal-weighted return (a big gap = narrow, megacap-led tape).
   - `sectors`: ranked by 5-day return; `rank_change_5d > 0` means rotating
     in; `rel_volume > 1.3` means conviction; compare `etf.ret_1d` with the
     sector's `ret_1d`.
   - `industries.leaders/laggards`: where inside a sector the move is.
   - `movers.up/down`: which names actually moved the index (bps).
   - `anomalies`: ranked list with reason codes —
     `REL_VOL` volume spike · `RET_Z` move ≥ 2.5σ of its own history ·
     `GAP` open gap ≥ 3% · `NEW_HIGH`/`NEW_LOW` over the window in
     `meta.high_low_window_days` · `SECTOR_DIVERGENCE` moving against its
     sector · `QUIET_ACCUMULATION` heavy volume, flat price · `STREAK` ≥ 5
     days one way.
2. **Context** — `list_market_sweeps(limit: 3)`. Is today's rotation new or
   persisting? Did earlier picks follow through?
3. **Choose 5–8 names** to investigate. Prefer:
   - anomalies **confirmed by volume** (`REL_VOL` with `RET_Z`/`GAP`/`NEW_HIGH`)
     over price-only moves;
   - names whose move agrees with a sector/industry that is rotating in (or a
     clean divergence from a weak sector);
   - the top 2–3 index contributors if they explain the day;
   - `QUIET_ACCUMULATION` only when the sector context supports it.
   Skip names whose only flag is `STREAK` unless nothing better exists.
4. **Detail** — `get_symbol_detail(symbols: [...])` once for the chosen names
   (technicals from stored bars: trend vs SMAs, RSI, ATR, rel volume).
5. **Robinhood, batched** —
   - `get_equity_quotes(symbols: [...chosen])` once: current/after-hours price.
   - `get_index_quotes` for VIX (and SPX if useful) once.
   - Optionally `get_earnings_calendar` once to catch earnings-driven moves.
6. **Why is it moving?** — web search, **only the last ~2 days** relative to
   today. One search per top name or a combined sector query; plus one for
   the macro calendar (Fed, CPI, jobs, big earnings) if relevant. Never cite
   older news as the cause of today's move.
7. **Exposure** — `list_open_positions()`; flag picks or sectors that overlap
   the user's open strategies.
8. **Publish** — `post_market_sweep` (fields below), then give the user a short
   chat summary and offer to run **ticker-research** on any pick.

## What to write (`post_market_sweep`)

- `scan_date`: the scan's `scan_date`. `as_of`: now, ISO-8601 with offset.
- `headline` (≤ 200 chars): the one-line story of the session.
- `regime`: one of
  - `risk_on` — broad advance, breadth > ~60%, cyclicals/growth lead, VIX falling
  - `risk_off` — broad decline, defensives lead, VIX rising
  - `rotation` — index flat-ish but sectors moving hard in opposite directions
  - `volatile` — large swings / VIX spike without a clear direction
  - `neutral` — none of the above
- `summary` (≤ 2000 chars): where the market is, what drove it, what changed
  vs recent sweeps. Plain prose, numbers from the scan.
- `highlights` (≤ 12): each `{kind, title, body, symbols}` with `kind` one of
  `abnormality` (unusual single-name behaviour), `sector`, `trend`,
  `breadth`, `macro`. Lead with abnormalities.
- `picks` (≤ 10): `{symbol, direction: bullish|bearish|neutral|watch,
  horizon: days|weeks|months, signal, thesis, sector}`. `signal` names the
  evidence briefly (e.g. "REL_VOL 3.1× + NEW_HIGH, semis rank ▲4");
  `thesis` says why it is worth a deep dive and what would invalidate it.
- `trends` (≤ 8): `{title, body, sectors}` — multi-day patterns (rotation,
  breadth thrust/divergence, leadership changes).

Conventions: percentages in percent units (1.25 = 1.25%), money in integer
cents, null rather than 0 for anything unknown. If the tool rejects a payload,
read the message, fix the field and retry once.

## Tone

Specific and evidential — every claim should trace to a number in the scan,
a quote, or a dated article. Say what is *unusual*, not just what moved.
This is market research for the user's own decisions, not advice.
