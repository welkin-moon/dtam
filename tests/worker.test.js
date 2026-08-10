import test from "node:test";
import assert from "node:assert/strict";
import { circleHitsWall, pathHitsWall } from "../worker/src/index.js";

test("movement validation catches paths that cross a wall", () => {
  const from = { x: 24.5, y: 2.5 };
  const to = { x: 26.5, y: 2.5 };
  assert.equal(circleHitsWall(from.x, from.y), false);
  assert.equal(circleHitsWall(to.x, to.y), false);
  assert.equal(pathHitsWall(from, to), true);
});

test("movement validation permits an unobstructed short path", () => {
  assert.equal(pathHitsWall({ x: 10.5, y: 10.5 }, { x: 11.5, y: 10.5 }), false);
});
