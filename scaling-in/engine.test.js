import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildCompareTooltipHtml,
  buildContinuousSchedule,
  buildFitAnnotationPoints,
  buildFitBuyMarkers,
  buildShareKnots,
  continuousMetaAtDrop,
  continuousTooltipMetaAtDrop,
  cumulativeSharesAtDrop,
  discreteMetaAtDrop,
  formatMoney,
  formatShares,
  referenceAvgAtDrop,
  recommendBuy,
  validateStrategy,
  verifyMetaPl,
  verifyScheduleAccounting,
} from "./engine.js";

const ALIGN_TOL = 0.01;
const ACCT_EPS = 1e-6;
const MONEY_EPS = 0.01;
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

function formatTipPlForTest(meta) {
  const sign = meta.pl >= 0 ? "+" : "";
  const plPct = meta.cumulativeSpent > 0 ? (meta.pl / meta.cumulativeSpent) * 100 : 0;
  return `${sign}${formatMoney(meta.pl)} (${sign}${plPct.toFixed(2)}%)`;
}

function formatTipSharesForTest(meta) {
  const inc = meta.incrementalShares ?? 0;
  return `${formatShares(meta.cumulativeShares)} 股 (+${formatShares(inc)} 股)`;
}

function assertMetaPl(meta, label) {
  const check = verifyMetaPl(meta, { epsilon: ACCT_EPS, moneyEpsilon: MONEY_EPS });
  assert.ok(check.ok, `${label}: pl=${meta.pl} expected ${check.expectedPl} (err=${check.plErr})`);
}

describe("independent schedule accounting", () => {
  for (const c of cases) {
    test(`verifyScheduleAccounting ${c.name}`, () => {
      const sched = buildContinuousSchedule(P0, B, c.steps);
      const result = verifyScheduleAccounting(sched, P0, { epsilon: ACCT_EPS, moneyEpsilon: MONEY_EPS });
      assert.ok(result.ok, result.errors.join("\n"));
    });

    test(`replay simulation ${c.name}`, () => {
      const sched = buildContinuousSchedule(P0, B, c.steps);
      let q = 0;
      let s = 0;
      for (const row of sched.rows) {
        q += row.incrementalShares;
        s += row.incrementalSpent;
        const replayAvg = q > 0 ? s / q : 0;
        assert.ok(Math.abs(row.cumulativeSpent - s) <= ACCT_EPS, `k=${row.dropPct} replay spent`);
        assert.ok(Math.abs(row.cumulativeShares - q) <= ACCT_EPS, `k=${row.dropPct} replay shares`);
        assert.ok(Math.abs(row.runningAvgCost - replayAvg) <= ACCT_EPS, `k=${row.dropPct} replay avg`);
      }
    });

    test(`meta P/L ${c.name}`, () => {
      const sched = buildContinuousSchedule(P0, B, c.steps);
      const maxDrop = Math.max(...c.steps.map((s) => s.dropPct));
      const sampleDrops = [0, ...c.triggers, maxDrop / 2, maxDrop + 0.3].filter(
        (d, i, arr) => arr.indexOf(d) === i && d <= maxDrop + 0.5
      );
      for (const dropPct of sampleDrops) {
        const cont = continuousMetaAtDrop(sched.rows, P0, dropPct);
        assert.ok(cont, `continuous meta at ${dropPct}`);
        assertMetaPl(cont, `continuous k=${dropPct}`);

        const disc = discreteMetaAtDrop(sched.discrete, P0, dropPct);
        assert.ok(disc, `discrete meta at ${dropPct}`);
        assertMetaPl(disc, `discrete k=${dropPct}`);

        const expectedPl = cont.cumulativeShares * cont.price - cont.cumulativeSpent;
        assert.ok(Math.abs(cont.pl - expectedPl) <= MONEY_EPS);
        assert.ok(Math.abs(disc.pl - (disc.cumulativeShares * disc.price - disc.cumulativeSpent)) <= MONEY_EPS);
      }
    });

    test(`buy markers meta avg ${c.name}`, () => {
      const sched = buildContinuousSchedule(P0, B, c.steps);
      const markers = buildFitBuyMarkers(sched, P0);
      for (const m of markers) {
        const row = sched.rows.find((r) => r.dropPct === m.x);
        assert.ok(row, `marker k=${m.x}`);
        assert.ok(m.meta, `marker k=${m.x} missing meta`);
        assert.ok(Math.abs(m.meta.avgCost - row.runningAvgCost) <= ACCT_EPS, `marker k=${m.x} meta avg`);
        assert.ok(Math.abs(m.y - row.runningAvgCost) <= ACCT_EPS, `marker k=${m.x} y avg`);
        assertMetaPl(m.meta, `marker k=${m.x}`);
      }
    });

    test(`compare tooltip derivable ${c.name}`, () => {
      const sched = buildContinuousSchedule(P0, B, c.steps);
      const maxDrop = Math.max(...c.steps.map((s) => s.dropPct));
      const drops = [0, ...c.triggers.filter((t) => t > 0), maxDrop / 2, maxDrop - 1, maxDrop];
      for (const dropPct of drops) {
        const left = discreteMetaAtDrop(sched.discrete, P0, dropPct);
        const right = continuousTooltipMetaAtDrop(sched.rows, P0, dropPct);
        assert.ok(left && right, `meta at ${dropPct}`);
        const html = buildCompareTooltipHtml(sched, P0, dropPct);
        const priceStr = left.price.toFixed(2);
        assert.match(html, new RegExp(priceStr.replace(".", "\\.")));
        assert.match(html, new RegExp(formatTipSharesForTest(left).replace(/[+()]/g, "\\$&")));
        assert.match(html, new RegExp(formatTipSharesForTest(right).replace(/[+()]/g, "\\$&")));
        if (left.avgCost > 0) {
          assert.match(html, new RegExp(left.avgCost.toFixed(2).replace(".", "\\.")));
        }
        if (right.avgCost > 0) {
          assert.match(html, new RegExp(right.avgCost.toFixed(2).replace(".", "\\.")));
        }
        assert.match(html, new RegExp(formatMoney(left.cumulativeSpent).replace(/,/g, ",")));
        assert.match(html, new RegExp(formatMoney(right.cumulativeSpent).replace(/,/g, ",")));
        assert.match(html, new RegExp(formatTipPlForTest(left).replace(/[+()$]/g, "\\$&")));
        assert.match(html, new RegExp(formatTipPlForTest(right).replace(/[+()$]/g, "\\$&")));
      }
    });
  }
});

describe("buildContinuousSchedule", () => {
  for (const c of cases) {
    test(c.name, () => {
      const sched = buildContinuousSchedule(P0, B, c.steps);
      const { maxErr, alpha, beta } = lsFitErrorAtTriggerK(sched, c.triggers);
      const last = sched.rows[sched.rows.length - 1];

      validateStrategy(c.steps);

      for (const k of c.triggers) {
        if (k === 0) continue;
        const row = sched.rows.find((r) => r.dropPct === k);
        assert.ok(row && row.incrementalSpent > 0, `${c.name}: k=${k} expected spend at trigger`);
      }

      const nonZero = c.triggers.filter((t) => t > 0);
      if (nonZero.length) {
        const firstDrop = Math.min(...nonZero);
        const row = sched.rows.find((r) => r.dropPct === firstDrop + 1);
        assert.ok(row && row.incrementalSpent > 0, `${c.name}: expected buy at k=${firstDrop + 1}`);
      }

      if (c.name === "25/25/25/25 @ 0/5/10/15") {
        const triggerSpends = c.triggers
          .map((k) => sched.rows.find((r) => r.dropPct === k))
          .filter((r) => r && r.incrementalSpent > 0)
          .map((r) => r.incrementalSpent);
        assert.ok(triggerSpends.length >= 2, "expected non-zero incrementalSpent at multiple trigger drops");
        const allEqual = triggerSpends.every((s) => Math.abs(s - triggerSpends[0]) < 1e-6);
        assert.ok(!allEqual, "incrementalSpent must vary across trigger steps (not equal slices)");
      }

      if (c.name === "40/20/20/20 @ 0/10/20/30") {
        const ref = referenceAvgAtDrop(sched.discrete.stepDetails, 10, P0);
        assert.ok(Math.abs(ref - 96.42857142857143) <= 1e-4, `reference avg at k=10 expected 96.4286, got ${ref}`);
      }

      assert.ok(last.cumulativeSpent > 0, `${c.name}: totalSpent must be > 0`);
      assert.ok(Number.isFinite(alpha) && Number.isFinite(beta));
      assert.ok(maxErr >= 0);
    });
  }
});

test("LS avg at buy days 25/25/25/25", () => {
  const c = cases.find((x) => x.name === "25/25/25/25 @ 0/5/10/15");
  const sched = buildContinuousSchedule(P0, B, c.steps);
  const { alpha, beta } = sched.avgCurve;
  for (const k of [5, 10, 15]) {
    const row = sched.rows.find((r) => r.dropPct === k);
    assert.ok(row, `missing row k=${k}`);
    const ls = alpha + beta * k;
    assert.ok(
      Math.abs(row.runningAvgCost - ls) < ALIGN_TOL,
      `k=${k} runningAvg ${row.runningAvgCost} vs LS ${ls}`
    );
  }
});

test("recommendBuy currentPrice override", () => {
  const steps = cases[0].steps;
  const rec = recommendBuy(P0, B, steps, 7, { sharesHeld: 500, avgCostHeld: 98 }, 93.5);
  assert.ok(Math.abs(rec.currentPrice - 93.5) < 1e-9);
  const recDefault = recommendBuy(P0, B, steps, 7, { sharesHeld: 500, avgCostHeld: 98 });
  assert.ok(Math.abs(recDefault.currentPrice - 93) < 1e-9);
  assert.notEqual(rec.sharesToBuy, recDefault.sharesToBuy);
});

test("continuousMetaAtDrop at 4.1", () => {
  const sched = buildContinuousSchedule(P0, B, cases[0].steps);
  const meta = continuousMetaAtDrop(sched.rows, P0, 4.1);
  const row4 = sched.rows[4];
  assert.equal(meta?.incrementalSpent, 0);
  assert.ok(Math.abs(meta.cumulativeSpent - row4.cumulativeSpent) <= 1e-6);
});

test("continuousMetaAtDrop at 10.5", () => {
  const steps = cases.find((c) => c.name === "40/20/20/20 @ 0/10/20/30").steps;
  const sched = buildContinuousSchedule(P0, B, steps);
  const meta = continuousMetaAtDrop(sched.rows, P0, 10.5);
  assert.equal(meta?.incrementalSpent, 0);
  const row10 = sched.rows[10];
  assert.ok(Math.abs(meta.avgCost - row10.runningAvgCost) <= 1e-6);
});

test("buildCompareTooltipHtml", () => {
  const sched = buildContinuousSchedule(P0, B, cases[0].steps);
  const html = buildCompareTooltipHtml(sched, P0, 10);
  assert.match(html, /连续路径/);
  assert.doesNotMatch(html, /拟合路径/);
  assert.match(html, /参考策略/);
  assert.match(html, /持股/);
  assert.match(html, /总成本/);
  assert.doesNotMatch(html, /拟合目标均价/);
  assert.doesNotMatch(html, /<td>现价<\/td>/);
  assert.match(html, /si-tip-title">90\.00 \(跌 10\.0%\)/);
  assert.match(html, /si-tip-table/);
  assert.match(html, /股 \(\+/);
});

test("buildFitAnnotationPoints", () => {
  const sched = buildContinuousSchedule(P0, B, cases[0].steps);
  const pts = buildFitAnnotationPoints(sched);
  assert.equal(pts.length, sched.rows.length);
  const k5 = pts.find((p) => p.x === 5);
  assert.ok(k5?.meta && k5.meta.cumulativeShares > 0);
});

test("buildFitBuyMarkers", () => {
  const sched = buildContinuousSchedule(P0, B, cases[0].steps);
  const markers = buildFitBuyMarkers(sched, P0);
  const buyDays = sched.rows
    .filter((r) => r.dropPct > 0 && r.incrementalSpent > 0)
    .map((r) => r.dropPct);
  assert.equal(markers.length, buyDays.length);
  for (const m of markers) {
    assert.ok(buyDays.includes(m.x), `unexpected marker at k=${m.x}`);
    const row = sched.rows.find((r) => r.dropPct === m.x);
    const ls = sched.avgCurve.targetAvgAtDrop(m.x);
    assert.ok(row && Math.abs(row.runningAvgCost - ls) < ALIGN_TOL);
    assert.ok(Math.abs(m.y - row.runningAvgCost) <= ACCT_EPS);
    assert.ok(m.meta && Math.abs(m.meta.avgCost - row.runningAvgCost) <= ACCT_EPS);
  }
  const idle = sched.rows.find((r) => r.incrementalSpent <= 0 && r.dropPct > 0);
  if (idle) {
    assert.ok(!markers.some((m) => m.x === idle.dropPct), `should not mark idle day k=${idle.dropPct}`);
  }
});

test("continuous floor row at 10.3%", () => {
  const steps = cases.find((c) => c.name === "40/20/20/20 @ 0/10/20/30").steps;
  const sched = buildContinuousSchedule(P0, B, steps);
  const dropPct = 10.3;
  const exec = continuousMetaAtDrop(sched.rows, P0, dropPct);
  const row10 = sched.rows[10];
  assert.ok(exec && row10);
  assert.ok(Math.abs(exec.avgCost - row10.runningAvgCost) <= 1e-6);
  const ls10 = sched.avgCurve.targetAvgAtDrop(10);
  assert.ok(Math.abs(exec.avgCost - ls10) < ALIGN_TOL);
  const html = buildCompareTooltipHtml(sched, P0, dropPct);
  assert.match(html, new RegExp(exec.avgCost.toFixed(2)));
  assert.doesNotMatch(html, /拟合目标均价/);
});

test("discrete tooltip no position avg before first trigger", () => {
  const sched = buildContinuousSchedule(P0, B, [{ weightPct: 100, dropPct: 10 }]);
  const html = buildCompareTooltipHtml(sched, P0, 5);
  const left = discreteMetaAtDrop(sched.discrete, P0, 5);
  assert.equal(left?.cumulativeShares, 0);
  assert.ok(!(left.avgCost > 0));
  assert.match(html, /均价<\/td><td>—/);
});

test("cumulativeSharesAtDrop at zero", () => {
  const sched = buildContinuousSchedule(P0, B, cases[0].steps);
  const row0 = sched.rows[0];
  if (row0.cumulativeShares <= 0) return;
  const target = cumulativeSharesAtDrop(sched, 0);
  assert.ok(Math.abs(target - row0.cumulativeShares) <= 1e-6);
});

test("first LS buy after bootstrap", () => {
  const sched = buildContinuousSchedule(P0, B, cases[0].steps);
  const row0 = sched.rows[0];
  if (!row0 || row0.incrementalSpent <= 0) return;
  const firstBuy = sched.rows.find((r) => r.dropPct > 0 && r.incrementalSpent > 0);
  assert.ok(firstBuy, "expected a buy toward LS after k=0 bootstrap");
  const ls = sched.avgCurve.targetAvgAtDrop(firstBuy.dropPct);
  assert.ok(Math.abs(firstBuy.runningAvgCost - ls) < ALIGN_TOL);
});

test("share knots 40/20/20/20", () => {
  const steps = cases.find((c) => c.name === "40/20/20/20 @ 0/10/20/30").steps;
  const sched = buildContinuousSchedule(P0, B, steps);
  const knots = buildShareKnots(sched.discrete.stepDetails);
  assert.equal(knots[0].dropPct, 0);
  assert.ok(knots[0].cumulativeShares > 0);
  assert.equal(knots.length, 4);
});

test("discreteMetaAtDrop matches manual", () => {
  const steps = cases.find((c) => c.name === "40/20/20/20 @ 0/10/20/30").steps;
  const sched = buildContinuousSchedule(P0, B, steps);
  const { stepDetails } = sched.discrete;
  for (const dropPct of [10, 13.2, 16.5]) {
    const meta = discreteMetaAtDrop(sched.discrete, P0, dropPct);
    const manual = manualDiscreteMetaAtDrop(stepDetails, P0, dropPct);
    assert.ok(meta);
    assert.ok(Math.abs(meta.cumulativeShares - manual.cumulativeShares) <= 1e-6);
    assert.ok(Math.abs(meta.cumulativeSpent - manual.cumulativeSpent) <= 1e-4);
    assert.ok(Math.abs(meta.avgCost - manual.avgCost) <= 1e-6);
    assert.ok(Math.abs(meta.pl - manual.pl) <= 1e-4);
  }
});

test("discreteMetaAtDrop rejects schedule rows", () => {
  const steps = cases.find((c) => c.name === "40/20/20/20 @ 0/10/20/30").steps;
  const sched = buildContinuousSchedule(P0, B, steps);
  assert.equal(discreteMetaAtDrop(sched.rows, P0, 16.5), null);
});

test("compare tooltip uses discrete only at 16.5%", () => {
  const steps = cases.find((c) => c.name === "40/20/20/20 @ 0/10/20/30").steps;
  const sched = buildContinuousSchedule(P0, B, steps);
  const dropPct = 16.5;
  const left = discreteMetaAtDrop(sched.discrete, P0, dropPct);
  const html = buildCompareTooltipHtml(sched, P0, dropPct);
  const cont = continuousMetaAtDrop(sched.rows, P0, dropPct);
  assert.ok(Math.abs(left.cumulativeShares - cont.cumulativeShares) >= 1);
  assert.match(html, new RegExp(formatShares(left.cumulativeShares)));
});

test("exports smoke", () => {
  assert.equal(typeof validateStrategy, "function");
  assert.equal(typeof buildContinuousSchedule, "function");
  assert.equal(typeof verifyScheduleAccounting, "function");
  assert.equal(typeof verifyMetaPl, "function");
});
