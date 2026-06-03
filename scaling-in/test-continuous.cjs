const fs = require("fs");
const path = require("path");

const code = fs
  .readFileSync(path.join(__dirname, "app.js"), "utf8")
  .replace(/document\.addEventListener[\s\S]*$/, "");
eval(code);

const ALIGN_TOL = 0.01;
const SHARE_EPS = 1e-4;
const P0 = 100;
const B = 100000;

const cases = [
  {
    name: "25/25/25/25 @ 0/5/10/15",
    steps: [
      { weightPct: 25, dropPct: 0 },
      { weightPct: 25, dropPct: 5 },
      { weightPct: 25, dropPct: 10 },
      { weightPct: 25, dropPct: 15 },
    ],
    triggers: [0, 5, 10, 15],
    earlyBuyRange: [1, 4],
  },
  {
    name: "40/20/20/20 @ 0/10/20/30",
    steps: [
      { weightPct: 40, dropPct: 0 },
      { weightPct: 20, dropPct: 10 },
      { weightPct: 20, dropPct: 20 },
      { weightPct: 20, dropPct: 30 },
    ],
    triggers: [0, 10, 20, 30],
  },
  {
    name: "50/30/20 @ 0/15/30",
    steps: [
      { weightPct: 50, dropPct: 0 },
      { weightPct: 30, dropPct: 15 },
      { weightPct: 20, dropPct: 30 },
    ],
    triggers: [0, 15, 30],
  },
];

function lsFitErrorAtTriggerK(sched, triggers, skipK = [0]) {
  const { alpha, beta } = sched.avgCurve;
  let maxErr = 0;
  let maxAt = null;
  for (const k of triggers) {
    if (skipK.includes(k)) continue;
    const row = sched.rows[k];
    if (!row) continue;
    const target = alpha + beta * k;
    const err = Math.abs(row.runningAvgCost - target);
    if (err > maxErr) {
      maxErr = err;
      maxAt = k;
    }
  }
  return { maxErr, maxAt, alpha, beta };
}

function assertLsAvgAtBuyDays2525() {
  const c = cases.find((x) => x.name === "25/25/25/25 @ 0/5/10/15");
  if (!c) return;
  const sched = buildContinuousSchedule(P0, B, c.steps);
  const { alpha, beta } = sched.avgCurve;
  for (const k of [5, 10, 15]) {
    const row = sched.rows.find((r) => r.dropPct === k);
    if (!row) throw new Error(`25/25: missing row k=${k}`);
    const ls = alpha + beta * k;
    if (Math.abs(row.runningAvgCost - ls) >= ALIGN_TOL) {
      throw new Error(
        `25/25: k=${k} runningAvg ${row.runningAvgCost} vs LS ${ls} (|Δ|=${Math.abs(row.runningAvgCost - ls)})`
      );
    }
  }
}

function assertOnwardBuysAfterFirstDrop(sched, c) {
  const nonZero = c.triggers.filter((t) => t > 0);
  if (!nonZero.length) return;
  const firstDrop = Math.min(...nonZero);
  const row = sched.rows.find((r) => r.dropPct === firstDrop + 1);
  if (!row || row.incrementalSpent <= 0) {
    throw new Error(`${c.name}: expected buy at k=${firstDrop + 1} after first drop trigger`);
  }
}

function assertTriggerSpends(sched, c) {
  for (const k of c.triggers) {
    if (k === 0) continue;
    const row = sched.rows.find((r) => r.dropPct === k);
    if (!row || row.incrementalSpent <= 0) {
      throw new Error(`${c.name}: k=${k} expected spend at trigger`);
    }
  }
}

function assert402020AtK10(sched, c) {
  if (c.name !== "40/20/20/20 @ 0/10/20/30") return;
  const ref = referenceAvgAtDrop(sched.discrete.stepDetails, 10, P0);
  if (Math.abs(ref - 96.42857142857143) > 1e-4) {
    throw new Error(`${c.name}: reference avg at k=10 expected 96.4286, got ${ref}`);
  }
}

function assert2525TriggerSpends(sched, c) {
  if (c.name !== "25/25/25/25 @ 0/5/10/15") return;
  const triggerSpends = c.triggers
    .map((k) => sched.rows.find((r) => r.dropPct === k))
    .filter((r) => r && r.incrementalSpent > 0)
    .map((r) => r.incrementalSpent);
  if (triggerSpends.length < 2) {
    throw new Error("expected non-zero incrementalSpent at multiple trigger drops");
  }
  const allEqual = triggerSpends.every((s) => Math.abs(s - triggerSpends[0]) < 1e-6);
  if (allEqual) {
    throw new Error("incrementalSpent must vary across trigger steps (not equal slices)");
  }
}

function assertRecommendBuyCurrentPrice(steps) {
  const rec = recommendBuy(P0, B, steps, 7, { sharesHeld: 500, avgCostHeld: 98 }, 93.5);
  if (Math.abs(rec.currentPrice - 93.5) > 1e-9) {
    throw new Error(`recommendBuy should use currentPrice override, got ${rec.currentPrice}`);
  }
  const recDefault = recommendBuy(P0, B, steps, 7, { sharesHeld: 500, avgCostHeld: 98 });
  if (Math.abs(recDefault.currentPrice - 93) > 1e-9) {
    throw new Error(`recommendBuy default price should be 93, got ${recDefault.currentPrice}`);
  }
  if (rec.sharesToBuy === recDefault.sharesToBuy) {
    throw new Error("recommendBuy with override should change sharesToBuy vs ladder price");
  }
}

const results = [];

for (const c of cases) {
  const sched = buildContinuousSchedule(P0, B, c.steps);
  const { maxErr, maxAt, alpha, beta } = lsFitErrorAtTriggerK(sched, c.triggers);
  const last = sched.rows[sched.rows.length - 1];

  validateStrategy(c.steps);
  assertTriggerSpends(sched, c);
  assertOnwardBuysAfterFirstDrop(sched, c);
  assert2525TriggerSpends(sched, c);
  assert402020AtK10(sched, c);

  if (last.cumulativeSpent <= 0) {
    throw new Error(`${c.name}: totalSpent must be > 0`);
  }

  results.push({
    name: c.name,
    alpha: alpha.toFixed(4),
    beta: beta.toFixed(6),
    maxErr: maxErr.toFixed(6),
    maxAt,
    totalSpent: last.cumulativeSpent,
    unspent: sched.budgetUnspent,
    shares: last.cumulativeShares,
  });
}

assertRecommendBuyCurrentPrice(cases[0].steps);

function assertContinuousMetaAt41(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const meta = continuousMetaAtDrop(sched.rows, P0, 4.1);
  const row4 = sched.rows[4];
  if (!meta || meta.incrementalSpent !== 0) {
    throw new Error(
      `continuousMetaAtDrop(4.1): expected incrementalSpent === 0, got ${meta?.incrementalSpent}`
    );
  }
  if (Math.abs(meta.cumulativeSpent - row4.cumulativeSpent) > 1e-6) {
    throw new Error("continuousMetaAtDrop(4.1): cumulative should match floor row 4");
  }
}

assertContinuousMetaAt41(cases[0].steps);

function assertContinuousMetaAt105(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const meta = continuousMetaAtDrop(sched.rows, P0, 10.5);
  if (!meta || meta.incrementalSpent !== 0) {
    throw new Error(
      `continuousMetaAtDrop(10.5): expected incrementalSpent === 0, got ${meta?.incrementalSpent}`
    );
  }
  const row10 = sched.rows[10];
  if (Math.abs(meta.avgCost - row10.runningAvgCost) > 1e-6) {
    throw new Error("continuousMetaAtDrop(10.5): avg should match row 10 running avg");
  }
}

assertContinuousMetaAt105(
  cases.find((c) => c.name === "40/20/20/20 @ 0/10/20/30").steps
);

if (typeof validateStrategy !== "function" || typeof buildContinuousSchedule !== "function") {
  throw new Error("exports smoke: core functions missing after eval");
}

function assertCompareTooltipHtml(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const html = buildCompareTooltipHtml(sched, P0, 10);
  if (!html.includes("连续路径")) {
    throw new Error("buildCompareTooltipHtml: expected 连续路径 column header");
  }
  if (html.includes("拟合路径")) {
    throw new Error("buildCompareTooltipHtml: should not mention 拟合路径");
  }
  if (!html.includes("参考策略") || !html.includes("持股") || !html.includes("总成本")) {
    throw new Error("buildCompareTooltipHtml: missing comparison rows");
  }
  if (html.includes("拟合目标均价")) {
    throw new Error("buildCompareTooltipHtml: should not include 拟合目标均价 row");
  }
  if (!html.includes("si-tip-table")) {
    throw new Error("buildCompareTooltipHtml: expected table layout");
  }
  if (html.includes("<td>现价</td>")) {
    throw new Error("buildCompareTooltipHtml: should not include separate 现价 row");
  }
  if (!html.includes('si-tip-title">90.00 (跌 10.0%)')) {
    throw new Error("buildCompareTooltipHtml: expected combined price and drop in title");
  }
  if (!html.includes("股 (+")) {
    throw new Error("buildCompareTooltipHtml: expected incremental shares in 持股 row");
  }
}

function assertFitAnnotationPoints(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const pts = buildFitAnnotationPoints(sched);
  if (pts.length !== sched.rows.length) {
    throw new Error(`buildFitAnnotationPoints: expected ${sched.rows.length} points, got ${pts.length}`);
  }
  const k5 = pts.find((p) => p.x === 5);
  if (!k5?.meta || k5.meta.cumulativeShares <= 0) {
    throw new Error("buildFitAnnotationPoints: k=5 should have cumulative shares meta");
  }
}

function assertFitBuyMarkers(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const markers = buildFitBuyMarkers(sched);
  const buyDays = sched.rows
    .filter((r) => r.dropPct > 0 && r.incrementalSpent > 0)
    .map((r) => r.dropPct);
  if (markers.length !== buyDays.length) {
    throw new Error(
      `buildFitBuyMarkers: expected ${buyDays.length} markers, got ${markers.length}`
    );
  }
  for (const m of markers) {
    if (!buyDays.includes(m.x)) {
      throw new Error(`buildFitBuyMarkers: unexpected marker at k=${m.x}`);
    }
    const row = sched.rows.find((r) => r.dropPct === m.x);
    const ls = sched.avgCurve.targetAvgAtDrop(m.x);
    if (!row || Math.abs(row.runningAvgCost - ls) >= ALIGN_TOL) {
      throw new Error(`buildFitBuyMarkers: k=${m.x} execution avg should match LS`);
    }
    if (Math.abs(m.y - row.runningAvgCost) > 1e-6) {
      throw new Error(`buildFitBuyMarkers: k=${m.x} marker y should be execution avg ${row.runningAvgCost}, got ${m.y}`);
    }
  }
  const idle = sched.rows.find((r) => r.incrementalSpent <= 0 && r.dropPct > 0);
  if (idle && markers.some((m) => m.x === idle.dropPct)) {
    throw new Error(`buildFitBuyMarkers: should not mark idle day k=${idle.dropPct}`);
  }
}

function assertContinuousFloorRowAt103(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const dropPct = 10.3;
  const exec = continuousMetaAtDrop(sched.rows, P0, dropPct);
  const row10 = sched.rows[10];
  if (!exec || !row10) {
    throw new Error("assertContinuousFloorRowAt103: expected meta and row 10");
  }
  if (Math.abs(exec.avgCost - row10.runningAvgCost) > 1e-6) {
    throw new Error("at 10.3% tooltip avg should use floor row 10 execution avg");
  }
  const ls10 = sched.avgCurve.targetAvgAtDrop(10);
  if (Math.abs(exec.avgCost - ls10) >= ALIGN_TOL) {
    throw new Error(`at 10.3% floor avg ${exec.avgCost} should match LS(10) ${ls10}`);
  }
  const html = buildCompareTooltipHtml(sched, P0, dropPct);
  if (!html.includes(exec.avgCost.toFixed(2))) {
    throw new Error("tooltip at 10.3% should show floor-row execution avg");
  }
  if (html.includes("拟合目标均价")) {
    throw new Error("tooltip at 10.3% should not include 拟合目标均价");
  }
}

assertCompareTooltipHtml(cases[0].steps);
assertFitAnnotationPoints(cases[0].steps);
assertFitBuyMarkers(cases[0].steps);

function assertDiscreteTooltipNoPositionAvg(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const html = buildCompareTooltipHtml(sched, P0, 5);
  const left = discreteMetaAtDrop(sched.discrete, P0, 5);
  if (!left || left.cumulativeShares !== 0) {
    throw new Error("discreteMetaAtDrop(5): expected zero shares before first trigger");
  }
  if (left.avgCost > 0) {
    throw new Error(`discreteMetaAtDrop(5): expected no avg with zero shares, got ${left.avgCost}`);
  }
  if (!html.includes("均价</td><td>—")) {
    throw new Error("buildCompareTooltipHtml: reference avg should be — before first trigger");
  }
}

function assertCumulativeSharesAtZero(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const row0 = sched.rows[0];
  if (row0.cumulativeShares <= 0) return;
  const target = cumulativeSharesAtDrop(sched, 0);
  if (Math.abs(target - row0.cumulativeShares) > 1e-6) {
    throw new Error(
      `cumulativeSharesAtDrop(0): expected ${row0.cumulativeShares}, got ${target}`
    );
  }
}

function assertFirstLsBuyAfterBootstrap(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const row0 = sched.rows[0];
  if (!row0 || row0.incrementalSpent <= 0) return;
  const firstBuy = sched.rows.find((r) => r.dropPct > 0 && r.incrementalSpent > 0);
  if (!firstBuy) {
    throw new Error("expected a buy toward LS after k=0 bootstrap");
  }
  const ls = sched.avgCurve.targetAvgAtDrop(firstBuy.dropPct);
  if (Math.abs(firstBuy.runningAvgCost - ls) >= ALIGN_TOL) {
    throw new Error(
      `first LS buy k=${firstBuy.dropPct}: avg ${firstBuy.runningAvgCost} vs LS ${ls}`
    );
  }
}

assertDiscreteTooltipNoPositionAvg([{ weightPct: 100, dropPct: 10 }]);
assertCumulativeSharesAtZero(cases[0].steps);
assertFirstLsBuyAfterBootstrap(cases[0].steps);

function assertShareKnots402020(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const knots = buildShareKnots(sched.discrete.stepDetails);
  if (knots[0].dropPct !== 0) {
    throw new Error("40/20: expected first knot at 0%");
  }
  if (knots[0].cumulativeShares <= 0) {
    throw new Error("40/20: expected positive shares at 0% knot");
  }
  if (knots.length !== 4) {
    throw new Error(`40/20: expected 4 knots, got ${knots.length}`);
  }
}

function manualDiscreteMetaAtDrop(stepDetails, initialPrice, dropPct) {
  const fired = stepDetails.filter((d) => d.dropPct <= dropPct + 1e-9);
  const last = fired[fired.length - 1];
  const price = initialPrice * (1 - dropPct / 100);
  if (!last) {
    return {
      cumulativeShares: 0,
      cumulativeSpent: 0,
      avgCost: 0,
      pl: 0,
    };
  }
  const shares = last.cumulativeShares;
  const spent = last.cumulativeSpent;
  return {
    cumulativeShares: shares,
    cumulativeSpent: spent,
    avgCost: shares > 0 ? spent / shares : 0,
    pl: shares * price - spent,
  };
}

function assertDiscreteMetaAtDropCompare(steps, drops) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const { stepDetails } = sched.discrete;
  for (const dropPct of drops) {
    const meta = discreteMetaAtDrop(sched.discrete, P0, dropPct);
    const manual = manualDiscreteMetaAtDrop(stepDetails, P0, dropPct);
    if (!meta) {
      throw new Error(`discreteMetaAtDrop(${dropPct}): expected meta`);
    }
    if (Math.abs(meta.cumulativeShares - manual.cumulativeShares) > 1e-6) {
      throw new Error(
        `discreteMetaAtDrop(${dropPct}): shares ${meta.cumulativeShares} vs manual ${manual.cumulativeShares}`
      );
    }
    if (Math.abs(meta.cumulativeSpent - manual.cumulativeSpent) > 1e-4) {
      throw new Error(
        `discreteMetaAtDrop(${dropPct}): spent ${meta.cumulativeSpent} vs manual ${manual.cumulativeSpent}`
      );
    }
    if (Math.abs(meta.avgCost - manual.avgCost) > 1e-6) {
      throw new Error(
        `discreteMetaAtDrop(${dropPct}): avg ${meta.avgCost} vs manual ${manual.avgCost}`
      );
    }
    if (Math.abs(meta.pl - manual.pl) > 1e-4) {
      throw new Error(`discreteMetaAtDrop(${dropPct}): pl ${meta.pl} vs manual ${manual.pl}`);
    }
  }
}

function assertDiscreteMetaRejectsScheduleRows(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  if (discreteMetaAtDrop(sched.rows, P0, 16.5) != null) {
    throw new Error("discreteMetaAtDrop(schedule.rows) must return null (not continuous rows)");
  }
}

function assertCompareTooltipUsesDiscreteOnly(steps) {
  const sched = buildContinuousSchedule(P0, B, steps);
  const dropPct = 16.5;
  const left = discreteMetaAtDrop(sched.discrete, P0, dropPct);
  const html = buildCompareTooltipHtml(sched, P0, dropPct);
  const cont = continuousMetaAtDrop(sched.rows, P0, dropPct);
  if (Math.abs(left.cumulativeShares - cont.cumulativeShares) < 1) {
    throw new Error("compare tooltip ref column must differ from continuous at 16.5%");
  }
  if (!html.includes(formatShares(left.cumulativeShares))) {
    throw new Error("buildCompareTooltipHtml: ref 持股 should match discreteMetaAtDrop");
  }
}

const case402020 = cases.find((c) => c.name === "40/20/20/20 @ 0/10/20/30");
assertShareKnots402020(case402020.steps);
assertDiscreteMetaAtDropCompare(case402020.steps, [10, 13.2, 16.5]);
assertDiscreteMetaRejectsScheduleRows(case402020.steps);
assertCompareTooltipUsesDiscreteOnly(case402020.steps);
assertContinuousFloorRowAt103(case402020.steps);
assertLsAvgAtBuyDays2525();

console.log("\n| Config | α | β | max|avg−LS| (triggers) | spent | unspent |");
console.log("|--------|---|----|---------------------|-------|---------|");
for (const r of results) {
  console.log(
    `| ${r.name} | ${r.alpha} | ${r.beta} | ${r.maxErr} @ k=${r.maxAt} | ${r.totalSpent.toFixed(0)} | ${r.unspent.toFixed(0)} |`
  );
}
console.log("\nrecommendBuy: current-price override OK");
console.log("OK");
