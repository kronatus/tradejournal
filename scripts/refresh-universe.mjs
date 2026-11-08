#!/usr/bin/env node
/**
 * Builds data/universe.json: the S&P 500 + Nasdaq-100 members the market scan
 * covers, with GICS sector / sub-industry, plus the index and sector ETFs.
 *
 *   node scripts/refresh-universe.mjs            # membership + GICS only
 *   node scripts/refresh-universe.mjs --shares   # also fill shares outstanding
 *
 * --shares needs MASSIVE_API_KEY (free Stocks Basic is enough). The free plan
 * allows 5 calls/minute, so a full run takes ~2 hours; it is resumable (symbols
 * that already have shares are skipped unless --force) and writes progress to
 * disk every 10 symbols. Re-run quarterly — index weights drift slowly.
 *
 * Until shares are filled the scan falls back to equal weighting and says so.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "data/universe.json");
const SP500_CSV =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const NDX_CSV =
  "https://raw.githubusercontent.com/Gary-Strauss/NASDAQ100_Constituents/master/data/nasdaq100_constituents.csv";

const GICS_SECTORS = new Set([
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
]);
// The Nasdaq-100 source mixes in ICB-style labels for some rows.
const SECTOR_ALIASES = {
  Technology: "Information Technology",
  Telecommunications: "Communication Services",
  "Basic Materials": "Materials",
};

// Benchmarks and sector proxies. `sector` on a sector ETF ties it to the GICS
// sector it tracks so the scan can compare the ETF with its members.
const ETFS = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF", role: "index" },
  { symbol: "QQQ", name: "Invesco QQQ (Nasdaq-100)", role: "index" },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", role: "index" },
  { symbol: "DIA", name: "SPDR Dow Jones Industrial Average ETF", role: "index" },
  { symbol: "XLC", name: "Communication Services Select Sector SPDR", role: "sector_etf", sector: "Communication Services" },
  { symbol: "XLY", name: "Consumer Discretionary Select Sector SPDR", role: "sector_etf", sector: "Consumer Discretionary" },
  { symbol: "XLP", name: "Consumer Staples Select Sector SPDR", role: "sector_etf", sector: "Consumer Staples" },
  { symbol: "XLE", name: "Energy Select Sector SPDR", role: "sector_etf", sector: "Energy" },
  { symbol: "XLF", name: "Financial Select Sector SPDR", role: "sector_etf", sector: "Financials" },
  { symbol: "XLV", name: "Health Care Select Sector SPDR", role: "sector_etf", sector: "Health Care" },
  { symbol: "XLI", name: "Industrial Select Sector SPDR", role: "sector_etf", sector: "Industrials" },
  { symbol: "XLK", name: "Technology Select Sector SPDR", role: "sector_etf", sector: "Information Technology" },
  { symbol: "XLB", name: "Materials Select Sector SPDR", role: "sector_etf", sector: "Materials" },
  { symbol: "XLRE", name: "Real Estate Select Sector SPDR", role: "sector_etf", sector: "Real Estate" },
  { symbol: "XLU", name: "Utilities Select Sector SPDR", role: "sector_etf", sector: "Utilities" },
];

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

function normSector(s) {
  const v = SECTOR_ALIASES[s] ?? s;
  return GICS_SECTORS.has(v) ? v : null;
}

async function buildMembership() {
  const [spText, ndxText] = await Promise.all([fetchText(SP500_CSV), fetchText(NDX_CSV)]);
  const bySymbol = new Map();

  for (const r of parseCsv(spText)) {
    const symbol = r.Symbol.toUpperCase();
    const sector = normSector(r["GICS Sector"]);
    if (!sector) throw new Error(`S&P row ${symbol}: unknown sector "${r["GICS Sector"]}"`);
    bySymbol.set(symbol, {
      symbol,
      name: r.Security,
      sector,
      sub_industry: r["GICS Sub-Industry"] || null,
      indexes: ["SPX"],
      role: "member",
    });
  }

  for (const r of parseCsv(ndxText)) {
    const symbol = r.Ticker.toUpperCase();
    const existing = bySymbol.get(symbol);
    if (existing) {
      existing.indexes.push("NDX");
      continue;
    }
    // This source's two GICS columns are swapped on some rows: whichever value
    // is one of the 11 sectors is the sector, the other the sub-industry.
    const a = r.GICS_Sector;
    const b = r.GICS_Sub_Industry;
    const sector = normSector(a) ?? normSector(b);
    if (!sector) throw new Error(`NDX row ${symbol}: no GICS sector in "${a}" / "${b}"`);
    const sub = normSector(a) ? b : a;
    bySymbol.set(symbol, {
      symbol,
      name: r.Company,
      sector,
      sub_industry: sub || null,
      indexes: ["NDX"],
      role: "member",
    });
  }

  for (const etf of ETFS) {
    bySymbol.set(etf.symbol, {
      symbol: etf.symbol,
      name: etf.name,
      sector: etf.sector ?? null,
      sub_industry: null,
      indexes: [],
      role: etf.role,
    });
  }
  return bySymbol;
}

async function fillShares(entries, { force }) {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("--shares needs MASSIVE_API_KEY in the environment");
  const members = entries.filter((e) => e.role === "member" && (force || e.shares_outstanding == null));
  console.log(`Filling shares for ${members.length} symbols (~${Math.ceil(members.length / 5)} min at 5/min)`);
  let done = 0;
  for (const e of members) {
    const url = `https://api.massive.com/v3/reference/tickers/${encodeURIComponent(e.symbol)}?apiKey=${key}`;
    const res = await fetch(url);
    if (res.status === 429) {
      console.log("429 — waiting 60s");
      await new Promise((r) => setTimeout(r, 60_000));
      members.push(e); // retry later
      continue;
    }
    if (res.ok) {
      const body = await res.json();
      const r = body.results ?? {};
      const shares = r.weighted_shares_outstanding ?? r.share_class_shares_outstanding ?? null;
      e.shares_outstanding = typeof shares === "number" && shares > 0 ? Math.round(shares) : null;
      e.shares_as_of = new Date().toISOString().slice(0, 10);
    } else {
      console.warn(`${e.symbol}: HTTP ${res.status}`);
    }
    done++;
    if (done % 10 === 0) {
      await write(entries);
      console.log(`${done}/${members.length}`);
    }
    await new Promise((r) => setTimeout(r, 12_500)); // 5 calls/minute
  }
}

async function write(entries) {
  const sorted = [...entries].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const doc = {
    generated_at: new Date().toISOString(),
    sources: { sp500: SP500_CSV, ndx: NDX_CSV, shares: "massive /v3/reference/tickers" },
    count: sorted.length,
    entries: sorted,
  };
  await writeFile(OUT, JSON.stringify(doc, null, 1) + "\n");
}

const args = new Set(process.argv.slice(2));
const membership = await buildMembership();

// Carry existing share counts forward so a membership refresh never loses them.
if (existsSync(OUT)) {
  const prev = JSON.parse(await readFile(OUT, "utf8"));
  for (const p of prev.entries ?? []) {
    const cur = membership.get(p.symbol);
    if (cur && p.shares_outstanding != null) {
      cur.shares_outstanding = p.shares_outstanding;
      cur.shares_as_of = p.shares_as_of ?? null;
    }
  }
}
const entries = [...membership.values()].map((e) => ({
  shares_outstanding: null,
  shares_as_of: null,
  ...e,
}));

if (args.has("--shares")) await fillShares(entries, { force: args.has("--force") });
await write(entries);
const members = entries.filter((e) => e.role === "member");
console.log(
  `Wrote ${OUT}: ${members.length} members (${members.filter((e) => e.indexes.includes("SPX")).length} SPX, ` +
    `${members.filter((e) => e.indexes.includes("NDX")).length} NDX), ` +
    `${members.filter((e) => e.shares_outstanding != null).length} with shares`
);
