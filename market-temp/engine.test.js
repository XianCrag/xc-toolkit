import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FACTORS,
  degreeScore,
  groupedFactors,
  normalizeDegree,
  pendulumAngle,
  scoreAssessment,
  temperatureZone,
} from "./engine.js";

describe("FACTORS", () => {
  it("has unique ids", () => {
    const ids = FACTORS.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("covers Marks checklist breadth", () => {
    assert.ok(FACTORS.length >= 20);
    const asks = new Set(FACTORS.map((f) => f.ask));
    assert.equal(asks.size, FACTORS.length, "each row needs a unique ask");
    for (const need of [
      "Economy",
      "Outlook",
      "Lenders",
      "Capital markets",
      "Interest rates",
      "Credit spreads",
      "Asset prices",
      "Prospective returns",
      "Risk in the market",
    ]) {
      assert.ok(asks.has(need), `missing ${need}`);
    }
  });

  it("groups in stable order", () => {
    const groups = groupedFactors().map((g) => g.group);
    assert.deepEqual(groups, [
      "Macro & Credit",
      "Investor Psychology",
      "Market Structure",
      "Prices & Risk",
      "Behavior & Mistakes",
    ]);
  });
});

describe("normalizeDegree / degreeScore", () => {
  it("maps legacy string choices", () => {
    assert.equal(normalizeDegree("left"), 2);
    assert.equal(normalizeDegree("right"), -2);
    assert.equal(normalizeDegree("neutral"), 0);
  });

  it("clamps continuous −2…+2", () => {
    assert.equal(normalizeDegree(2), 2);
    assert.equal(normalizeDegree(-1), -1);
    assert.equal(normalizeDegree(0), 0);
    assert.equal(normalizeDegree(1.37), 1.37);
    assert.equal(normalizeDegree(-0.42), -0.42);
    assert.equal(normalizeDegree(3), null);
    assert.equal(normalizeDegree(null), null);
  });

  it("scores relative to max", () => {
    assert.equal(degreeScore(2), 1);
    assert.equal(degreeScore(-2), -1);
    assert.equal(degreeScore(1), 0.5);
    assert.equal(degreeScore(0), 0);
    assert.equal(degreeScore(null), null);
  });
});

describe("scoreAssessment", () => {
  it("returns empty zone when unanswered", () => {
    const r = scoreAssessment({});
    assert.equal(r.answered, 0);
    assert.equal(r.temperature, null);
    assert.equal(r.zone.id, "empty");
  });

  it("scores all +2 as hot (+100)", () => {
    /** @type {Record<string, number>} */
    const answers = {};
    for (const f of FACTORS) answers[f.id] = 2;
    const r = scoreAssessment(answers);
    assert.equal(r.temperature, 100);
    assert.equal(r.left, FACTORS.length);
    assert.equal(r.zone.lean, "hot");
  });

  it("scores all −2 as cold (−100)", () => {
    /** @type {Record<string, number>} */
    const answers = {};
    for (const f of FACTORS) answers[f.id] = -2;
    const r = scoreAssessment(answers);
    assert.equal(r.temperature, -100);
    assert.equal(r.zone.lean, "cold");
  });

  it("averages continuous degrees", () => {
    const r = scoreAssessment({
      economy: 1.5,
      outlook: 0,
      lenders: -1.5,
    });
    assert.equal(r.answered, 3);
    assert.equal(r.sum, 0);
    assert.equal(r.temperature, 0);
    assert.equal(r.zone.lean, "neutral");
  });

  it("migrates legacy left/right strings", () => {
    const r = scoreAssessment({ economy: "left", outlook: "right" });
    assert.equal(r.answered, 2);
    assert.equal(r.temperature, 0);
  });
});

describe("temperatureZone", () => {
  it("classifies thresholds", () => {
    assert.equal(temperatureZone(null).id, "empty");
    assert.equal(temperatureZone(80).id, "hot");
    assert.equal(temperatureZone(30).id, "warm");
    assert.equal(temperatureZone(0).id, "neutral");
    assert.equal(temperatureZone(-30).id, "cool");
    assert.equal(temperatureZone(-80).id, "cold");
  });
});

describe("pendulumAngle", () => {
  it("maps temperature to ±60°", () => {
    assert.equal(pendulumAngle(null), 0);
    assert.equal(pendulumAngle(100), 60);
    assert.equal(pendulumAngle(-100), -60);
    assert.equal(pendulumAngle(50), 30);
    assert.equal(pendulumAngle(200), 60);
  });
});
