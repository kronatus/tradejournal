---
name: options-strategist
description: Build options strategy ideas for a ticker in the Trade Journal's Research tab — read the regime, pull a bounded option chain slice from Robinhood, let the journal price and gate every candidate (risk ≤ 3.25× reward, positive expectancy under realized volatility, max loss ≤ 50% of the account, survives a gap), and save up to 3 ranked, strategy-diverse ideas. Runs the ticker-research skill first when the ticker has no report (a sweep pick or new name) or its report is older than 24 h, so the whole Research page is populated. Use when the user asks for options strategies, trade ideas, "run the options strategist on X", or to refresh the strategies section of a ticker report; also as the last step of ticker research when the user wants strategies.
---

# Options strategist

You own the **Options strategies** section of a ticker's report on the
Research tab. You write it through the journal's connector
(`get_strategy_context`, `evaluate_option_strategies`, `save_strategy_set`)
using the user's Robinhood connector for quotes. Saving replaces only that
section; the rest of the report is untouched. **Research only: never place,
review or cancel orders.** The user places trades manually.

## The account and the premises

The account trades **options only** (it can hold shares after an
assignment). It is small and run aggressively on purpose.

- **IV overstates realized volatility on average.** Option sellers are paid
  for bearing risk the market overprices. Prefer theta-positive structures to
  buying premium and waiting for events.
- **Time decay is the one certain force.** Direction is a guess. A premium
  seller is paid as expiry approaches, as long as the stock stays inside the
  structure.
- **Defined risk makes aggressive sizing survivable.** Up to 50% of the
  account per position, 2–3 positions at a time.
- **The edge exists only at fair prices.** Prefer tight markets and liquid
  chains. With a few contracts "liquid" is broad, so a good setup in a thinner
  name is fine.
- **Events are mispriced, not unpredictable.** IV inflates before earnings
  and crushes after. Stocks overreact to news and then mean-revert.

## Principles

- **Sell premium by default**: credit spreads, iron condors and butterflies,
  broken-wing butterflies, jade lizards, cash-secured puts, calendars and
  other theta-positive playbooks. Debit spreads are for setups that demand
  direction.
- **Regime first, structure second.** The journal's selector turns the trend,
  momentum, volatility and risk ratings, IV versus realized volatility, and
  days to earnings into the eligible families. Don't fight it without saying
  why.
- **Every candidate must clear the economics gate.** The journal reprices at
  real bid/ask and computes max gain and max risk independently. You never
  compute or write these numbers. If nothing clears, the answer is **"no
  compliant setup"**, not a worse trade.
- **Strikes anchor to real levels.** Use support and resistance from the last
  20 sessions. A structure must survive a recent-size gap without hitting max
  loss.
- **Verify before acting.** Every set is priced off a reference price and
  timestamp. If the stock has moved away from it, the set is stale and must be
  re-run, not traded.
- **Be creative.** The catalogue covers the common playbooks. You may add up
  to 5 structures of your own per evaluation, such as:
  - unbalanced or skip-strike wings;
  - a broken-wing condor;
  - a put-side BWB paired with a call credit spread;
  - a calendar or diagonal across the earnings date;
  - a 1×2 ratio with a protective wing.

  Anything with defined risk can be tried, and the gate decides.

## Horizons

- `short`: **0–3 DTE**. Aggressive, close to scalping. Needs live quotes,
  goes stale after 30 minutes.
- `long`: **4–21 DTE**. Lets a setup form. Stale after a day.
- Longer horizons are not defined yet. Don't propose them.

## Procedure

1. **Research first.** Strategies stand on a fresh ticker report: it is the
   regime read the selector uses, and it fills the rest of the Research page.
   Call `get_ticker_report(symbol)`:
   - **No report** (a sweep pick, or a ticker named for the first time): run
     the **ticker-research** skill on it now, in full, through
     `save_ticker_report`. That also adds it to the research list. Then
     continue here.
   - **Report older than 24 h** (check its `as_of`): refresh it with the
     **ticker-research** skill first, then continue.
   - **Report ≤ 24 h old**: go straight on.

   Don't ask the user before doing this; it is part of the job. Tell them in
   one line that you researched or refreshed the ticker first. The journal
   enforces the rule: the strategy tools refuse a ticker without a ≤ 24 h
   report and say which step is missing. If one refuses, do what it says and
   retry.
2. **Context.** Call `get_strategy_context(symbol, horizons)`. Use both
   horizons unless the user asked for one. Its `research` field shows which
   report it used. Read:
   - `context.selections[h]`: bias, IV regime, earnings mode, eligible families
   - `context.supports_cents` / `context.resistances_cents`, `gap_cents`
   - `warnings`
   - `fetch_plan`: which expiries and strike band to pull per horizon
3. **Robinhood data.**
   - **Account value:** from `get_accounts` / `get_portfolio`, take the
     equity of the account the user trades options in. If several accounts
     exist and it's unclear which, ask once. Pass it as
     `account_value_cents`.
   - **Reference price:** `get_equity_quotes`. Use the newest of
     last trade / extended-hours price as `reference_price_cents`, with its
     venue time as `reference_at`.
   - **Chain slice:**
     - `get_option_chains` gives the expiries.
     - For each planned expiry (≤ 2 per horizon, plus the back month when the
       plan asks for one), `get_option_instruments` gives the calls and puts
       at every listed strike inside `strike_band_cents`.
     - `get_option_quotes` (batched) gives bid, ask, implied volatility,
       delta, open interest and volume.
     - Keep it to **≤ 160 contracts**. If the band holds more, skip every
       other strike far from the money.
   - Quotes must be fresh: ≤ 30 minutes for `short`, same day for `long`.
4. **Evaluate.** Call `evaluate_option_strategies` with the chain and
   reference, plus any `custom_structures` worth testing. Read:
   - `candidates`: up to 3, ranked by expected return on risk, one per family
   - `near_misses`: the best that failed, with reasons
   - `rejected`: counts per reason
   - `no_compliant_setup`

   If nothing passes, hunt once or twice before giving up. Try:
   - other strikes, widths or expiries;
   - unbalanced wings;
   - a credit-side variant of a debit idea;
   - a custom structure aimed at the failing reason. For example:
     `risk_reward` → collect more credit or narrow the risk side; `gap` →
     move the short strike past the gap or widen the wing.
5. **Choose and explain.** Pick ≤ 3 strategy-diverse ideas from the passing
   candidates. You may skip one the numbers like if the news or context
   argues against it. For each idea write:
   - `rationale` (≤ 500 chars): why this structure fits this regime and
     these levels, and where the edge comes from (IV vs realized, event
     crush, anchor levels).
   - `catalysts` (≤ 4) and `risks` (≤ 4): concrete, dated where possible.
   - `exit_plan` (≤ 300 chars), following the management rules:
     - take a partial at **50% of max profit**;
     - **roll first, then cut** a loser at a **50% loss of the credit
       received** (debit structures: at 50% of the debit);
     - for 0–3 DTE, also when to be flat;
     - name the price levels.
6. **Save.** Call `save_strategy_set` with **the same** `symbol`, `as_of`,
   `horizons`, `reference_price_cents`, `reference_at`,
   `account_value_cents` and `chain` you evaluated with, plus `ideas`. Each
   idea has:
   - `family`: the candidate's family, or `custom` with a `name`;
   - `legs`: the candidate's legs (`expiry`, `strike_cents`, `type`, `side`,
     `ratio`);
   - your prose.

   With no compliant setup, save `ideas: []` and a `no_setup_reason` that
   names what failed. The server re-prices and re-gates. If it rejects an
   idea, read the message, fix it or drop that idea, and retry once.
7. **Summarise in chat** in 3–6 lines:
   - the regime read;
   - each idea in one line: structure, expiry, net credit or debit, max loss,
     PoP, expected P&L, and size as `qty` (% of account);
   - or why there is no compliant setup.

   Link the Research tab view.

## Payload rules

- Strikes and prices: integer **cents per share** (`97.50` → `9750`,
  `1.52` → `152`). A missing bid or ask is `null`, never 0, unless the market
  really shows 0.
- `iv` is a decimal (0.31). `quoted_at`, `as_of`, `reference_at` are ISO-8601
  with an offset.
- `ratio` is the number of contracts of that leg per unit, for example 2 for
  a butterfly body.
- Sizing (`qty`) comes from the server: `floor(50% of account / max loss per
  unit)`. Quote it, don't change it.

This is research for the user's own decisions, not advice.
