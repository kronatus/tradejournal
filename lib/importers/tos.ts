import { ImportResult } from "./index";

// ThinkorSwim CSV parser
export function parse(_csvText: string): ImportResult {
  return { fills: [], skipped: [] };
}
