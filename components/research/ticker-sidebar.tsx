"use client";

import { useState } from "react";
import {
  GROUPINGS,
  groupTickers,
  normalizeSymbol,
  reportFreshness,
  UNSORTED,
  type Freshness,
  type TickerGroup,
} from "@/lib/research";
import type { TickerWithStatus } from "@/lib/research-store";

const DOT: Record<Freshness, string> = {
  fresh: "bg-gain",
  aging: "bg-warn",
  stale: "bg-loss",
  none: "bg-border-strong",
};
const DOT_LABEL: Record<Freshness, string> = {
  fresh: "Analysed within a day",
  aging: "Analysed 1–4 days ago",
  stale: "Analysis older than 4 days",
  none: "Not analysed yet",
};

type Props = {
  tickers: TickerWithStatus[];
  selected: string | null;
  grouping: string;
  now: number;
  onGroupingChange: (g: string) => void;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => Promise<string | null>;
  onRemove: (symbol: string) => Promise<void>;
};

export function TickerSidebar(props: Props) {
  const { tickers, grouping, onGroupingChange } = props;
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const levels = (GROUPINGS[grouping] ?? GROUPINGS.sector_industry).levels;
  const tree = groupTickers(tickers, levels);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const symbol = normalizeSymbol(input);
    if (!symbol) {
      setError("Enter a valid ticker, e.g. AAPL or BRK.B");
      return;
    }
    setBusy(true);
    const err = await props.onAdd(symbol);
    setBusy(false);
    setError(err);
    if (!err) setInput("");
  };

  return (
    <aside className="space-y-3">
      <form onSubmit={submit} className="space-y-1.5">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            placeholder="Add ticker"
            aria-label="Add ticker"
            maxLength={10}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm uppercase placeholder:normal-case placeholder:text-text-subtle"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error && <p className="text-xs text-loss">{error}</p>}
      </form>

      <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
        Group by
        <select
          value={grouping}
          onChange={(e) => onGroupingChange(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
        >
          {Object.entries(GROUPINGS).map(([key, g]) => (
            <option key={key} value={key}>
              {g.label}
            </option>
          ))}
        </select>
      </label>

      {tickers.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
          No tickers yet. Add one above, or ask Claude to run a market sweep and add its picks.
        </p>
      ) : (
        <nav aria-label="Research tickers" className="space-y-1">
          {tree.map((g) => (
            <GroupNode key={g.path.join("/")} group={g} depth={0} {...props} />
          ))}
        </nav>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-text-subtle">
        {(["fresh", "aging", "stale", "none"] as Freshness[]).map((f) => (
          <span key={f} className="inline-flex items-center gap-1" title={DOT_LABEL[f]}>
            <span className={"h-1.5 w-1.5 rounded-full " + DOT[f]} />
            {f === "none" ? "new" : f}
          </span>
        ))}
      </div>
    </aside>
  );
}

function GroupNode({
  group,
  depth,
  ...props
}: { group: TickerGroup<TickerWithStatus>; depth: number } & Props) {
  // "Unsorted › Unsorted" adds nothing: show the inner group's tickers directly.
  const lone = group.children.length === 1 && group.children[0].label === UNSORTED ? group.children[0] : null;
  const children = lone ? lone.children : group.children;
  const items = lone ? lone.items : group.items;
  return (
    <details open className="group/node">
      <summary
        className={
          "flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1 text-left hover:bg-muted " +
          (depth === 0
            ? "text-xs font-semibold uppercase tracking-wide text-text-muted"
            : "text-xs font-medium text-text-muted")
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3 w-3 shrink-0 transition-transform group-open/node:rotate-90"
            aria-hidden
          >
            <path d="M7 5l6 5-6 5V5z" />
          </svg>
          <span className="truncate">{group.label}</span>
        </span>
        <span className="tabular text-text-subtle">{group.count}</span>
      </summary>
      <div className={depth === 0 ? "ml-2 border-l border-border pl-1.5" : "ml-3 pl-1"}>
        {children.map((c) => (
          <GroupNode key={c.path.join("/")} group={c} depth={depth + 1} {...props} />
        ))}
        {items.map((t) => (
          <TickerRow key={t.symbol} ticker={t} {...props} />
        ))}
      </div>
    </details>
  );
}

function TickerRow({ ticker, selected, onSelect, onRemove, now }: { ticker: TickerWithStatus } & Props) {
  const f = reportFreshness(ticker.latest_report_at, now);
  const active = selected === ticker.symbol;
  return (
    <div
      className={
        "group/row flex items-center justify-between rounded-md px-2 py-1 text-sm " +
        (active ? "bg-accent-soft text-accent" : "hover:bg-muted")
      }
    >
      <button
        type="button"
        onClick={() => onSelect(ticker.symbol)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-current={active ? "page" : undefined}
      >
        <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + DOT[f]} title={DOT_LABEL[f]} />
        <span className="font-medium">{ticker.symbol}</span>
        {ticker.added_by === "claude" && (
          <span className="text-[10px] uppercase tracking-wide text-text-subtle">AI</span>
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm(`Remove ${ticker.symbol} from your research list?`)) void onRemove(ticker.symbol);
        }}
        className="ml-1 rounded px-1 text-text-subtle opacity-0 transition-opacity hover:text-loss focus:opacity-100 group-hover/row:opacity-100"
        aria-label={`Remove ${ticker.symbol}`}
      >
        ×
      </button>
    </div>
  );
}
