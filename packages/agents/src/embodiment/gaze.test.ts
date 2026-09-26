import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGazeWorldPoint, selectGazeTargetId } from "./gaze.js";
import { mapAnchorResolver } from "./anchors.js";

const resolve = mapAnchorResolver({
  pane_a: { position: [2, 0, -1], lookAt: [0, 1.4, -2] },
  pane_b: { position: [-2, 0, -1], lookAt: [0, 1.4, -3] },
});

test("gazeHint primary/cycle/speaker/none", () => {
  assert.equal(
    selectGazeTargetId({ hint: "primary", primaryPaneId: "pane_a" }),
    "pane_a",
  );
  assert.equal(
    selectGazeTargetId({
      hint: "cycle",
      cycleIds: ["pane_a", "pane_b"],
      cycleIndex: 1,
      primaryPaneId: "pane_a",
    }),
    "pane_b",
  );
  assert.equal(
    selectGazeTargetId({
      hint: "speaker",
      speakerTargetId: "user",
      primaryPaneId: "pane_a",
    }),
    "user",
  );
  assert.equal(selectGazeTargetId({ hint: "none", primaryPaneId: "pane_a" }), undefined);
});

test("gaze world points stay local to AnchorResolver", () => {
  assert.deepEqual(
    resolveGazeWorldPoint({
      hint: "primary",
      targetId: "pane_a",
      resolveAnchor: resolve,
    }),
    [0, 1.4, -2],
  );
  assert.equal(
    resolveGazeWorldPoint({ hint: "none", targetId: "pane_a", resolveAnchor: resolve }),
    undefined,
  );
  assert.deepEqual(
    resolveGazeWorldPoint({
      hint: "speaker",
      speakerLookAt: [0, 1.6, 0.4],
    }),
    [0, 1.6, 0.4],
  );
});
