import { ImportResult } from "./index";

// Interactive Brokers CSV parser
export function parse(_csvText: string): ImportResult {
  return { fills: [], skipped: [] };
}
