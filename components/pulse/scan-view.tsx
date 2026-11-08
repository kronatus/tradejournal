"use client";

import Link from "next/link";
import type { AnomalyFlag, AnomalyRow, ScanDigest } from "@/lib/market-scan";
import { formatPct } from "@/lib/research";
import { formatCents } from "@/lib/utils";
import { Card, signClass, Stat, ToneBadge } from "@/components/research/ui";
import { Term } from "@/components/ui/term";

const FLAG_LABEL: Record<AnomalyFlag, string> = {
  REL_VOL: "Volume spike",
  RET_Z: "Outsized move",
  GAP: "Gap",
  NEW_HIGH: "New high",
  NEW_LOW: "New low",
  SECTOR_DIVERGENCE: "Vs sector",
  QUIET_ACCUMULATION: "Quiet accumulation",
  STREAK: "Streak",
};
const FLAG_TONE: Record<AnomalyFlag, "gain" | "loss" | "warn" | "neutral"> = {
  REL_VOL: "warn",
  RET_Z: "warn",
  GAP: "warn",
  NEW_HIGH: "gain",
  NEW_LOW: "loss",
  SECTOR_DIVERGENCE: "neutral",
  QUIET_ACCUMULATION: "neutral",
  STREAK: "neutral",
};

const ratio = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}×`);

function Th({ children, right, term }: { children: React.ReactNode; right?: boolean; term?: string }) {
  return (
    <th data-term-row className={"px-3 py-2 font-medium " + (right ? "text-right" : "text-left")}>
      {term ? <Term k={term}>{children}</Term> : children}
    </th>
  );
}

function Td({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={"tabular px-3 py-2 " + (right ? "text-right " : "") + className}>{children}</td>;
}

function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

function SymbolLink({ symbol }: { symbol: string }) {
  return (
    <Link href={`/research?symbol=${encodeURIComponent(symbol)}`} className="font-medium hover:text-accent hover:underline">
      {symbol}
    </Link>
  );
}

export function ScanView({ digest }: { digest: ScanDigest }) {
  const b = digest.breadth;
  const total = b.advancers + b.decliners + b.unchanged || 1;
  return (
    <div className="space-y-5">
      <Card
        title="Breadth"
        action={
          <span className="text-xs text-text-subtle">
            {digest.meta.covered}/{digest.meta.universe_members} S&P 500 + Nasdaq-100 names ·{" "}
            {digest.weighting === "cap" ? "cap-weighted" : "equal-weighted"}
          </span>
        }
      >
        <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="bg-gain" style={{ width: `${(b.advancers / total) * 100}%` }} />
          <div className="bg-loss" style={{ width: `${(b.decliners / total) * 100}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Universe" value={formatPct(b.universe_ret_1d)} valueClass={signClass(b.universe_ret_1d)} sub={`EW ${formatPct(b.equal_weight_ret_1d)}`} />
          <Stat label="Advancers" term="breadth" value={b.advancers} valueClass="text-gain" />
          <Stat label="Decliners" value={b.decliners} valueClass="text-loss" />
          <Stat label="Above 20-day" term="sma20" value={b.pct_above_sma20 === null ? "—" : `${b.pct_above_sma20}%`} />
          <Stat label="Above 50-day" term="sma50" value={b.pct_above_sma50 === null ? "—" : `${b.pct_above_sma50}%`} />
          <Stat label="New highs" term="NEW_HIGH" value={b.new_highs} sub={`${digest.meta.high_low_window_days}-session window`} />
          <Stat label="New lows" term="NEW_LOW" value={b.new_lows} />
        </div>
        {digest.indices.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
            {digest.indices.map((i) => (
              <span key={i.symbol} className="tabular">
                <span className="font-medium">{i.symbol}</span>{" "}
                <span className="text-text-muted">{formatCents(i.close_cents)}</span>{" "}
                <span className={signClass(i.ret_1d)}>{formatPct(i.ret_1d)}</span>
                <span className="text-text-subtle"> · 5d {formatPct(i.ret_5d)} · 20d {formatPct(i.ret_20d)}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card title="Sector rotation" action={<span className="text-xs text-text-subtle">ranked by 5-day return</span>}>
        <Table
          head={
            <>
              <Th term="rank_change">#</Th>
              <Th>Sector</Th>
              <Th right>1d</Th>
              <Th right>5d</Th>
              <Th right>20d</Th>
              <Th right term="breadth">Breadth</Th>
              <Th right term="rel_volume">Rel vol</Th>
              <Th right term="etf">ETF 1d</Th>
            </>
          }
        >
          {digest.sectors.map((s) => (
            <tr key={s.sector}>
              <Td>
                <span className="inline-flex items-center gap-1">
                  {s.rank_5d}
                  {s.rank_change_5d ? (
                    <span className={"text-xs " + (s.rank_change_5d > 0 ? "text-gain" : "text-loss")}>
                      {s.rank_change_5d > 0 ? "▲" : "▼"}
                      {Math.abs(s.rank_change_5d)}
                    </span>
                  ) : null}
                </span>
              </Td>
              <Td className="font-medium">{s.sector}</Td>
              <Td right className={signClass(s.ret_1d)}>{formatPct(s.ret_1d)}</Td>
              <Td right className={signClass(s.ret_5d)}>{formatPct(s.ret_5d)}</Td>
              <Td right className={signClass(s.ret_20d)}>{formatPct(s.ret_20d)}</Td>
              <Td right>{s.breadth_pct}%</Td>
              <Td right className={(s.rel_volume ?? 0) >= 1.5 ? "text-warn" : ""}>{ratio(s.rel_volume)}</Td>
              <Td right className={signClass(s.etf?.ret_1d)}>
                {s.etf ? `${s.etf.symbol} ${formatPct(s.etf.ret_1d)}` : "—"}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <MoversCard title="Pushing the market up" rows={digest.movers.up} />
        <MoversCard title="Dragging the market down" rows={digest.movers.down} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <IndustryCard title="Leading industries (5d)" rows={digest.industries.leaders} />
        <IndustryCard title="Lagging industries (5d)" rows={digest.industries.laggards} />
      </div>

      <AnomaliesCard rows={digest.anomalies} />
    </div>
  );
}

function MoversCard({ title, rows }: { title: string; rows: ScanDigest["movers"]["up"] }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">None.</p>
      ) : (
        <Table head={<><Th>Symbol</Th><Th>Sector</Th><Th right>1d</Th><Th right term="contribution">Contribution</Th><Th right term="rel_volume">Rel vol</Th></>}>
          {rows.map((m) => (
            <tr key={m.symbol}>
              <Td><SymbolLink symbol={m.symbol} /></Td>
              <Td className="max-w-[10rem] truncate text-text-muted">{m.sector}</Td>
              <Td right className={signClass(m.ret_1d)}>{formatPct(m.ret_1d)}</Td>
              <Td right className={signClass(m.contribution_bps)}>{m.contribution_bps > 0 ? "+" : ""}{m.contribution_bps} bps</Td>
              <Td right>{ratio(m.rel_volume)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function IndustryCard({ title, rows }: { title: string; rows: ScanDigest["industries"]["leaders"] }) {
  return (
    <Card title={title}>
      <Table head={<><Th>Industry</Th><Th right>Names</Th><Th right>1d</Th><Th right>5d</Th><Th right term="rel_volume">Rel vol</Th></>}>
        {rows.map((r) => (
          <tr key={r.sub_industry}>
            <Td>
              <div className="font-medium">{r.sub_industry}</div>
              <div className="text-xs text-text-subtle">{r.sector}</div>
            </Td>
            <Td right>{r.members}</Td>
            <Td right className={signClass(r.ret_1d)}>{formatPct(r.ret_1d)}</Td>
            <Td right className={signClass(r.ret_5d)}>{formatPct(r.ret_5d)}</Td>
            <Td right>{ratio(r.rel_volume)}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function AnomaliesCard({ rows }: { rows: AnomalyRow[] }) {
  return (
    <Card title="Anomalies" action={<span className="text-xs text-text-subtle">top {rows.length} by score</span>}>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing unusual in this session.</p>
      ) : (
        <Table
          head={
            <>
              <Th>Symbol</Th>
              <Th>Signals</Th>
              <Th right>Close</Th>
              <Th right>1d</Th>
              <Th right>5d</Th>
              <Th right term="rel_volume">Rel vol</Th>
              <Th right term="z_score">z</Th>
              <Th right term="gap">Gap</Th>
            </>
          }
        >
          {rows.map((a) => (
            <tr key={a.symbol}>
              <Td>
                <SymbolLink symbol={a.symbol} />
                <div className="max-w-[12rem] truncate text-xs text-text-subtle">{a.sub_industry ?? a.sector}</div>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {a.flags.map((f) => (
                    <span key={f} data-term-row>
                      <ToneBadge tone={FLAG_TONE[f]}>
                        <Term k={f}>
                          {FLAG_LABEL[f]}
                          {f === "STREAK" ? ` ${a.streak > 0 ? "+" : ""}${a.streak}` : ""}
                        </Term>
                      </ToneBadge>
                    </span>
                  ))}
                </div>
              </Td>
              <Td right>{formatCents(a.close_cents)}</Td>
              <Td right className={signClass(a.ret_1d)}>{formatPct(a.ret_1d)}</Td>
              <Td right className={signClass(a.ret_5d)}>{formatPct(a.ret_5d)}</Td>
              <Td right>{ratio(a.rel_volume)}</Td>
              <Td right>{a.return_z?.toFixed(1) ?? "—"}</Td>
              <Td right>{formatPct(a.gap_pct, 1)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
