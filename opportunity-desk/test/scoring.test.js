import { test } from "node:test";
import assert from "node:assert/strict";
import { derive, verdictFor } from "../public/scoring.js";

test("score combines fit, value and risk with 40/35/25 weights", () => {
  const o = derive({
    valueScore: 80,
    products: [{ n: "A", f: 90 }, { n: "B", f: 60 }],
    risks: [{ c: "Tech", l: "M" }, { c: "Budget", l: "L" }],
  });
  assert.equal(o.fit, 90);
  assert.equal(o.risk, 20);
  assert.equal(o.score, Math.round(90 * 0.4 + 80 * 0.35 + 80 * 0.25)); // 84
  assert.equal(o.verdict, "Go");
});

test("verdict thresholds", () => {
  assert.equal(verdictFor(70), "Go");
  assert.equal(verdictFor(69), "Qualify");
  assert.equal(verdictFor(55), "Qualify");
  assert.equal(verdictFor(54), "No-go");
});

test("risk is capped at 100 and bad input is normalised", () => {
  const o = derive({ valueScore: "x", risks: Array(5).fill({ l: "high" }), products: [{ n: "", f: 99 }] });
  assert.equal(o.risk, 100);
  assert.equal(o.fit, 0);
  assert.equal(o.valueScore, 0);
  assert.equal(o.verdict, "No-go");
});
