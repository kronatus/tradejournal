import { CanonicalFill } from "../schemas";

export type ProposedStrategy = {
  id: string;
  underlying: string;
  externalGroupRef: string | null;
  openLegs: CanonicalFill[];
  closeLegs: CanonicalFill[];
};

// Group fills into strategies by external_group_ref, then match opens to closes
export function groupFillsIntoStrategies(fills: CanonicalFill[]): ProposedStrategy[] {
  const grouped = new Map<string | null, CanonicalFill[]>();

  // Group by external_group_ref
  for (const fill of fills) {
    const key = fill.external_group_ref || `solo_${fills.indexOf(fill)}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(fill);
  }

  // For each group, split opens and closes
  const strategies: ProposedStrategy[] = [];
  let strategyId = 0;

  for (const [groupRef, groupFills] of grouped.entries()) {
    const underlying = groupFills[0]!.underlying;
    const opens = groupFills.filter((f) => f.action === "open");
    const closes = groupFills.filter((f) => f.action === "close");

    const isSoloRef = groupRef === null || groupRef.startsWith("solo_");
    strategies.push({
      id: `proposed_${strategyId++}`,
      underlying,
      externalGroupRef: isSoloRef ? null : groupRef,
      openLegs: opens,
      closeLegs: closes,
    });
  }

  return strategies;
}
