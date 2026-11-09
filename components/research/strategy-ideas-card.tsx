"use client";

import { useState } from "react";
import Link from "next/link";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { formatCents, formatDateTime } from "@/lib/utils";
import { PROMPTS } from "@/lib/research";
import { describeLeg, sandboxHref, setStaleness, tradeHref } from "@/lib/strategy-ideas";
import { STRATEGY_RULES } from "@/lib/strategy-rules";
import type { StrategyIdea, StrategySet } from "@/lib/types";
import { Card, PromptHandoff, Stat, ToneBadge } from "./ui";
import { Term } from "@/components/ui/term";

const FLAG_TEXT: Record<string, string> = {
  wide_market: "Wide bid/ask",
  thin_open_interest: "Thin open interest",
  no_realized_vol: "No realized vol",
  gap_untested: "Gap not tested",
};

const pct = (v: number | null | undefined, dp = 1) => (v == null ? "—" : `${v.toFixed(dp)}%`);

/**
 * The Options strategies section of a ticker report: the latest set saved by
 * the options-strategist skill. Every number here was computed server-side
 * from quotes (lib/strategy-economics.ts); nothing is model-written.
 */
export function StrategyIdeasCard({
  symbol,
  set,
  spotCents,
  now,
}: {
  symbol: string;
  set: StrategySet | null;
  /** Live spot when available (drift check), else null. */
  spotCents: number | null;
  now: number;
}) {
  if (!set) {
    return (
      <Card title="Options strategies">
        <div className="space-y-3">
          <p className="text-sm text-text-muted">No strategy ideas for {symbol} yet.</p>
          <PromptHandoff prompt={PROMPTS.strategies(symbol)} hint="Ask Claude:" />
        </div>
      </Card>
    );
  }

  const staleness = setStaleness(set, now, spotCents);
  const summary = set.rejected_summary;

  return (
    <Card
      title="Options strategies"
      action={
        <span className="text-xs text-text-subtle">
          Priced off {formatCents(set.reference_price_cents)} at {formatDateTime(set.reference_at)}
        </span>
      }
    >
      <div className="space-y-4">
        {staleness.stale && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
            <span>
              <strong>Stale</strong>: {staleness.reasons.join("; ")}. Re-run before trading.
            </span>
            <PromptHandoff prompt={PROMPTS.strategies(symbol)} />
          </div>
        )}

        {set.ideas.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm">
            <div className="font-medium">No compliant setup</div>
            <p className="mt-1 text-text-muted">{set.no_setup_reason}</p>
          </div>
        ) : (
          set.ideas.map((idea) => (
            <IdeaView key={idea.rank} idea={idea} set={set} symbol={symbol} />
          ))
        )}

        <p className="text-xs text-text-subtle">
          {summary?.evaluated ? `${summary.evaluated} structures evaluated, ${summary.passed} cleared the gate. ` : ""}
          Gate: <Term k="risk_reward">risk ≤ {STRATEGY_RULES.maxRiskToReward}× reward</Term>,{" "}
          <Term k="ev">positive expectancy</Term> under realized vol at <Term k="natural_price">natural prices</Term>,{" "}
          <Term k="max_loss">max loss ≤ {STRATEGY_RULES.maxAccountRiskFraction * 100}% of account</Term> (
          {formatCents(set.account_value_cents)}), <Term k="gap_test">survives a gap</Term>.
          {set.model_notes ? ` ${set.model_notes}` : ""}
        </p>
      </div>
    </Card>
  );
}

function IdeaView({ idea, set, symbol }: { idea: StrategyIdea; set: StrategySet; symbol: string }) {
  const e = idea.economics;
  const units = idea.sizing?.qty ?? 1;
  const flags = [...idea.liquidity.flags, ...idea.flags].map((f) => FLAG_TEXT[f] ?? f.replace(/_/g, " "));
  if (e.model_based) flags.unshift("Model-valued back month");

  return (
    <article className="rounded-md border border-border p-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-text-subtle">#{idea.rank}</span>
        <h3 className="text-sm font-semibold">{idea.name ?? idea.label}</h3>
        <ToneBadge tone="neutral">
          {idea.horizon === "short" ? "0–3 DTE" : "4–21 DTE"} · {idea.dte}d
        </ToneBadge>
        <ToneBadge tone={e.credit ? "gain" : "warn"}>{e.credit ? "Credit" : "Debit"}</ToneBadge>
        {flags.map((f) => (
          <ToneBadge key={f} tone="warn">
            {f}
          </ToneBadge>
        ))}
      </header>

      <ul className="tabular mt-2 space-y-0.5 text-xs text-text-muted">
        {idea.legs.map((l, i) => (
          <li key={i}>{describeLeg(l, units)}</li>
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label={e.credit ? "Net credit" : "Net debit"} term="natural_price" value={formatCents(Math.abs(e.net_cents))} sub="per share" />
        <Stat
          label="Max gain"
          value={e.max_gain_cents === null ? "Unlimited" : formatCents(e.max_gain_cents * units)}
          sub={`${formatCents(e.max_gain_cents)} per unit`}
          valueClass="text-gain"
        />
        <Stat label="Max loss" term="max_loss" value={formatCents(e.max_loss_cents * units)} sub={`${formatCents(e.max_loss_cents)} per unit`} valueClass="text-loss" />
        <Stat label="Risk : reward" term="risk_reward" value={e.risk_reward === null ? "—" : `${e.risk_reward.toFixed(2)} : 1`} />
        <Stat label="Prob. of profit" term="pop" value={pct(e.pop_realized)} sub={`${pct(e.pop_implied)} at implied vol`} />
        <Stat
          label="Expected P&L"
          term="ev"
          value={formatCents(e.ev_realized_cents === null ? null : e.ev_realized_cents * units)}
          sub={`${formatCents(e.ev_implied_cents === null ? null : e.ev_implied_cents * units)} at implied vol`}
          valueClass={(e.ev_realized_cents ?? 0) > 0 ? "text-gain" : "text-loss"}
        />
        <Stat label="Return on risk" term="ev_on_risk" value={pct(e.ev_on_risk_pct)} />
        <Stat
          label="Theta / day"
          term="theta"
          value={formatCents(e.theta_cents_per_day === null ? null : e.theta_cents_per_day * units)}
          valueClass={(e.theta_cents_per_day ?? 0) >= 0 ? "text-gain" : "text-loss"}
        />
        <Stat
          label="Size"
          value={idea.sizing ? `${idea.sizing.qty} unit${idea.sizing.qty === 1 ? "" : "s"}` : "—"}
          sub={idea.sizing ? `${formatCents(idea.sizing.capital_at_risk_cents)} at risk · ${idea.sizing.pct_of_account}% of account` : undefined}
        />
        <Stat label="Breakevens" term="breakeven" value={e.breakevens_cents.map(formatCents).join(" · ") || "—"} />
        <Stat
          label="Gap test"
          term="gap_test"
          value={e.gap ? (e.gap.survives ? "Survives" : "Fails") : "Not tested"}
          sub={e.gap ? `±${formatCents(e.gap.size_cents)} → ${formatCents(e.gap.worst_pnl_cents * units)}` : undefined}
        />
        <Stat label="Widest market" value={pct(idea.liquidity.max_spread_pct)} sub="bid/ask as % of mid" />
      </div>

      <PayoffMini idea={idea} units={units} reference={set.reference_price_cents} />

      <div className="mt-3 space-y-2 text-sm">
        <p>{idea.rationale}</p>
        {idea.catalysts.length > 0 && (
          <p className="text-xs">
            <span className="font-medium text-text-muted">Catalysts: </span>
            {idea.catalysts.join(" · ")}
          </p>
        )}
        {idea.risks.length > 0 && (
          <p className="text-xs">
            <span className="font-medium text-text-muted">Risks: </span>
            {idea.risks.join(" · ")}
          </p>
        )}
        {idea.exit_plan && (
          <p className="text-xs">
            <span className="font-medium text-text-muted">Exit: </span>
            {idea.exit_plan}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={tradeHref(set.id, idea.rank)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          Log as trade
        </Link>
        <Link
          href={sandboxHref(idea, symbol, set.reference_price_cents)}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:border-border-strong hover:text-text"
        >
          Open in Sandbox
        </Link>
      </div>
    </article>
  );
}

/**
 * P&L at the front expiry across underlying prices, for the sized position.
 * Values go in the readout strip above the chart — never a tooltip over data.
 */
function PayoffMini({ idea, units, reference }: { idea: StrategyIdea; units: number; reference: number }) {
  const data = idea.payoff.map(([price, pnl]) => ({ price: price / 100, pnl: (pnl * units) / 100 }));
  const [hover, setHover] = useState<{ price: number; pnl: number } | null>(null);
  if (data.length < 2) return null;
  const shown = hover ?? { price: reference / 100, pnl: nearestPnl(data, reference / 100) };

  return (
    <div className="mt-3">
      <div className="tabular flex flex-wrap gap-x-4 text-xs text-text-muted">
        <span>
          At expiry, underlying <span className="text-text">${shown.price.toFixed(2)}</span>
        </span>
        <span>
          P&L{" "}
          <span className={shown.pnl >= 0 ? "text-gain" : "text-loss"}>
            {shown.pnl >= 0 ? "+" : ""}
            {signedDollars(shown.pnl)}
          </span>
        </span>
        {!hover && <span className="text-text-subtle">(at the reference price; hover to explore)</span>}
      </div>
      <div className="mt-1 h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            onMouseMove={(s) => {
              const p = s?.activePayload?.[0]?.payload as { price: number; pnl: number } | undefined;
              if (p) setHover(p);
            }}
            onMouseLeave={() => setHover(null)}
          >
            <XAxis
              dataKey="price"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              stroke="var(--color-text-subtle)"
            />
            <YAxis
              width={56}
              tick={{ fontSize: 10 }}
              tickFormatter={signedDollars}
              stroke="var(--color-text-subtle)"
            />
            <ReferenceLine y={0} stroke="var(--color-border-strong)" />
            <ReferenceLine x={reference / 100} stroke="var(--color-accent)" strokeDasharray="3 3" />
            {hover && <ReferenceLine x={hover.price} stroke="var(--color-text-subtle)" />}
            <Line type="linear" dataKey="pnl" dot={false} strokeWidth={1.5} stroke="var(--color-text)" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function signedDollars(v: number): string {
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function nearestPnl(data: { price: number; pnl: number }[], price: number): number {
  let best = data[0];
  for (const d of data) if (Math.abs(d.price - price) < Math.abs(best.price - price)) best = d;
  return best.pnl;
}
