import { Leg } from "./types";

export type Greeks = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

// Compute net Greeks for a strategy across all legs
export function strategyNetGreeks(
  legs: Leg[],
  source: "entry" | "exit" | "live"
): Greeks {
  let delta = 0,
    gamma = 0,
    theta = 0,
    vega = 0;

  for (const leg of legs) {
    let legDelta = 0,
      legGamma = 0,
      legTheta = 0,
      legVega = 0;

    if (source === "entry") {
      legDelta = leg.entry_delta || 0;
      legGamma = leg.entry_gamma || 0;
      legTheta = leg.entry_theta || 0;
      legVega = leg.entry_vega || 0;
    } else if (source === "exit") {
      legDelta = leg.exit_delta || 0;
      legGamma = leg.exit_gamma || 0;
      legTheta = leg.exit_theta || 0;
      legVega = leg.exit_vega || 0;
    }
    // live greeks passed separately, handled by caller

    const sideMultiplier = leg.side === "long" ? 1 : -1;
    const qtyMultiplier = leg.qty * 100; // contracts → shares

    delta += legDelta * sideMultiplier * qtyMultiplier;
    gamma += legGamma * sideMultiplier * qtyMultiplier;
    theta += legTheta * sideMultiplier * qtyMultiplier;
    vega += legVega * sideMultiplier * qtyMultiplier;
  }

  return { delta, gamma, theta, vega };
}
