import universeJson from "@/data/universe.json";

/**
 * The scan universe: S&P 500 + Nasdaq-100 members plus benchmark and sector
 * ETFs. Built by scripts/refresh-universe.mjs; see that file for sources.
 */
export type UniverseRole = "member" | "index" | "sector_etf";

export type UniverseEntry = {
  symbol: string;
  name: string;
  /** GICS sector. For a sector ETF, the sector it tracks; null for index ETFs. */
  sector: string | null;
  sub_industry: string | null;
  indexes: string[];
  role: UniverseRole;
  shares_outstanding: number | null;
  shares_as_of: string | null;
};

type UniverseFile = { generated_at: string; count: number; entries: UniverseEntry[] };

const file = universeJson as UniverseFile;

export const UNIVERSE: readonly UniverseEntry[] = file.entries;
export const UNIVERSE_GENERATED_AT = file.generated_at;

const bySymbol = new Map(UNIVERSE.map((e) => [e.symbol, e]));

export function universeEntry(symbol: string): UniverseEntry | undefined {
  return bySymbol.get(symbol);
}

export function universeSymbols(): string[] {
  return UNIVERSE.map((e) => e.symbol);
}
