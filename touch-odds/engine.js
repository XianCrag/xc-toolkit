/**
 * Hitting probability for a barrier at k annualized σ under GBM / Wiener
 * (reflection principle, drift ≈ 0):
 *   P(touch within T years) = 2 · (1 − Φ(k / √T))
 */

export function erf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF Φ(x) */
export function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Probability that price touches a level |k| annualized σ away within T years.
 * @param {number} kSigma - barrier distance in annualized σ (k ≥ 0)
 * @param {number} years - horizon T in years (T > 0)
 */
export function touchProbability(kSigma, years) {
  const k = Math.max(0, Number(kSigma));
  const T = Number(years);
  if (!(T > 0) || !Number.isFinite(k)) return NaN;
  if (k === 0) return 1;
  return 2 * (1 - normalCdf(k / Math.sqrt(T)));
}

export function formatPct(p, digits = 1) {
  if (!Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export const REFERENCE_ROWS = [
  { k: 0.25, label: "微幅波动" },
  { k: 0.5, label: "中幅波动" },
  { k: 0.75, label: "较高目标" },
  { k: 1, label: "1个年化标准差" },
  { k: 1.5, label: "激进目标" },
  { k: 2, label: "极端大年" },
];

/** Touch horizons shown in cards / table / charts (T in years). */
export const HORIZONS = [
  { id: "1m", years: 1 / 12, label: "1m", tLabel: "T = 1/12", color: "#a78bfa" },
  { id: "3m", years: 0.25, label: "3m", tLabel: "T = 0.25", color: "#c97b3a" },
  { id: "6m", years: 0.5, label: "6m", tLabel: "T = 0.5", color: "#3d8bfd" },
  { id: "1y", years: 1, label: "1y", tLabel: "T = 1.0", color: "#3dd68c" },
];

/**
 * Directional heuristic: how realized touch rate often sits vs this Gaussian curve.
 * Not a calibrated correction — only which bias tends to dominate at this k.
 * @returns {{ lean: 'over'|'under'|'mixed', label: string, detail: string }}
 */
export function biasHint(kSigma) {
  const k = Math.max(0, Number(kSigma));
  if (!Number.isFinite(k)) {
    return { lean: "mixed", label: "—", detail: "" };
  }
  if (k < 0.75) {
    return {
      lean: "over",
      label: "曲线多偏高（高估触及率）",
      detail:
        "近目标：IV 溢价通常压过 fat tail。尤其 6m–1y，实现触及率往往低于曲线；1m 仍可能被跳空拉高一点。",
    };
  }
  if (k > 1.25) {
    return {
      lean: "under",
      label: "曲线多偏低（低估触及率）",
      detail:
        "远目标：fat tail / 跳空更关键。尤其 1m–3m（下行更明显），实现触及率往往高于曲线；用 ATM IV 当尺子时更易低估翼部。",
    };
  }
  return {
    lean: "mixed",
    label: "两偏接近，净方向不定",
    detail:
      "约 1σ 附近 IV 溢价与 fat tail 常互相抵消，净高/低估看标的、方向与用的是 ATM 还是对应 strike 的 IV。勿把曲线当精确预测。",
  };
}

/**
 * PDF of first hitting time τ for barrier at k annualized σ (drift 0):
 *   f(t) = k / √(2π t³) · exp(−k² / (2t)),  t > 0
 */
export function firstHitDensity(kSigma, years) {
  const k = Math.max(0, Number(kSigma));
  const t = Number(years);
  if (!(t > 0) || !Number.isFinite(k) || k === 0) return 0;
  const invSqrt = 1 / Math.sqrt(2 * Math.PI * t * t * t);
  return k * invSqrt * Math.exp(-(k * k) / (2 * t));
}

/** Dense samples for the probability curves (k from 0 → maxK). */
export function buildCurve(maxK = 2.5, steps = 100) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const k = (maxK * i) / steps;
    const probs = {};
    for (const h of HORIZONS) {
      probs[h.id] = touchProbability(k, h.years);
    }
    points.push({ k, ...probs });
  }
  return points;
}

/**
 * Yearly trigger count for a one-directional kσ ladder.
 *
 * Strategy: place an order kσ from price; once filled, reset the reference to
 * the fill price and place the next order another kσ away (same multiple, no
 * custom band). The n-th fill happens exactly when the running extreme first
 * reaches n·kσ, so by continuity of driftless BM the events nest:
 *   P(N ≥ n) = P(touch n·kσ within T) = touchProbability(n·k, T)
 * This is exact under the page's driftless-BM assumption (no simulation).
 *
 * @param {number} kSigma - ladder step in annualized σ (k > 0)
 * @param {number} years  - horizon T in years (default 1 → per year)
 * @param {number} n      - number of triggers (n ≥ 0)
 * @returns {number} P(N = n)
 */
export function triggerCountProbability(kSigma, years = 1, n) {
  const k = Math.max(0, Number(kSigma));
  if (!Number.isInteger(n) || n < 0 || !(k > 0)) return NaN;
  const atLeast = (m) => (m <= 0 ? 1 : touchProbability(m * k, years));
  return atLeast(n) - atLeast(n + 1);
}

/**
 * Expected number of ladder triggers over the horizon (default per year).
 * E[N] = Σ_{n≥1} P(N ≥ n) = Σ_{n≥1} touchProbability(n·k, T).
 * @param {number} kSigma - ladder step in annualized σ (k > 0)
 * @param {number} years  - horizon T in years (default 1)
 */
export function expectedTriggers(kSigma, years = 1) {
  const k = Math.max(0, Number(kSigma));
  if (!(k > 0) || !(years > 0)) return NaN;
  let sum = 0;
  for (let n = 1; n <= 10000; n++) {
    const term = touchProbability(n * k, years);
    sum += term;
    if (term < 1e-7) break;
  }
  return sum;
}

/**
 * Discrete count distribution P(N = n) for n = 0..maxN (+ an overflow tail),
 * for the kσ ladder over the horizon. Returned bars sum to 1.
 * @param {number} kSigma - ladder step in annualized σ (k > 0)
 * @param {number} years  - horizon T in years (default 1)
 * @param {number} maxN   - highest explicit count bucket
 */
export function buildTriggerDistribution(kSigma, years = 1, maxN = 12) {
  const k = Math.max(0, Number(kSigma));
  const bars = [];
  if (!(k > 0) || !(years > 0)) return bars;
  let cumulative = 0;
  for (let n = 0; n <= maxN; n++) {
    const p = Math.max(0, triggerCountProbability(k, years, n));
    cumulative += p;
    bars.push({ n, p });
  }
  // Fold the remaining probability mass into a final "maxN+ " bucket.
  const tail = Math.max(0, 1 - cumulative);
  bars.push({ n: maxN + 1, p: tail, overflow: true });
  return bars;
}

/**
 * Time-path distribution for a fixed target k:
 * density f(t) and cumulative P(τ ≤ t) from ~0 to maxYears.
 */
export function buildHitTimeCurve(kSigma, maxYears = 2, steps = 160) {
  const k = Math.max(0, Number(kSigma));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = (maxYears * i) / steps;
    points.push({
      t,
      density: firstHitDensity(k, t),
      cdf: touchProbability(k, t),
    });
  }
  return points;
}
