import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanSequencer } from "./PlanSequencer.js";
import type { NetworkPlanStep } from "./validate.js";

const steps: NetworkPlanStep[] = [
  {
    type: "attend",
    paneIds: ["a"],
    primaryPaneId: "a",
    cue: "immediate",
    stepId: "s1",
  },
  {
    type: "focus_target",
    targetId: "b",
    cue: "speech_start",
    stepId: "s2",
  },
];

test("PlanSequencer advances only after explicit advance()", () => {
  const sequencer = new PlanSequencer();
  sequencer.load("plan_1", 3, steps);
  assert.equal(sequencer.active, true);
  assert.equal(sequencer.current?.stepId, "s1");
  assert.equal(sequencer.beginWaitIfNeeded(8), null);
  assert.equal(sequencer.advance()?.stepId, "s2");
  assert.equal(sequencer.beginWaitIfNeeded(8), "speech_start");
  assert.equal(sequencer.tickCue(1), "waiting");
  assert.equal(sequencer.signalCue("speech_end"), false);
  assert.equal(sequencer.signalCue("speech_start"), true);
  assert.equal(sequencer.advance(), undefined);
  assert.equal(sequencer.drained, true);
});

test("PlanSequencer cue timeout does not hang", () => {
  const sequencer = new PlanSequencer();
  sequencer.load("plan_1", 1, [steps[1]!]);
  assert.equal(sequencer.beginWaitIfNeeded(0.2), "speech_start");
  assert.equal(sequencer.tickCue(0.1), "waiting");
  assert.equal(sequencer.tickCue(0.2), "timeout");
  assert.equal(sequencer.waitingCue, null);
});
