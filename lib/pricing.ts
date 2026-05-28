const SQRT2PI = Math.sqrt(2 * Math.PI);

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT2PI;
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t *
    (0.319381530 +
      t *
        (-0.356563782 +
          t *
            (1.781477937 +
              t *
                (-1.821255978 + t * 1.330274429))));
  return 0.5 + sign * (0.5 - normPdf(z) * poly);
}

export interface BsmParams {
  S: number;
  K: number;
  r: number;
  T: number;
  sigma: number;
  type: "call" | "put";
}

function intrinsicValue(S: number, K: number, type: "call" | "put"): number {
  if (type === "call") {
    return Math.max(0, S - K);
  } else {
    return Math.max(0, K - S);
  }
}

export function bsmPrice(params: BsmParams): number {
  const { S, K, r, T, sigma, type } = params;

  if (T <= 0) {
    return intrinsicValue(S, K, type);
  }

  if (sigma <= 0) {
    return intrinsicValue(S, K, type);
  }

  const sqrtT = Math.sqrt(T);
  const d1 =
    (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const discountFactor = Math.exp(-r * T);

  if (type === "call") {
    return S * normCdf(d1) - K * discountFactor * normCdf(d2);
  } else {
    return K * discountFactor * normCdf(-d2) - S * normCdf(-d1);
  }
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export function bsmGreeks(params: BsmParams): Greeks {
  const { S, K, r, T, sigma, type } = params;

  if (T <= 0 || sigma <= 0) {
    let delta = 0;
    if (type === "call" && S > K) delta = 1;
    if (type === "put" && S < K) delta = -1;
    return { delta, gamma: 0, theta: 0, vega: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 =
    (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const discountFactor = Math.exp(-r * T);
  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);
  const Npd1 = normPdf(d1);

  let delta = 0;
  if (type === "call") {
    delta = Nd1;
  } else {
    delta = Nd1 - 1;
  }

  const gamma = Npd1 / (S * sigma * sqrtT);

  let theta = 0;
  if (type === "call") {
    theta =
      (-S * Npd1 * sigma) / (2 * sqrtT) - r * K * discountFactor * Nd2;
  } else {
    theta =
      (-S * Npd1 * sigma) / (2 * sqrtT) + r * K * discountFactor * normCdf(-d2);
  }
  theta = theta / 365;

  const vega = (S * Npd1 * sqrtT) / 100;

  return { delta, gamma, theta, vega };
}
