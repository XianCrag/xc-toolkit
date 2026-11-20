import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  touchProbability,
  formatPct,
  REFERENCE_ROWS,
  firstHitDensity,
  buildHitTimeCurve,
  triggerCountProbability,
  expectedTriggers,
  buildTriggerDistribution,
} from "./engine.js";

describe("touchProbability", () => {
  const expected = [
    [0.25, 0.5, 72.4],
    [0.25, 1, 80.3],
    [0.5, 0.5, 47.9],
    [0.5, 1, 61.7],
    [0.75, 0.5, 28.9],
    [0.75, 1, 45.3],
    [1, 0.5, 15.7],
    [1, 1, 31.7],
    [1.5, 0.5, 3.4],
    [1.5, 1, 13.4],
    [2, 0.5, 0.5],
    [2, 1, 4.6],
  ];

  for (const [k, T, pct] of expected) {
    it(`k=${k} T=${T} ≈ ${pct}%`, () => {
      const p = touchProbability(k, T) * 100;
      assert.ok(Math.abs(p - pct) < 0.15, `got ${p.toFixed(2)}`);
    });
  }

  it("k=0 → 100%", () => {
    assert.equal(touchProbability(0, 1), 1);
  });

  it("formatPct", () => {
    assert.equal(formatPct(0.317), "31.7%");
  });

  it("reference rows cover table", () => {
    assert.equal(REFERENCE_ROWS.length, 6);
  });

  it("firstHitDensity integrates roughly to CDF", () => {
    const k = 1;
    const curve = buildHitTimeCurve(k, 1, 400);
    let area = 0;
    for (let i = 1; i < curve.length; i++) {
      const dt = curve[i].t - curve[i - 1].t;
      area += 0.5 * (curve[i].density + curve[i - 1].density) * dt;
    }
    const cdf = touchProbability(k, 1);
    assert.ok(Math.abs(area - cdf) < 0.02, `area=${area} cdf=${cdf}`);
  });

  it("density peaks then falls for k>0", () => {
    const early = firstHitDensity(1, 0.05);
    const mid = firstHitDensity(1, 0.4);
    const late = firstHitDensity(1, 2);
    assert.ok(mid > early || mid > late);
    assert.ok(late < mid);
  });
});

describe("kσ ladder trigger distribution", () => {
  it("P(N ≥ 1) equals the 1y touch probability", () => {
    const k = 1;
    // P(N ≥ 1) = 1 − P(N = 0) = touch(k, 1)
    const pGe1 = 1 - triggerCountProbability(k, 1, 0);
    assert.ok(Math.abs(pGe1 - touchProbability(k, 1)) < 1e-9);
  });

  it("count probabilities are nested differences of touch()", () => {
    const k = 0.5;
    for (let n = 1; n <= 5; n++) {
      const expected = touchProbability(n * k, 1) - touchProbability((n + 1) * k, 1);
      assert.ok(Math.abs(triggerCountProbability(k, 1, n) - expected) < 1e-9);
    }
  });

  it("distribution bars (incl. overflow) sum to 1", () => {
    for (const k of [0.25, 0.5, 1, 1.5]) {
      const bars = buildTriggerDistribution(k, 1, 12);
      const total = bars.reduce((s, b) => s + b.p, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `k=${k} total=${total}`);
      assert.ok(bars.every((b) => b.p >= -1e-12));
    }
  });

  it("E[N] matches the tail-sum identity Σ P(N≥n)", () => {
    const k = 0.5;
    let tail = 0;
    for (let n = 1; n <= 2000; n++) tail += touchProbability(n * k, 1);
    assert.ok(Math.abs(expectedTriggers(k, 1) - tail) < 1e-4);
  });

  it("E[N] also equals Σ n·P(N=n)", () => {
    const k = 0.75;
    let mean = 0;
    for (let n = 1; n <= 4000; n++) mean += n * triggerCountProbability(k, 1, n);
    assert.ok(Math.abs(expectedTriggers(k, 1) - mean) < 1e-3, `mean=${mean}`);
  });

  it("closer targets trigger more often (monotone in 1/k)", () => {
    assert.ok(expectedTriggers(0.25, 1) > expectedTriggers(0.5, 1));
    assert.ok(expectedTriggers(0.5, 1) > expectedTriggers(1, 1));
    assert.ok(expectedTriggers(1, 1) > expectedTriggers(2, 1));
  });

  it("expected triggers at k=1σ ≈ 0.37/yr", () => {
    assert.ok(Math.abs(expectedTriggers(1, 1) - 0.366) < 0.01);
  });

  it("invalid inputs → NaN / empty", () => {
    assert.ok(Number.isNaN(expectedTriggers(0, 1)));
    assert.ok(Number.isNaN(triggerCountProbability(1, 1, -1)));
    assert.deepEqual(buildTriggerDistribution(0, 1, 5), []);
  });
});
