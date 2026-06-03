export const CONT_EPS = 1e-9;
export const DROP_CMP_EPS = 1e-6;
export const COMPARE_EPS = 1e-4;

export function priceAt(initial, dropPct) {
  return initial * (1 - dropPct / 100);
}

export function dropPctFromPrice(initialPrice, currentPrice) {
  if (initialPrice <= 0) return 0;
  return (1 - currentPrice / initialPrice) * 100;
}

export function validateStrategy(steps) {
  if (!steps.length) throw new Error("Add at least one step.");
  const total = steps.reduce((s, x) => s + x.weightPct, 0);
  if (Math.abs(total - 100) > 1e-4) {
    throw new Error(`Weights must sum to 100% (now ${total.toFixed(2)}%).`);
  }
  const drops = steps.map((s) => s.dropPct);
  if (drops.some((d, i) => i > 0 && d < drops[i - 1])) {
    throw new Error("Drop % must be non-decreasing per step.");
  }
  if (steps.some((s) => s.weightPct <= 0)) {
    throw new Error("Each weight must be positive.");
  }
}

export function simulateDiscrete(initialPrice, totalBudget, steps) {
  let totalShares = 0;
  let totalSpent = 0;
  const stepDetails = [];

  for (const step of steps) {
    const spent = (totalBudget * step.weightPct) / 100;
    const p = priceAt(initialPrice, step.dropPct);
    const shares = spent / p;
    totalShares += shares;
    totalSpent += spent;
    stepDetails.push({
      dropPct: step.dropPct,
      weightPct: step.weightPct,
      price: p,
      spent,
      shares,
      cumulativeShares: totalShares,
      cumulativeSpent: totalSpent,
    });
  }

  return {
    totalShares,
    totalSpent,
    averageCost: totalShares ? totalSpent / totalShares : 0,
    stepDetails,
  };
}

export function lastDiscreteStepAtDrop(stepDetails, dropPct) {
  let last = null;
  for (const d of stepDetails) {
    if (d.dropPct <= dropPct + DROP_CMP_EPS) last = d;
  }
  return last;
}

export function referenceAvgAtDrop(stepDetails, k, initialPrice) {
  if (!stepDetails.length) return initialPrice;
  const last = lastDiscreteStepAtDrop(stepDetails, k);
  if (!last) return initialPrice;
  return last.cumulativeShares ? last.cumulativeSpent / last.cumulativeShares : initialPrice;
}

export function buildReferenceAvgSamples(stepDetails, initialPrice, maxDrop) {
  const refSamples = [];
  for (let k = 0; k <= maxDrop; k++) {
    refSamples.push({ d: k, avg: referenceAvgAtDrop(stepDetails, k, initialPrice) });
  }
  return refSamples;
}

function sampleLsCurve(alpha, beta) {
  return function sampleTargetCurve(maxDropPct, step = 0.1) {
    const end = Math.max(0, maxDropPct);
    const pts = [];
    for (let d = 0; d <= end + 1e-9; d += step) {
      const drop = Math.round(d * 10) / 10;
      pts.push({ x: drop, y: alpha + beta * drop });
    }
    if (pts.length && pts[pts.length - 1].x < end) {
      pts.push({ x: end, y: alpha + beta * end });
    }
    return pts;
  };
}

export function fitAvgLine(points) {
  const n = points.length;
  const targetAvgAtDrop = (d) => {
    if (n === 0) return 0;
    if (n === 1) return points[0].avg;
    return alpha + beta * d;
  };

  if (n === 0) {
    return { alpha: 0, beta: 0, targetAvgAtDrop, sampleTargetCurve: () => [] };
  }
  if (n === 1) {
    const alpha = points[0].avg;
    return { alpha, beta: 0, targetAvgAtDrop, sampleTargetCurve: sampleLsCurve(alpha, 0) };
  }

  const meanD = points.reduce((s, p) => s + p.d, 0) / n;
  const meanAvg = points.reduce((s, p) => s + p.avg, 0) / n;
  let cov = 0;
  let varD = 0;
  for (const p of points) {
    cov += (p.d - meanD) * (p.avg - meanAvg);
    varD += (p.d - meanD) ** 2;
  }
  const beta = varD > 1e-15 ? cov / varD : 0;
  const alpha = meanAvg - beta * meanD;
  return { alpha, beta, targetAvgAtDrop, sampleTargetCurve: sampleLsCurve(alpha, beta) };
}

function clampTargetAvg(avg, initialPrice) {
  if (!Number.isFinite(avg) || avg <= 0) return null;
  return Math.min(avg, initialPrice);
}

function lineResult(sharesToBuy, cashNeeded, targetAvg, currentAvg, feasible, reason) {
  return { sharesToBuy, cashNeeded, targetAvg, currentAvg, feasible, reason };
}

export function sharesToReachAvg(Q0, S0, P, targetAvg) {
  const curAvg = Q0 > 0 ? S0 / Q0 : 0;
  if (Q0 === 0 && S0 === 0) {
    if (Math.abs(P - targetAvg) < 1e-6) return lineResult(0, 0, targetAvg, 0, true, "zero_price_matches_target");
    if (targetAvg > P + 1e-6) return lineResult(0, 0, targetAvg, 0, false, "zero_target_above_price");
    if (targetAvg < P - 1e-6) return lineResult(0, 0, targetAvg, 0, false, "zero_target_below_price");
    return lineResult(0, 0, targetAvg, 0, false, "zero_no_position");
  }
  if (Math.abs(P - targetAvg) < 1e-6) {
    const ok = Math.abs(curAvg - targetAvg) < 1e-6;
    return lineResult(0, 0, targetAvg, curAvg, ok, ok ? "aligned" : "price_equals_target_mismatch");
  }
  const dq = (targetAvg * Q0 - S0) / (P - targetAvg);
  if (dq <= 1e-9) {
    return lineResult(0, 0, targetAvg, curAvg, false, curAvg <= targetAvg + 1e-6 ? "already_at_or_better" : "no_positive_buy");
  }
  return lineResult(dq, dq * P, targetAvg, curAvg, true, "buy_to_fit");
}

export function buyToTargetAvg(state, dropPct, initialPrice, targetAvg, options = {}) {
  const Q = state.shares || 0;
  const S = state.spent || 0;
  const P =
    options.currentPrice != null && options.currentPrice > 0
      ? options.currentPrice
      : priceAt(initialPrice, dropPct);
  const fitTarget = clampTargetAvg(targetAvg, initialPrice);
  const buyTarget = options.simulate && options.useUnclampedTarget ? targetAvg : fitTarget;
  const line = buyTarget
    ? sharesToReachAvg(Q, S, P, buyTarget)
    : lineResult(0, 0, 0, Q > 0 ? S / Q : 0, false, "invalid_target");
  const budgetRem = options.totalBudget != null ? Math.max(0, options.totalBudget - S) : null;

  let dq = 0;
  let spent = 0;
  let budgetCapped = false;

  if (line.sharesToBuy > CONT_EPS) {
    if (budgetRem != null) {
      const maxDq = P > 0 ? budgetRem / P : 0;
      dq = Math.min(line.sharesToBuy, maxDq);
      spent = dq * P;
      budgetCapped = dq + CONT_EPS < line.sharesToBuy;
    } else {
      dq = line.sharesToBuy;
      spent = line.cashNeeded;
    }
  } else if (
    options.simulate &&
    Q <= CONT_EPS &&
    S <= CONT_EPS &&
    dropPct === 0 &&
    budgetRem != null &&
    budgetRem > CONT_EPS &&
    options.bootstrapSpend > CONT_EPS
  ) {
    spent = Math.min(budgetRem, options.bootstrapSpend);
    dq = spent / P;
  }

  return {
    dq,
    spent,
    price: P,
    targetAvg: fitTarget ?? 0,
    fitTargetAvg: targetAvg,
    line,
    budgetCapped,
  };
}

export function buildShareKnots(stepDetails) {
  if (!stepDetails.length) return [{ dropPct: 0, cumulativeShares: 0 }];
  const knots = stepDetails.map((d) => ({
    dropPct: d.dropPct,
    cumulativeShares: d.cumulativeShares,
  }));
  if (knots[0].dropPct > DROP_CMP_EPS) {
    knots.unshift({ dropPct: 0, cumulativeShares: 0 });
  }
  return knots;
}

function piecewiseLinearSharesAtDrop(knots, k) {
  if (!knots.length || k < 0) return 0;
  if (k <= knots[0].dropPct + DROP_CMP_EPS) return knots[0].cumulativeShares;
  const last = knots[knots.length - 1];
  if (k >= last.dropPct - DROP_CMP_EPS) return last.cumulativeShares;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (k >= a.dropPct - DROP_CMP_EPS && k <= b.dropPct + DROP_CMP_EPS) {
      const span = b.dropPct - a.dropPct;
      if (span <= DROP_CMP_EPS) return b.cumulativeShares;
      const t = (k - a.dropPct) / span;
      return a.cumulativeShares + t * (b.cumulativeShares - a.cumulativeShares);
    }
  }
  return last.cumulativeShares;
}

export function targetSharesAtDrop(stepDetails, k) {
  return piecewiseLinearSharesAtDrop(buildShareKnots(stepDetails), k);
}

export function activeSegmentAtDrop(stepDetails, k) {
  const knots = buildShareKnots(stepDetails);
  const stepAt = (dropPct) =>
    stepDetails.find((d) => Math.abs(d.dropPct - dropPct) < DROP_CMP_EPS);
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (k > a.dropPct + DROP_CMP_EPS && k <= b.dropPct + DROP_CMP_EPS) {
      const step = stepAt(b.dropPct);
      return step ? { endDrop: b.dropPct, step } : null;
    }
  }
  return null;
}

export function buildContinuousSchedule(initialPrice, totalBudget, steps) {
  const discrete = simulateDiscrete(initialPrice, totalBudget, steps);
  const maxDrop = Math.max(...steps.map((s) => s.dropPct));
  const refSamples = buildReferenceAvgSamples(discrete.stepDetails, initialPrice, maxDrop);
  const avgCurve = fitAvgLine(refSamples);
  const step0 = discrete.stepDetails.find((d) => Math.abs(d.dropPct) < DROP_CMP_EPS);
  const bootstrapSpend = step0 ? step0.spent : 0;
  const rows = [];
  let Q = 0;
  let S = 0;

  for (let k = 0; k <= maxDrop; k++) {
    const P = priceAt(initialPrice, k);
    const A = avgCurve.targetAvgAtDrop(k);
    let deltaQ = 0;
    let incrementalSpent = 0;
    let budgetCapped = false;

    if (k === 0) {
      if (step0 && bootstrapSpend > CONT_EPS) {
        const budgetRem = Math.max(0, totalBudget - S);
        incrementalSpent = Math.min(budgetRem, bootstrapSpend);
        deltaQ = P > CONT_EPS ? incrementalSpent / P : 0;
        budgetCapped = incrementalSpent + CONT_EPS < bootstrapSpend;
      }
    } else {
      const buy = buyToTargetAvg({ shares: Q, spent: S }, k, initialPrice, A, {
        simulate: true,
        useUnclampedTarget: true,
        totalBudget,
        currentPrice: P,
      });
      deltaQ = buy.dq;
      incrementalSpent = buy.spent;
      budgetCapped = buy.budgetCapped;
    }

    Q += deltaQ;
    S += incrementalSpent;

    if (Math.abs(incrementalSpent - deltaQ * P) >= 1e-6) {
      throw new Error(`Continuous row ${k}% inconsistent: spent=${incrementalSpent}`);
    }

    rows.push({
      dropPct: k,
      price: P,
      incrementalShares: deltaQ,
      incrementalSpent,
      cumulativeShares: Q,
      cumulativeSpent: S,
      runningAvgCost: Q > CONT_EPS ? S / Q : 0,
      targetAvg: clampTargetAvg(A, initialPrice) ?? 0,
      budgetCapped,
    });
  }

  return {
    rows,
    discrete,
    totalBudget,
    initialPrice,
    avgCurve,
    budgetUnspent: Math.max(0, totalBudget - S),
  };
}

export function recommendBuyFromSchedule(schedule, dropPct, state = {}, currentPriceOverride) {
  const held = state.sharesHeld || 0;
  const avgHeld = held > 0 ? state.avgCostHeld || 0 : 0;
  const spent = held > 0 ? held * avgHeld : 0;
  const fitTargetAvg = schedule.avgCurve.targetAvgAtDrop(dropPct);
  const rec = buyToTargetAvg({ shares: held, spent }, dropPct, schedule.initialPrice, fitTargetAvg, {
    currentPrice: currentPriceOverride,
  });
  const { line } = rec;
  const after = held + line.sharesToBuy;
  return {
    dropPct,
    currentPrice: rec.price,
    sharesToBuy: line.sharesToBuy,
    cashNeeded: line.cashNeeded,
    targetAvg: rec.targetAvg,
    fitTargetAvg,
    sharesHeldBefore: held,
    avgCostHeldBefore: avgHeld,
    costBasisBefore: spent,
    sharesHeldAfter: after,
    avgAfterBuy: after > 0 ? (spent + line.cashNeeded) / after : 0,
    feasible: line.feasible,
    currentAvg: held > 0 ? avgHeld : 0,
    line,
  };
}

export function recommendBuy(initialPrice, totalBudget, steps, dropPct, state = {}, currentPriceOverride) {
  return recommendBuyFromSchedule(
    buildContinuousSchedule(initialPrice, totalBudget, steps),
    dropPct,
    state,
    currentPriceOverride
  );
}

export function cumulativeSharesAtDrop(schedule, dropPct) {
  const { rows } = schedule;
  if (!rows.length) return 0;
  if (dropPct < 0) return 0;
  const last = rows[rows.length - 1];
  if (dropPct >= last.dropPct) return last.cumulativeShares;
  const idx = Math.min(Math.max(0, Math.floor(dropPct + 1e-9)), rows.length - 1);
  return rows[idx].cumulativeShares;
}

export function recommendBuyShareCatchUpFromSchedule(schedule, dropPct, state = {}) {
  const held = state.sharesHeld || 0;
  const target = cumulativeSharesAtDrop(schedule, dropPct);
  const toBuy = Math.max(0, target - held);
  const p = priceAt(schedule.initialPrice, dropPct);
  return {
    sharesToBuy: toBuy,
    cashNeeded: toBuy * p,
    targetCumulativeShares: target,
    sharesHeldAfter: held + toBuy,
  };
}

export function recommendBuyShareCatchUp(initialPrice, totalBudget, steps, dropPct, state = {}) {
  return recommendBuyShareCatchUpFromSchedule(
    buildContinuousSchedule(initialPrice, totalBudget, steps),
    dropPct,
    state
  );
}

export function rowMeta(r) {
  const avg =
    r.runningAvgCost != null && Number.isFinite(r.runningAvgCost)
      ? r.runningAvgCost
      : r.cumulativeShares
        ? r.cumulativeSpent / r.cumulativeShares
        : 0;
  const pl = r.cumulativeShares * r.price - r.cumulativeSpent;
  const plPctVal = r.cumulativeSpent > 0 ? (pl / r.cumulativeSpent) * 100 : 0;
  return {
    dropPct: r.dropPct,
    price: r.price,
    incrementalSpent: r.incrementalSpent,
    incrementalShares: r.incrementalShares,
    cumulativeSpent: r.cumulativeSpent,
    cumulativeShares: r.cumulativeShares,
    avgCost: avg,
    pl,
    plPct: plPctVal,
  };
}

export function discreteMetaAtDrop(discrete, initialPrice, dropPct) {
  const stepDetails = discrete?.stepDetails;
  if (!Array.isArray(stepDetails) || !stepDetails.length) return null;
  const last = lastDiscreteStepAtDrop(stepDetails, dropPct);
  const price = priceAt(initialPrice, dropPct);
  if (!last) {
    return rowMeta({
      dropPct,
      price,
      incrementalSpent: 0,
      incrementalShares: 0,
      cumulativeSpent: 0,
      cumulativeShares: 0,
    });
  }
  const onStep = stepDetails.find((d) => Math.abs(d.dropPct - dropPct) < DROP_CMP_EPS);
  return rowMeta({
    dropPct,
    price,
    incrementalSpent: onStep?.spent ?? 0,
    incrementalShares: onStep?.shares ?? 0,
    cumulativeSpent: last.cumulativeSpent,
    cumulativeShares: last.cumulativeShares,
  });
}

export function continuousMetaAtDrop(rows, initialPrice, dropPct) {
  if (!rows.length) return null;
  const lastIdx = rows.length - 1;
  const idx = Math.min(Math.max(0, Math.floor(dropPct + 1e-9)), lastIdx);
  const row = rows[idx];
  const onInteger = Math.abs(dropPct - idx) < 1e-9;
  return rowMeta({
    dropPct,
    price: priceAt(initialPrice, dropPct),
    incrementalSpent: onInteger ? row.incrementalSpent : 0,
    incrementalShares: onInteger ? row.incrementalShares : 0,
    cumulativeSpent: row.cumulativeSpent,
    cumulativeShares: row.cumulativeShares,
    runningAvgCost: row.runningAvgCost,
  });
}

export function continuousTooltipMetaAtDrop(rows, initialPrice, dropPct) {
  const base = continuousMetaAtDrop(rows, initialPrice, dropPct);
  if (!base) return null;
  const k = Math.min(Math.max(0, Math.round(dropPct)), rows.length - 1);
  const incRow = rows[k];
  return {
    ...base,
    incrementalShares: incRow.incrementalShares,
    incrementalSpent: incRow.incrementalSpent,
  };
}

export const MARKER_GOOD_COLOR = "#3dd68c";
export const MARKER_BAD_COLOR = "#ff6b6b";
export const MARKER_NEUTRAL_COLOR = "#3498db";

export function avgCompareMarkerColor(continuousAvg, referenceAvg) {
  if (!(continuousAvg > 0 && referenceAvg > 0)) return MARKER_NEUTRAL_COLOR;
  const diff = continuousAvg - referenceAvg;
  if (diff < -COMPARE_EPS) return MARKER_GOOD_COLOR;
  if (diff > COMPARE_EPS) return MARKER_BAD_COLOR;
  return MARKER_NEUTRAL_COLOR;
}

export function formatShares(n) {
  return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function formatMoney(n) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatAvg(n) {
  return n > 0 ? n.toFixed(4) : "—";
}

function formatTipPrice(price) {
  return price.toFixed(2);
}

function formatTipPriceWithDrop(price, dropPct) {
  return `${formatTipPrice(price)} (跌 ${dropPct.toFixed(1)}%)`;
}

function formatTipAvg(meta) {
  return meta.avgCost > 0 ? meta.avgCost.toFixed(2) : "—";
}

function formatTipPl(meta) {
  const sign = meta.pl >= 0 ? "+" : "";
  return `${sign}${formatMoney(meta.pl)} (${sign}${meta.plPct.toFixed(2)}%)`;
}

function formatTipShares(meta) {
  const inc = meta.incrementalShares ?? 0;
  return `${formatShares(meta.cumulativeShares)} 股 (+${formatShares(inc)} 股)`;
}

function compareTipClass(right, left, rule) {
  if (rule === "neutral") return "";
  const diff = right - left;
  if (rule === "lower-better") {
    if (diff < -COMPARE_EPS) return "tip-good";
    if (diff > COMPARE_EPS) return "tip-bad";
  } else if (rule === "higher-better") {
    if (diff > COMPARE_EPS) return "tip-good";
    if (diff < -COMPARE_EPS) return "tip-bad";
  }
  return "";
}

function metaAtDropOrDefault(meta, dropPct, initialPrice) {
  if (meta) return meta;
  const price = priceAt(initialPrice, dropPct);
  return {
    dropPct,
    price,
    cumulativeShares: 0,
    cumulativeSpent: 0,
    avgCost: 0,
    pl: 0,
    plPct: 0,
  };
}

export function buildCompareTooltipHtml(schedule, initialPrice, dropPct) {
  const left =
    discreteMetaAtDrop(schedule.discrete, initialPrice, dropPct) ??
    rowMeta({
      dropPct,
      price: priceAt(initialPrice, dropPct),
      incrementalSpent: 0,
      incrementalShares: 0,
      cumulativeSpent: 0,
      cumulativeShares: 0,
    });
  const right = metaAtDropOrDefault(
    continuousTooltipMetaAtDrop(schedule.rows, initialPrice, dropPct),
    dropPct,
    initialPrice
  );
  const avgCls =
    left.avgCost > 0 && right.avgCost > 0
      ? compareTipClass(right.avgCost, left.avgCost, "lower-better")
      : "";
  const plCls = compareTipClass(right.pl, left.pl, "higher-better");

  return (
    `<div class="si-tip-title">${formatTipPriceWithDrop(left.price, dropPct)}</div>` +
    `<table class="si-tip-table">` +
    `<thead><tr><th></th><th>参考策略</th><th>连续路径</th></tr></thead>` +
    `<tbody>` +
    `<tr><td>持股</td><td>${formatTipShares(left)}</td><td>${formatTipShares(right)}</td></tr>` +
    `<tr><td>均价</td><td>${formatTipAvg(left)}</td><td class="${avgCls}">${formatTipAvg(right)}</td></tr>` +
    `<tr><td>总成本</td><td>${formatMoney(left.cumulativeSpent)}</td><td>${formatMoney(right.cumulativeSpent)}</td></tr>` +
    `<tr><td>盈亏</td><td>${formatTipPl(left)}</td><td class="${plCls}">${formatTipPl(right)}</td></tr>` +
    `</tbody></table>`
  );
}

function fitPathMetaFromRow(r) {
  return rowMeta({
    dropPct: r.dropPct,
    price: r.price,
    incrementalSpent: r.incrementalSpent,
    incrementalShares: r.incrementalShares,
    cumulativeSpent: r.cumulativeSpent,
    cumulativeShares: r.cumulativeShares,
    runningAvgCost: r.runningAvgCost,
  });
}

export function buildFitAnnotationPoints(schedule) {
  const { avgCurve } = schedule;
  return schedule.rows.map((r) => {
    const meta = fitPathMetaFromRow(r);
    return {
      x: r.dropPct,
      y: avgCurve.targetAvgAtDrop(r.dropPct),
      meta,
      lsTargetAvg: avgCurve.targetAvgAtDrop(r.dropPct),
    };
  });
}

export function buildFitBuyMarkers(schedule, initialPrice) {
  return schedule.rows
    .filter((r) => r.dropPct > 0 && r.incrementalSpent > CONT_EPS)
    .map((r) => {
      const meta = fitPathMetaFromRow(r);
      const y =
        r.runningAvgCost > CONT_EPS ? r.runningAvgCost : schedule.avgCurve.targetAvgAtDrop(r.dropPct);
      const ref = discreteMetaAtDrop(schedule.discrete, initialPrice, r.dropPct);
      const refAvg = ref?.avgCost ?? 0;
      return {
        x: r.dropPct,
        y,
        meta,
        pointColor: avgCompareMarkerColor(y, refAvg),
      };
    });
}

/** Independent row accounting check for tests and diagnostics. */
export function verifyScheduleAccounting(schedule, initialPrice, options = {}) {
  const eps = options.epsilon ?? 1e-6;
  const moneyEps = options.moneyEpsilon ?? 0.01;
  const errors = [];
  const { rows } = schedule;
  let sumIncrementalSpent = 0;
  let sumIncrementalShares = 0;
  let replayShares = 0;
  let replaySpent = 0;

  for (const row of rows) {
    const rowPrice = row.price ?? priceAt(initialPrice, row.dropPct);
    if (Math.abs(rowPrice - priceAt(initialPrice, row.dropPct)) > eps) {
      errors.push(
        `drop ${row.dropPct}%: stored price ${rowPrice} != priceAt(${initialPrice}, ${row.dropPct})`
      );
    }

    if (row.incrementalSpent > CONT_EPS) {
      const spentFromShares = row.incrementalShares * rowPrice;
      if (Math.abs(row.incrementalSpent - spentFromShares) > eps) {
        errors.push(
          `drop ${row.dropPct}%: incrementalSpent ${row.incrementalSpent} != incrementalShares*price ${spentFromShares}`
        );
      }
    }

    sumIncrementalSpent += row.incrementalSpent;
    sumIncrementalShares += row.incrementalShares;

    if (Math.abs(row.cumulativeSpent - sumIncrementalSpent) > eps) {
      errors.push(
        `drop ${row.dropPct}%: cumulativeSpent ${row.cumulativeSpent} != sum incrementals ${sumIncrementalSpent}`
      );
    }
    if (Math.abs(row.cumulativeShares - sumIncrementalShares) > eps) {
      errors.push(
        `drop ${row.dropPct}%: cumulativeShares ${row.cumulativeShares} != sum incremental shares ${sumIncrementalShares}`
      );
    }

    const avgFromTotals =
      row.cumulativeShares > CONT_EPS ? row.cumulativeSpent / row.cumulativeShares : 0;
    if (Math.abs(row.runningAvgCost - avgFromTotals) > eps) {
      errors.push(
        `drop ${row.dropPct}%: runningAvgCost ${row.runningAvgCost} != cumulativeSpent/cumulativeShares ${avgFromTotals}`
      );
    }

    replayShares += row.incrementalShares;
    replaySpent += row.incrementalSpent;
    const replayAvg = replayShares > CONT_EPS ? replaySpent / replayShares : 0;
    if (Math.abs(row.cumulativeSpent - replaySpent) > eps) {
      errors.push(
        `drop ${row.dropPct}%: replay cumulativeSpent ${replaySpent} != row ${row.cumulativeSpent}`
      );
    }
    if (Math.abs(row.cumulativeShares - replayShares) > eps) {
      errors.push(
        `drop ${row.dropPct}%: replay cumulativeShares ${replayShares} != row ${row.cumulativeShares}`
      );
    }
    if (Math.abs(row.runningAvgCost - replayAvg) > eps) {
      errors.push(
        `drop ${row.dropPct}%: replay avg ${replayAvg} != runningAvgCost ${row.runningAvgCost}`
      );
    }
  }

  return { ok: errors.length === 0, errors, epsilon: eps, moneyEpsilon: moneyEps };
}

export function verifyMetaPl(meta, options = {}) {
  const eps = options.epsilon ?? 1e-6;
  const moneyEps = options.moneyEpsilon ?? 0.01;
  const expectedPl = meta.cumulativeShares * meta.price - meta.cumulativeSpent;
  const plErr = Math.abs(meta.pl - expectedPl);
  const plPctExpected = meta.cumulativeSpent > 0 ? (expectedPl / meta.cumulativeSpent) * 100 : 0;
  const plPctErr = Math.abs(meta.plPct - plPctExpected);
  return {
    ok: plErr <= moneyEps && plPctErr <= eps,
    plErr,
    plPctErr,
    expectedPl,
  };
}
