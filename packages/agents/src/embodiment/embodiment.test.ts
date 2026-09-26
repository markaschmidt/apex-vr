import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentController } from "../controllers/index.js";
import { mapAnchorResolver } from "./anchors.js";
import { PlanBlockReason } from "./events.js";
import { apexIntentFromWire } from "./wire.js";
import type { AgentIntent } from "../types.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/embodiment",
);

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

test("embodiment fixtures match checksums.json", () => {
  const checksums = JSON.parse(
    readFileSync(join(fixtureDir, "checksums.json"), "utf8"),
  ) as { algorithm: string; files: Record<string, string> };
  assert.equal(checksums.algorithm, "sha256");
  for (const [file, expected] of Object.entries(checksums.files)) {
    const body = readFileSync(join(fixtureDir, file));
    const actual = createHash("sha256").update(body).digest("hex");
    assert.equal(actual, expected, file);
  }
});

const anchors = mapAnchorResolver({
  pane_a: { position: [2, 0, -1], lookAt: [0, 1, -2] },
  pane_b: { position: [-2, 0, -1], lookAt: [0, 1, -2] },
});

function controller(events: unknown[] = []) {
  return new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    resolveAnchor: anchors,
    workspaceId: "ws_1",
    actorId: "uid_1",
    walkSpeed: 10,
    onPlanEvent: (event) => {
      events.push(event);
    },
  });
}

test("attend resolves pane ids into local locomotion and focus", () => {
  const agent = controller();
  const intent = readFixture("attend.json") as AgentIntent;
  agent.dispatch(intent);
  assert.equal(agent.state.focusTargetId, "pane_a");
  assert.deepEqual(agent.state.secondaryFocusIds, ["pane_b"]);
  assert.equal(agent.state.locomotionSubstate, "navigating");
  assert.deepEqual(agent.state.locomotion?.target, [2, 0, -1]);
  assert.equal(agent.state.phase, "acting");
});

test("attend without resolver is blocked", () => {
  const events: { status: string; reason?: string }[] = [];
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    onPlanEvent: (event) => events.push(event),
  });
  agent.attend({ paneIds: ["pane_a"], primaryPaneId: "pane_a" });
  assert.equal(agent.state.blockedReason, PlanBlockReason.missingResolver);
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(events[0]?.status, "blocked");
});

test("unresolved pane does not move the agent", () => {
  const agent = controller();
  agent.attend({ paneIds: ["missing"], primaryPaneId: "missing" });
  assert.equal(agent.state.blockedReason, PlanBlockReason.unresolvedPane);
  assert.equal(agent.state.locomotion, undefined);
});

test("execute_plan applies attend and records revision", () => {
  const events: { status: string }[] = [];
  const agent = controller(events);
  agent.dispatch(readFixture("execute_plan.json"));
  assert.equal(agent.state.planId, "plan_ok");
  assert.equal(agent.state.revision, 3);
  assert.equal(agent.state.focusTargetId, "pane_a");
  assert.ok(events.some((event) => event.status === "accepted"));
  assert.ok(events.some((event) => event.status === "running"));
});

test("stale revision is blocked and does not retarget", () => {
  const agent = controller();
  agent.dispatch(readFixture("execute_plan.json"));
  agent.dispatch({
    type: "execute_plan",
    planId: "plan_later",
    revision: 1,
    expiresAt: "2099-01-01T00:00:00.000Z",
    workspaceId: "ws_1",
    actorId: "uid_1",
    steps: [{ type: "attend", paneIds: ["pane_b"], primaryPaneId: "pane_b" }],
  });
  assert.equal(agent.state.blockedReason, PlanBlockReason.staleRevision);
  assert.equal(agent.state.focusTargetId, "pane_a");
  assert.equal(agent.state.planId, "plan_ok");
});

test("expired plan is blocked", () => {
  const agent = controller();
  agent.dispatch(readFixture("expired_plan.json"));
  assert.equal(agent.state.blockedReason, PlanBlockReason.expiredPlan);
  assert.equal(agent.state.planId, undefined);
});

test("actor mismatch is blocked", () => {
  const agent = controller();
  agent.dispatch({
    type: "execute_plan",
    planId: "plan_other",
    revision: 1,
    expiresAt: "2099-01-01T00:00:00.000Z",
    workspaceId: "ws_1",
    actorId: "someone-else",
    steps: [{ type: "attend", paneIds: ["pane_a"], primaryPaneId: "pane_a" }],
  });
  assert.equal(agent.state.blockedReason, PlanBlockReason.actorMismatch);
});

test("unknown plan step is blocked and never marionettes", () => {
  const agent = controller();
  agent.dispatch(readFixture("unknown_action.json"));
  assert.equal(agent.state.blockedReason, PlanBlockReason.unknownAction);
  assert.equal(agent.state.locomotion, undefined);
  assert.deepEqual(agent.state.pose.position, [0, 0, 0]);
});

test("dispatchRemote rejects move_to from the wire", () => {
  const agent = controller();
  agent.dispatchRemote({ type: "move_to", position: [9, 0, 9] });
  assert.equal(agent.state.blockedReason, PlanBlockReason.unknownAction);
  assert.equal(agent.state.locomotion, undefined);
});

test("local attend cancels an in-flight plan", () => {
  const events: { status: string; reason?: string }[] = [];
  const agent = controller(events);
  agent.dispatch(readFixture("execute_plan.json"));
  events.length = 0;
  agent.attend({ paneIds: ["pane_b"], primaryPaneId: "pane_b" });
  assert.ok(events.some((event) => event.status === "cancelled"));
  assert.equal(agent.state.focusTargetId, "pane_b");
  assert.equal(agent.state.planId, undefined);
});

test("tickLocomotion emits completed on arrival", () => {
  const events: { status: string }[] = [];
  const agent = controller(events);
  agent.dispatch(readFixture("execute_plan.json"));
  for (let i = 0; i < 40; i += 1) agent.tickLocomotion(0.5);
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(agent.state.locomotionSubstate, "attending");
  assert.ok(events.some((event) => event.status === "completed"));
});

test("snake_case SSE envelope maps through dispatchWire", () => {
  const agent = controller();
  const intent = apexIntentFromWire(readFixture("execute_plan.wire.json"));
  assert.equal(intent?.type, "execute_plan");
  agent.dispatchWire(readFixture("execute_plan.wire.json"));
  assert.equal(agent.state.planId, "plan_wire");
  assert.equal(agent.state.revision, 4);
  assert.equal(agent.state.focusTargetId, "pane_a");
});

test("already at the stand pose attends immediately", () => {
  const events: { status: string }[] = [];
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    initialPose: { position: [2, 0, -1], rotationY: 0 },
    resolveAnchor: anchors,
    onPlanEvent: (event) => events.push(event),
  });
  agent.attend({ paneIds: ["pane_a"], primaryPaneId: "pane_a" });
  assert.equal(agent.state.locomotionSubstate, "attending");
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(agent.state.clip, "idle");
  assert.ok(events.some((event) => event.status === "completed"));
});

function reportWave(agent: AgentController) {
  agent.reportLoadedPlayback({
    lookAt: true,
    clips: [
      { name: "idle", duration: 2, dedicatedLoopOnce: false },
      { name: "walk", duration: 1, dedicatedLoopOnce: false },
      { name: "wave", duration: 0.9, dedicatedLoopOnce: true },
      { name: "point", duration: 0.7, dedicatedLoopOnce: true },
    ],
  });
}

test("v2 fixture attend then focus waits for arrival", () => {
  const events: { status: string; stepId?: string }[] = [];
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    resolveAnchor: mapAnchorResolver({
      pane_home: { position: [2, 0, -1], lookAt: [0, 1, -2] },
    }),
    workspaceId: "ws_fixture",
    actorId: "uid_fixture",
    walkSpeed: 10,
    onPlanEvent: (event) => events.push(event),
  });
  agent.dispatch(readFixture("apex_execute_plan_v2.json"));
  assert.equal(agent.state.planId, "plan_fixture_001");
  assert.equal(agent.state.focusTargetId, "pane_home");
  assert.ok(agent.state.locomotion);
  assert.equal(events.filter((event) => event.stepId === "s2").length, 0);
  for (let i = 0; i < 40; i += 1) agent.tickLocomotion(0.5);
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(agent.state.focusTargetId, "pane_home");
  assert.ok(events.some((event) => event.status === "completed"));
  assert.ok(events.some((event) => event.stepId === "s1"));
  assert.ok(events.some((event) => event.stepId === "s2"));
});

test("v2 snake_case aliases map through dispatchWire", () => {
  const agent = controller();
  agent.dispatchWire(readFixture("execute_plan_v2.wire.json"));
  assert.equal(agent.state.planId, "plan_v2_wire");
  assert.equal(agent.state.revision, 6);
  assert.equal(agent.state.focusTargetId, "pane_a");
});

test("unsupported gesture blocks the whole plan before movement", () => {
  const agent = controller();
  const start = agent.state.pose.position.slice();
  agent.dispatch(readFixture("execute_plan_v2_gesture.json"));
  assert.equal(agent.state.blockedReason, "unsupported_capability:gesture.wave");
  assert.equal(agent.state.locomotion, undefined);
  assert.deepEqual(agent.state.pose.position, start);
  assert.equal(agent.state.planId, undefined);
});

test("arrival then dedicated LoopOnce gesture then completion", () => {
  const events: { status: string; stepId?: string }[] = [];
  const agent = controller(events);
  reportWave(agent);
  agent.dispatch(readFixture("execute_plan_v2_gesture.json"));
  assert.ok(agent.state.locomotion);
  for (let i = 0; i < 80 && agent.state.locomotion; i += 1) agent.tick(0.05);
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(agent.state.gestureName, "wave");
  assert.equal(agent.state.clip, "wave");
  agent.notifyClipFinished(agent.state.gestureGeneration);
  assert.equal(agent.state.gestureName, undefined);
  assert.ok(events.some((event) => event.status === "completed"));
});

test("cued steps wait for signalCue and never invent VocalBridge events", () => {
  const events: { status: string; stepId?: string }[] = [];
  const agent = controller(events);
  agent.dispatch(readFixture("execute_plan_v2_cued.json"));
  for (let i = 0; i < 80 && agent.state.locomotion; i += 1) agent.tick(0.05);
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(agent.state.focusTargetId, "pane_a");
  assert.equal(agent.planSequencer.waitingCue, "speech_start");
  assert.equal(events.some((event) => event.status === "completed"), false);
  agent.signalCue("speech_end");
  assert.equal(agent.state.focusTargetId, "pane_a");
  agent.signalCue("speech_start");
  assert.equal(agent.state.focusTargetId, "pane_b");
  assert.ok(events.some((event) => event.status === "completed"));
});

test("missing cues time out and skip the remainder", () => {
  const events: { status: string; reason?: string }[] = [];
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    resolveAnchor: anchors,
    workspaceId: "ws_1",
    actorId: "uid_1",
    walkSpeed: 20,
    cueTimeoutMs: 80,
    onPlanEvent: (event) => events.push(event),
  });
  agent.dispatch(readFixture("execute_plan_v2_cued.json"));
  for (let i = 0; i < 40; i += 1) agent.tick(0.5);
  agent.tick(1);
  assert.equal(agent.state.blockedReason, PlanBlockReason.cueTimeout);
  assert.ok(events.some((event) => event.status === "blocked"));
  assert.equal(agent.planSequencer.active, false);
});

test("duplicate revision is a no-op", () => {
  const agent = controller();
  agent.dispatch(readFixture("execute_plan.json"));
  const pose = agent.state.pose.position.slice();
  agent.dispatch(readFixture("execute_plan.json"));
  assert.equal(agent.state.revision, 3);
  assert.deepEqual(agent.state.pose.position, pose);
});

test("destination timeout blocks and clears the remainder", () => {
  const events: { status: string; reason?: string }[] = [];
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    resolveAnchor: anchors,
    workspaceId: "ws_1",
    actorId: "uid_1",
    walkSpeed: 0.01,
    destinationTimeoutMs: 50,
    onPlanEvent: (event) => events.push(event),
  });
  agent.dispatch(readFixture("execute_plan.json"));
  agent.tick(1);
  assert.equal(agent.state.blockedReason, PlanBlockReason.destinationTimeout);
  assert.equal(agent.state.locomotion, undefined);
  assert.ok(events.some((event) => event.reason === PlanBlockReason.destinationTimeout));
});

test("listener exceptions do not stall sequencing", () => {
  const agent = new AgentController({
    identity: { id: "nova", displayName: "Nova" },
    resolveAnchor: anchors,
    workspaceId: "ws_1",
    actorId: "uid_1",
    walkSpeed: 20,
    onPlanEvent: () => {
      throw new Error("network 409");
    },
  });
  agent.dispatch(readFixture("execute_plan.json"));
  for (let i = 0; i < 40; i += 1) agent.tick(0.5);
  assert.equal(agent.state.locomotion, undefined);
  assert.equal(agent.state.locomotionSubstate, "attending");
});

test("barge-in interrupt cancels the plan queue", () => {
  const events: { status: string }[] = [];
  const agent = controller(events);
  agent.dispatch(readFixture("execute_plan.json"));
  events.length = 0;
  agent.interrupt("user_override");
  assert.ok(events.some((event) => event.status === "cancelled"));
  assert.equal(agent.state.planId, undefined);
  assert.equal(agent.state.locomotion, undefined);
});

test("preview prepare/swap/failure events do not reset motors or plan identity", () => {
  const agent = controller();
  agent.dispatch(readFixture("execute_plan.json"));
  const planId = agent.state.planId;
  const revision = agent.state.revision;
  const generation = agent.state.gestureGeneration;
  const focus = agent.state.focusTargetId;
  const locomotion = agent.state.locomotion?.target?.slice();
  agent.dispatch({ type: "custom", name: "preview_prepare", payload: { paneId: "pane_a" } });
  agent.dispatch({ type: "custom", name: "preview_swap", payload: { paneId: "pane_a" } });
  agent.dispatch({ type: "custom", name: "preview_failure", payload: { paneId: "pane_a" } });
  assert.equal(agent.state.planId, planId);
  assert.equal(agent.state.revision, revision);
  assert.equal(agent.state.gestureGeneration, generation);
  assert.equal(agent.state.focusTargetId, focus);
  assert.deepEqual(agent.state.locomotion?.target, locomotion);
});

test("workspace mismatch is blocked", () => {
  const agent = controller();
  agent.dispatch({
    type: "execute_plan",
    planId: "plan_ws",
    revision: 1,
    expiresAt: "2099-01-01T00:00:00.000Z",
    workspaceId: "other-ws",
    actorId: "uid_1",
    steps: [{ type: "attend", paneIds: ["pane_a"], primaryPaneId: "pane_a" }],
  });
  assert.equal(agent.state.blockedReason, PlanBlockReason.workspaceMismatch);
});

test("remote coordinates stay unknown_action", () => {
  const agent = controller();
  agent.dispatchRemote({
    type: "execute_plan",
    planId: "plan_xyz",
    revision: 1,
    expiresAt: "2099-01-01T00:00:00.000Z",
    workspaceId: "ws_1",
    actorId: "uid_1",
    steps: [{ type: "move_to", position: [9, 0, 9] }],
  });
  assert.equal(agent.state.blockedReason, PlanBlockReason.unknownAction);
  assert.equal(agent.state.locomotion, undefined);
});

test("nod and present never alias idle/work", () => {
  const agent = controller();
  agent.reportLoadedPlayback({
    lookAt: false,
    clips: [
      { name: "idle", duration: 2, dedicatedLoopOnce: false },
      { name: "work", duration: 2, dedicatedLoopOnce: false },
    ],
  });
  agent.dispatch({
    type: "execute_plan",
    planId: "plan_nod",
    revision: 11,
    expiresAt: "2099-01-01T00:00:00.000Z",
    workspaceId: "ws_1",
    actorId: "uid_1",
    steps: [{ type: "gesture", gesture: "nod" }],
  });
  assert.equal(agent.state.blockedReason, "unsupported_capability:gesture.nod");
});
