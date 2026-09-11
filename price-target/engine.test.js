import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  touchProbability,
  formatPct,
  REFERENCE_ROWS,
  firstHitDensity,
  buildHitTimeCurve,
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
