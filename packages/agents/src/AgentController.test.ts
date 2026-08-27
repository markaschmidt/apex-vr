import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentController } from "./AgentController.js";

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

test("dispatch rejects invalid intents", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
  });
  assert.throws(() => agent.dispatch({ type: "nope" }));
});
