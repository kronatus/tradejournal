import { CanonicalFill } from "../schemas";
import * as generic from "./generic";
import * as tastytrade from "./tastytrade";
import * as tos from "./tos";
import * as ibkr from "./ibkr";
import * as robinhood from "./robinhood";

export type BrokerType =
  | "tastytrade"
  | "tos"
  | "schwab"
  | "fidelity"
  | "ibkr"
  | "robinhood"
  | "generic";

export type ImportResult = {
  fills: CanonicalFill[];
  skipped: SkippedRow[];
};

export type SkippedRow = {
  rowIndex: number;
  reason: string;
};

export type Parser = (csvText: string) => ImportResult;

export const parsers: Record<BrokerType, Parser | undefined> = {
  tastytrade: tastytrade.parse,
  tos: tos.parse,
  schwab: undefined, // alias to generic
  fidelity: undefined, // alias to generic
  ibkr: ibkr.parse,
  robinhood: robinhood.parse,
  generic: generic.parse,
};

export function getParser(broker: BrokerType): Parser {
  const parser = parsers[broker];
  if (!parser) {
    // Fall back to generic for undefined brokers
    return generic.parse;
  }
  return parser;
}
