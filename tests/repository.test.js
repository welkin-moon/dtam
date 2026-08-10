import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { gunzipSync } from "node:zlib";

function frontendSource() {
  const base64 = [1, 2, 3, 4]
    .map((part) => readFileSync(`src/game.b64.${String(part).padStart(3, "0")}`, "utf8"))
    .join("")
    .replace(/\s/gu, "");
  return gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
}

test("encoded Pages client is valid JavaScript and uses challenge tasks", () => {
  const source = frontendSource();
  assert.doesNotThrow(() => new Script(source, { filename: "game.js" }));
  assert.match(source, /task_begin/u);
  assert.match(source, /task_complete/u);
  assert.doesNotMatch(source, /\bt\s*:\s*["']task["']/u);
});

test("Worker keeps protocol abuse regressions disabled", () => {
  const source = readFileSync("worker/src/index.js", "utf8");
  assert.doesNotMatch(source, /completeLegacyTask/u);
  assert.match(source, /legacy_task_disabled/u);
  assert.match(source, /MAX_WS_MESSAGE_BYTES/u);
  assert.match(source, /pathHitsWall\(player\.pos,target/u);
});
