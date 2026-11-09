/**
 * Short explanations for the technical terms shown on Research and Pulse,
 * surfaced as hover/tap bubbles by components/ui/term.tsx.
 *
 * `what` says what the number measures; `why` says what traders use it for.
 * Keep both to a sentence or two — the bubble is a reminder, not a lesson.
 */

import { STRATEGY_RULES } from "./strategy-rules";

export type GlossaryEntry = { term: string; what: string; why: string };

const G = {
  sma: (n?: number): GlossaryEntry => ({
    term: n ? `SMA ${n}` : "SMA",
    what: n
      ? `Simple moving average: the average closing price of the last ${n} sessions.`
      : "Simple moving average: the average closing price over a fixed number of sessions.",
    why:
      n && n >= 200
        ? "The classic long-term trend line. Price above it is generally read as a long-term uptrend."
        : n && n >= 50
          ? "A medium-term trend line that often acts as support in uptrends and resistance in downtrends."
          : "A short-term trend line. Price crossing it is an early sign of a change in direction.",
  }),
  ema: (n?: number): GlossaryEntry => ({
    term: n ? `EMA ${n}` : "EMA",
    what: `Exponential moving average${n ? ` over ${n} sessions` : ""}, weighting recent closes more heavily than older ones.`,
    why: "Reacts faster than a simple average, so it is used to track short-term trend and pullback levels.",
  }),
  distSma: (n?: number): GlossaryEntry => ({
    term: n ? `Distance from SMA ${n}` : "Distance from SMA",
    what: `How far the price is above (+) or below (−) its ${n ? `${n}-session ` : ""}moving average, in percent.`,
    why: "Shows how stretched a move is. Large gaps tend to revert towards the average.",
  }),
  rsi: (n?: number): GlossaryEntry => ({
    term: n ? `RSI ${n}` : "RSI",
    what: `Relative Strength Index${n ? ` over ${n} sessions` : ""}: the balance of recent gains vs losses on a 0–100 scale.`,
    why: "Gauges momentum. Above 70 is often called overbought and below 30 oversold. 50 is neutral.",
  }),
} as const;

const ENTRIES: Record<string, GlossaryEntry> = {
  macd: {
    term: "MACD",
    what: "Moving Average Convergence Divergence: the 12-session EMA minus the 26-session EMA.",
    why: "A momentum and trend signal. Above zero means short-term momentum is stronger than longer-term.",
  },
  macd_signal: {
    term: "MACD signal",
    what: "A 9-session EMA of the MACD line.",
    why: "MACD crossing above its signal line is read as bullish momentum, and crossing below as bearish.",
  },
  macd_hist: {
    term: "MACD histogram",
    what: "MACD minus its signal line.",
    why: "Shows whether momentum is building (bars growing) or fading (bars shrinking) before a crossover happens.",
  },
  atr: {
    term: "ATR",
    what: "Average True Range: the average daily trading range over 14 sessions, gaps included.",
    why: "Measures how much the stock typically moves in a day. Used to size stops and positions.",
  },
  atr_pct: {
    term: "ATR %",
    what: "Average True Range as a percentage of the price.",
    why: "Makes daily volatility comparable across stocks at different price levels.",
  },
  hv: {
    term: "Historical volatility",
    what: "Annualised standard deviation of daily returns over the last 20 sessions.",
    why: "How volatile the stock has actually been. Compare it with implied volatility to see whether options look cheap or rich.",
  },
  iv: {
    term: "Implied volatility",
    what: "The future volatility that option prices imply, annualised (e.g. 30% ≈ a ±30% one-year range at one standard deviation).",
    why: "Higher IV means pricier options and a bigger expected move. It often rises into earnings.",
  },
  iv_rank: {
    term: "IV rank",
    what: "Where current implied volatility sits within its own 1-year range, from 0 (lowest) to 100 (highest).",
    why: "High IV rank favours selling premium and low IV rank favours buying it.",
  },
  rel_volume: {
    term: "Relative volume",
    what: "Today's volume divided by the average of recent sessions (1.0× = normal).",
    why: "Volume confirms moves. A breakout on 2× or more volume carries more conviction than one on light volume.",
  },
  volume: {
    term: "Volume",
    what: "Number of shares traded in the session.",
    why: "Shows participation. Price moves on heavy volume are more significant.",
  },
  vol_avg: {
    term: "Volume average",
    what: "Average daily volume of the 20 sessions before the current one.",
    why: "The baseline relative volume is measured against. Bars well above it stand out.",
  },
  drawdown: {
    term: "Max drawdown",
    what: "The largest peak-to-trough decline over the period, in percent.",
    why: "A measure of downside pain: how much a holder could have lost from a high.",
  },
  streak: {
    term: "Streak",
    what: "Consecutive sessions closing in the same direction (+ up, − down).",
    why: "Long streaks show persistent buying or selling. They often precede either continuation or a snap-back.",
  },
  window_high: {
    term: "Distance from high",
    what: "How far the price is below its highest high of the lookback window, in percent.",
    why: "Close to 0% means trading near highs, which is typical of strong trends and breakouts.",
  },
  return: {
    term: "Return",
    what: "Percent price change over the period.",
    why: "The raw size of the move, before any comparison with sector or market.",
  },
  pe: {
    term: "P/E",
    what: "Price-to-earnings: share price divided by the last 12 months' earnings per share.",
    why: "A valuation gauge. Higher means investors pay more per dollar of profit, usually expecting growth.",
  },
  pb: {
    term: "P/B",
    what: "Price-to-book: share price divided by book value (assets minus liabilities) per share.",
    why: "Most useful for asset-heavy businesses such as banks. Below 1 can signal value or trouble.",
  },
  beta: {
    term: "Beta",
    what: "How much the stock has moved relative to the overall market (1.0 = moves with it).",
    why: "Above 1 amplifies market swings and below 1 dampens them. Useful for position sizing.",
  },
  dividend_yield: {
    term: "Dividend yield",
    what: "Annual dividends per share as a percentage of the price.",
    why: "The income return on a holding. Watch ex-dividend dates if you hold short calls.",
  },
  market_cap: {
    term: "Market cap",
    what: "Share price × shares outstanding: the market value of the whole company.",
    why: "Sets the company's weight in cap-weighted indices and hints at liquidity and stability.",
  },
  week52: {
    term: "52-week range",
    what: "The lowest and highest prices of the past year, with today's price marked.",
    why: "Shows where the stock sits in its yearly range. Trading near the highs is often a sign of strength.",
  },
  analyst: {
    term: "Analyst ratings",
    what: "Count of buy / hold / sell ratings and the low, mean and high 12-month price targets.",
    why: "A consensus sentiment gauge. The gap between price and mean target shows implied upside.",
  },
  analyst_target: {
    term: "Analyst target range",
    what: "Low to high analyst 12-month price targets, with the mean marked, against the current price.",
    why: "Shows how much disagreement there is and where the price sits relative to expectations.",
  },
  dist_target: {
    term: "Distance from target",
    what: "How far the price is above (+) or below (−) the mean analyst target, in percent.",
    why: "A price well above the target means the expected upside is already priced in.",
  },
  trend: {
    term: "Trend",
    what: "The direction and strength of the price path, judged from moving averages and highs and lows.",
    why: "Trading with the trend tends to have better odds than fighting it.",
  },
  momentum: {
    term: "Momentum",
    what: "The speed of recent price changes, from RSI and MACD.",
    why: "Strong momentum tends to persist short-term. Fading momentum can warn of a turn before price does.",
  },
  volatility: {
    term: "Volatility",
    what: "How large the typical price swings are, from ATR, historical volatility and implied volatility.",
    why: "Sets position size, stop distance and how expensive options are.",
  },
  risk: {
    term: "Risk",
    what: "An overall read of downside exposure: distance to support, drawdown, valuation stretch and upcoming events.",
    why: "Weighs how much could go wrong for a holder right now, not just which direction is likely.",
  },
  breadth: {
    term: "Breadth",
    what: "The share of stocks that rose, or that sit above a moving average.",
    why: "Healthy advances are broad. A rising index on narrowing breadth is driven by a few large names.",
  },
  contribution: {
    term: "Contribution (bps)",
    what: "How many basis points (1 bp = 0.01%) a stock added to or took from the index move: its weight × its return.",
    why: "Separates the stocks that actually moved the market from big movers that are too small to matter.",
  },
  z_score: {
    term: "z-score",
    what: "Today's return measured in standard deviations of the stock's own last 20 daily returns.",
    why: "Above about 2.5 is an unusually large move for that stock, whatever its normal volatility.",
  },
  gap: {
    term: "Gap",
    what: "Percent difference between today's open and yesterday's close.",
    why: "Large gaps usually follow news. Whether they hold or fill during the day says a lot about conviction.",
  },
  rank_change: {
    term: "Rank change",
    what: "How many places a sector moved in the 5-day return ranking vs 5 sessions ago.",
    why: "Rising ranks show money rotating into a sector, and falling ranks show it rotating out.",
  },
  etf: {
    term: "Sector ETF",
    what: "The SPDR fund that tracks the sector.",
    why: "When the ETF and its members move differently, a few heavyweights are driving the ETF.",
  },
  // Options strategy ideas.
  pop: {
    term: "Probability of profit",
    what: "Chance the position ends above zero at the front expiry, under a lognormal price model.",
    why: "Shown under realized and implied volatility. The gap between the two is the premium seller's edge.",
  },
  ev: {
    term: "Expected P&L",
    what: "Average outcome at the front expiry under the price model, after natural fills and fees.",
    why: "Gate B: must be positive under realized volatility, or the trade has no edge however likely a win looks.",
  },
  ev_on_risk: {
    term: "Expected return on risk",
    what: "Expected P&L divided by max loss.",
    why: "How ideas are ranked: the edge per dollar put at risk.",
  },
  risk_reward: {
    term: "Risk : reward",
    what: "Max loss divided by max gain for one unit of the structure.",
    why: `Gate A: at most ${STRATEGY_RULES.maxRiskToReward} : 1, so a loser never costs more than ${STRATEGY_RULES.maxRiskToReward} winners.`,
  },
  max_loss: {
    term: "Max loss",
    what: "The worst outcome at expiry, read off the payoff at every strike, net of fees.",
    why: `Defined before entry. Gate C caps one unit at ${STRATEGY_RULES.maxAccountRiskFraction * 100}% of the account.`,
  },
  gap_test: {
    term: "Gap test",
    what: "P&L if the stock gaps by the larger of its biggest 20-session gap and one ATR, in the worse direction.",
    why: "A structure must survive a normal-sized shock without hitting max loss.",
  },
  natural_price: {
    term: "Natural price",
    what: "Buying at the ask and selling at the bid.",
    why: "The worst realistic fill. If a trade only works at mid, it does not show up.",
  },
  theta: {
    term: "Theta",
    what: "Change in the position's value per calendar day, other things equal.",
    why: "Positive theta is paid by time passing, the one force that is certain.",
  },
  breakeven: {
    term: "Breakeven",
    what: "Underlying price at the front expiry where the position neither makes nor loses money.",
    why: "Compare it with support and resistance: a breakeven beyond a level has a buffer.",
  },
  // Anomaly flags from the market scan.
  REL_VOL: {
    term: "Volume spike",
    what: "Volume at least 2.5× the average of the prior 20 sessions.",
    why: "Unusual participation, often institutional, and frequently tied to news.",
  },
  RET_Z: {
    term: "Outsized move",
    what: "A daily return of at least 2.5 standard deviations of the stock's own recent moves.",
    why: "A move far outside the stock's normal behaviour. Something changed.",
  },
  GAP: {
    term: "Gap",
    what: "Opened at least 3% away from the previous close.",
    why: "Usually news-driven. Watch whether the gap holds or fills.",
  },
  NEW_HIGH: {
    term: "New high",
    what: "Traded above its highest high of the lookback window.",
    why: "Breakouts to new highs have no overhead supply and often lead strong trends.",
  },
  NEW_LOW: {
    term: "New low",
    what: "Traded below its lowest low of the lookback window.",
    why: "Breakdowns to new lows show persistent selling. Avoid catching them without a reason.",
  },
  SECTOR_DIVERGENCE: {
    term: "Vs sector",
    what: "Moved far more than, or opposite to, the rest of its sector today.",
    why: "Stock-specific news rather than a sector move.",
  },
  QUIET_ACCUMULATION: {
    term: "Quiet accumulation",
    what: "Heavy volume (2× or more) while the price barely moved (under 0.5%).",
    why: "Can mean large buyers or sellers working orders without moving price. Often precedes a move.",
  },
  STREAK: {
    term: "Streak",
    what: "Five or more consecutive closes in the same direction.",
    why: "Persistent one-way pressure, either a strong trend or a stretched move due for a pause.",
  },
};

/**
 * Resolve a display key or a free-form metric name (as Claude writes them:
 * `sma50_cents`, `rsi14`, `dist_sma200_pct`, `atr14_pct`, `rel_volume`…) to an
 * entry. Unknown keys return null and get no bubble.
 */
export function lookupTerm(key: string | null | undefined): GlossaryEntry | null {
  if (!key) return null;
  if (ENTRIES[key]) return ENTRIES[key];
  const k = key
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/(_cents|_pct|_percent)$/, "");
  if (ENTRIES[k]) return ENTRIES[k];

  const num = (re: RegExp) => {
    const m = k.match(re);
    return m && m[1] ? Number(m[1]) : undefined;
  };
  if (/^dist(ance)?_?(from_)?sma/.test(k)) return G.distSma(num(/sma_?(\d+)/));
  if (/^(dist(ance)?_?(from_)?)?(window_)?high|^dist_high/.test(k)) return ENTRIES.window_high;
  if (/^dist(ance)?_?(from_)?target/.test(k)) return ENTRIES.dist_target;
  if (/^sma_?\d*$/.test(k)) return G.sma(num(/^sma_?(\d+)/));
  if (/^ema_?\d*$/.test(k)) return G.ema(num(/^ema_?(\d+)/));
  if (/^rsi_?\d*$/.test(k)) return G.rsi(num(/^rsi_?(\d+)/));
  if (/^macd_?(signal|sig)$/.test(k) || k === "signal") return ENTRIES.macd_signal;
  if (/^macd_?(hist|histogram)$/.test(k) || k === "hist" || k === "histogram") return ENTRIES.macd_hist;
  if (/^macd(_line)?$/.test(k)) return ENTRIES.macd;
  if (/^atr_?\d*$/.test(k)) return key.toLowerCase().includes("pct") ? ENTRIES.atr_pct : ENTRIES.atr;
  if (/^(hv|historical_vol)/.test(k)) return ENTRIES.hv;
  if (/^iv_?rank/.test(k)) return ENTRIES.iv_rank;
  if (/^(iv|implied_vol)/.test(k)) return ENTRIES.iv;
  if (/^rel(ative)?_?vol/.test(k)) return ENTRIES.rel_volume;
  if (/^(avg_)?vol(ume)?_?avg|^avg_vol/.test(k)) return ENTRIES.vol_avg;
  if (/drawdown/.test(k)) return ENTRIES.drawdown;
  if (/^streak/.test(k)) return ENTRIES.streak;
  if (/^ret(urn)?_?\d+d?$/.test(k)) return ENTRIES.return;
  if (/^(pe|p_e|pe_ratio)$/.test(k)) return ENTRIES.pe;
  if (/^(pb|p_b|pb_ratio)$/.test(k)) return ENTRIES.pb;
  if (/^z(_?score)?$|^return_z$/.test(k)) return ENTRIES.z_score;
  if (/^gap/.test(k)) return ENTRIES.gap;
  return null;
}
