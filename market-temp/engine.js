/**
 * Howard Marks — The Poor Man's Guide to Market Assessment
 * Source: "It Is What It Is" (2006) / The Most Important Thing / Mastering the Market Cycle
 *
 * For each bipolar pair, mark which pole better describes today (with degree).
 * Left ≈ greed / loose credit / high prices → market top → hold your wallet.
 * Right ≈ fear / tight credit / low prices → market bottom → be aggressive.
 *
 * Marks lists several pairs under one heading (Investors, Funds, …).
 * Here each pair is its own row with a unique ask, so the form is readable.
 *
 * Scale: continuous −2…+2 (left hot → right cold). Temperature ∈ [−100, +100].
 */

/** @typedef {number | null} Degree */

export const DEGREE_MIN = -2;
export const DEGREE_MAX = 2;
/** Fine step for smooth dragging (not 5 discrete notches). */
export const DEGREE_STEP = 0.01;

/**
 * @typedef {{
 *   id: string,
 *   group: string,
 *   ask: string,
 *   left: string,
 *   right: string,
 * }} Factor
 */

/** @type {Factor[]} */
export const FACTORS = [
  // Macro & credit conditions
  { id: "economy", group: "Macro & Credit", ask: "Economy", left: "Vibrant", right: "Sluggish" },
  { id: "outlook", group: "Macro & Credit", ask: "Outlook", left: "Positive", right: "Negative" },
  { id: "lenders", group: "Macro & Credit", ask: "Lenders", left: "Eager", right: "Reticent" },
  { id: "capital-markets", group: "Macro & Credit", ask: "Capital markets", left: "Loose", right: "Tight" },
  { id: "capital", group: "Macro & Credit", ask: "Capital supply", left: "Plentiful", right: "Scarce" },
  { id: "terms", group: "Macro & Credit", ask: "Lending terms", left: "Easy", right: "Restrictive" },
  { id: "rates", group: "Macro & Credit", ask: "Interest rates", left: "Low", right: "High" },
  { id: "spreads", group: "Macro & Credit", ask: "Credit spreads", left: "Narrow", right: "Wide" },

  // Investor psychology (Marks stacks 3 “Investors” pairs)
  { id: "investors-mood", group: "Investor Psychology", ask: "Investor mood", left: "Optimistic", right: "Pessimistic" },
  { id: "investors-state", group: "Investor Psychology", ask: "Investor comfort", left: "Sanguine", right: "Distressed" },
  { id: "investors-action", group: "Investor Psychology", ask: "Buying interest", left: "Eager to buy", right: "Uninterested in buying" },
  { id: "owners", group: "Investor Psychology", ask: "Asset owners", left: "Happy to hold", right: "Rushing for the exits" },
  { id: "sellers", group: "Investor Psychology", ask: "Sellers", left: "Few", right: "Many" },

  // Market / fundraising structure (Marks stacks 3 “Funds” pairs)
  { id: "markets", group: "Market Structure", ask: "Market crowding", left: "Crowded", right: "Starved for attention" },
  { id: "funds-access", group: "Market Structure", ask: "Fund access", left: "Hard to gain entry", right: "Open to anyone" },
  { id: "funds-new", group: "Market Structure", ask: "New fund raising", left: "New ones daily", right: "Only the best can raise money" },
  { id: "funds-terms", group: "Market Structure", ask: "Fund terms power", left: "GPs hold the cards", right: "LPs have bargaining power" },

  // Prices & risk
  { id: "performance", group: "Prices & Risk", ask: "Recent performance", left: "Strong", right: "Weak" },
  { id: "prices", group: "Prices & Risk", ask: "Asset prices", left: "High", right: "Low" },
  { id: "returns", group: "Prices & Risk", ask: "Prospective returns", left: "Low", right: "High" },
  { id: "risk", group: "Prices & Risk", ask: "Risk in the market", left: "High", right: "Low" },

  // Behavior (Marks: what’s popular vs what’s prudent vs easy mistakes)
  { id: "popular-aggression", group: "Behavior & Mistakes", ask: "What’s popular — stance", left: "Aggressiveness", right: "Caution and discipline" },
  { id: "popular-reach", group: "Behavior & Mistakes", ask: "What’s popular — scope", left: "Broad reach", right: "Selectivity" },
  { id: "right-caution", group: "Behavior & Mistakes", ask: "What you should emphasize — stance", left: "Caution and discipline", right: "Aggressiveness" },
  { id: "right-selectivity", group: "Behavior & Mistakes", ask: "What you should emphasize — scope", left: "Selectivity", right: "Broad reach" },
  { id: "mistake-size", group: "Behavior & Mistakes", ask: "Easy mistake — size", left: "Buying too much", right: "Buying too little" },
  { id: "mistake-price", group: "Behavior & Mistakes", ask: "Easy mistake — price", left: "Paying up", right: "Walking away" },
  { id: "mistake-risk", group: "Behavior & Mistakes", ask: "Easy mistake — risk", left: "Taking too much risk", right: "Taking too little risk" },
];

/**
 * @param {unknown} value
 * @returns {Degree}
 */
export function normalizeDegree(value) {
  if (value == null || value === "") return null;
  if (value === "left") return DEGREE_MAX;
  if (value === "right") return DEGREE_MIN;
  if (value === "neutral") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < DEGREE_MIN || n > DEGREE_MAX) return null;
  // Round to step so storage stays stable without snapping to coarse notches
  return Math.round(n / DEGREE_STEP) * DEGREE_STEP;
}

/**
 * @param {Degree} degree
 * @returns {number | null}
 */
export function degreeScore(degree) {
  const d = normalizeDegree(degree);
  if (d == null) return null;
  return d / DEGREE_MAX;
}

/**
 * @param {Degree} degree
 */
export function degreeLabel(degree) {
  const d = normalizeDegree(degree);
  if (d == null) return "—";
  if (Math.abs(d) < 0.15) return "Neutral";
  if (d >= 1.25) return "Strong left";
  if (d > 0) return "Mild left";
  if (d <= -1.25) return "Strong right";
  return "Mild right";
}

/**
 * @param {Degree} degree
 * @returns {'hot'|'warm'|'neutral'|'cool'|'cold'|null}
 */
export function degreeLean(degree) {
  const d = normalizeDegree(degree);
  if (d == null) return null;
  if (d >= 1.25) return "hot";
  if (d >= 0.35) return "warm";
  if (d > -0.35) return "neutral";
  if (d > -1.25) return "cool";
  return "cold";
}

/**
 * @param {Record<string, Degree | string>} answers
 */
export function scoreAssessment(answers) {
  let sum = 0;
  let left = 0;
  let right = 0;
  let neutral = 0;
  let answered = 0;

  for (const factor of FACTORS) {
    const d = normalizeDegree(answers[factor.id] ?? null);
    const s = degreeScore(d);
    if (s == null) continue;
    answered += 1;
    sum += s;
    if (d > 0.15) left += 1;
    else if (d < -0.15) right += 1;
    else neutral += 1;
  }

  const temperature =
    answered === 0 ? null : Math.round((sum / answered) * 100);

  return {
    answered,
    total: FACTORS.length,
    left,
    right,
    neutral,
    sum,
    temperature,
    zone: temperatureZone(temperature),
  };
}

/**
 * @param {number | null} temperature
 */
export function temperatureZone(temperature) {
  if (temperature == null) {
    return {
      id: "empty",
      label: "Not scored",
      posture: "Drag the factors to score.",
      lean: "empty",
    };
  }
  if (temperature >= 55) {
    return {
      id: "hot",
      label: "Market top · Greed",
      posture: "Hold onto your wallet.",
      lean: "hot",
    };
  }
  if (temperature >= 20) {
    return {
      id: "warm",
      label: "Elevated · Caution",
      posture: "Trim risk; avoid crowded trades.",
      lean: "warm",
    };
  }
  if (temperature > -20) {
    return {
      id: "neutral",
      label: "Mid-cycle · Mixed",
      posture: "No extreme signal.",
      lean: "neutral",
    };
  }
  if (temperature > -55) {
    return {
      id: "cool",
      label: "Depressed · Opportunity",
      posture: "Build a watchlist; scale in.",
      lean: "cool",
    };
  }
  return {
    id: "cold",
    label: "Market bottom · Fear",
    posture: "Be aggressive; buy what’s shunned.",
    lean: "cold",
  };
}

/**
 * @param {number | null} temperature
 */
export function pendulumAngle(temperature) {
  if (temperature == null) return 0;
  const t = Math.max(-100, Math.min(100, temperature));
  return (t / 100) * 60;
}

/**
 * @returns {{ group: string, factors: Factor[] }[]}
 */
export function groupedFactors() {
  /** @type {Map<string, { group: string, factors: Factor[] }>} */
  const map = new Map();
  for (const f of FACTORS) {
    let g = map.get(f.group);
    if (!g) {
      g = { group: f.group, factors: [] };
      map.set(f.group, g);
    }
    g.factors.push(f);
  }
  return [...map.values()];
}
