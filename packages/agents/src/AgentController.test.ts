import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentController } from "./controllers/index.js";

test("set_phase updates clip via default map", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
  });
  agent.setPhase("listening");
  assert.equal(agent.state.phase, "listening");
  assert.equal(agent.state.clip, "listen");
});

test("move_to sets locomotion target and enters acting", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
  });
  agent.moveTo([2, 0, -1], [0, 0, -1]);
  assert.equal(agent.state.phase, "acting");
  assert.equal(agent.state.clip, "walk");
  assert.deepEqual(agent.state.locomotion?.target, [2, 0, -1]);
  assert.deepEqual(agent.state.pose.position, [0, 0, 0]);
});

test("tickLocomotion advances toward target", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    walkSpeed: 10,
  });
  agent.moveTo([1, 0, 0]);
  agent.tickLocomotion(0.05);
  assert.ok(agent.state.pose.position[0] > 0);
});

test("tickLocomotion faces the walk target, not lookAt", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    walkSpeed: 1,
  });
  agent.moveTo([4, 0, 0], [4, 0, -4]);
  agent.tickLocomotion(0.05);
  assert.ok(agent.state.locomotion);
  assert.ok(Math.abs(agent.state.pose.rotationY - -Math.PI / 2) < 0.2);
});

test("a long hitch does not teleport to the destination in one tick", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    walkSpeed: 1.35,
  });
  agent.moveTo([8, 0, 0]);
  agent.tickLocomotion(5);
  assert.ok(agent.state.locomotion);
  assert.ok(agent.state.pose.position[0] < 1);
});

test("dispatch rejects invalid intents", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
  });
  assert.throws(() => agent.dispatch({ type: "nope" }));
});

test("standing after a walk returns to idle", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    walkSpeed: 20,
  });
  agent.moveTo([0.4, 0, 0]);
  assert.equal(agent.state.clip, "walk");
  for (let i = 0; i < 20; i += 1) agent.tickLocomotion(0.1);
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(agent.state.clip, "idle");
});

test("presence APIs do not abort locomotion", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
  });
  agent.moveTo([4, 0, -1]);
  agent.setListening();
  agent.setThinking();
  agent.setSpeaking();
  agent.setIdle();
  assert.ok(agent.state.locomotion);
  assert.equal(agent.state.clip, "walk");
  assert.equal(agent.state.presence, "idle");
  assert.equal(agent.state.phase, "acting");
});

test("set_phase listening does not clear an in-progress walk", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
  });
  agent.moveTo([3, 0, 0]);
  agent.setPhase("listening");
  assert.ok(agent.state.locomotion);
  assert.equal(agent.state.clip, "walk");
});

test("interrupt clears locomotion, gesture, and plan atomically", () => {
  const events: { status: string; reason?: string }[] = [];
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    onPlanEvent: (event) => events.push(event),
  });
  agent.moveTo([5, 0, 0]);
  agent.interrupt("user_override");
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(agent.state.gestureName, undefined);
  assert.equal(agent.state.planId, undefined);
  assert.equal(agent.state.clip, "idle");
  assert.ok(events.some((event) => event.status === "cancelled"));
});

test("stale mixer finish is ignored after a newer gesture generation", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
  });
  agent.reportLoadedPlayback({
    lookAt: false,
    clips: [
      { name: "idle", duration: 2, dedicatedLoopOnce: false },
      { name: "wave", duration: 1.1, dedicatedLoopOnce: true },
    ],
  });
  agent.playGesture("wave");
  const generation = agent.state.gestureGeneration;
  assert.equal(agent.state.clip, "wave");
  agent.notifyClipFinished((generation ?? 1) - 1);
  assert.equal(agent.state.gestureName, "wave");
  agent.notifyClipFinished(generation);
  assert.equal(agent.state.gestureName, undefined);
  assert.equal(agent.state.clip, "idle");
});

test("capabilities come from loaded playback, not Mixamo URLs", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
  });
  assert.ok(agent.capabilities.ids.includes("avatar.plan.v2"));
  assert.ok(agent.capabilities.ids.includes("locomotion.attend"));
  assert.equal(agent.capabilities.gestures.includes("wave"), false);
  assert.equal(agent.capabilities.ids.includes("gaze.speaker"), false);
  agent.reportLoadedPlayback({
    lookAt: true,
    clips: [
      { name: "idle", duration: 2, dedicatedLoopOnce: false },
      { name: "talk", duration: 2, dedicatedLoopOnce: false },
      { name: "wave", duration: 1, dedicatedLoopOnce: true },
      { name: "point", duration: 0.8, dedicatedLoopOnce: true },
    ],
  });
  assert.deepEqual([...agent.capabilities.gestures].sort(), ["point", "wave"]);
  assert.ok(agent.capabilities.ids.includes("gesture.wave"));
  assert.ok(agent.capabilities.ids.includes("gaze.speaker"));
  assert.equal(agent.capabilities.ids.includes("gesture.nod"), false);
  assert.equal(agent.capabilities.ids.includes("gesture.present"), false);
});

test("about-face uses orienting before navigating", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    walkSpeed: 1,
    turnSpeed: 1,
  });
  agent.moveTo([0, 0, 4]);
  assert.equal(agent.state.locomotionSubstate, "orienting");
  agent.tickLocomotion(0.05);
  assert.equal(agent.state.locomotionSubstate, "orienting");
  assert.ok(Math.abs(agent.state.pose.position[2]) < 0.01);
});
