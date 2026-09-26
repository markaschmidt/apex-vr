# `@apex-vr/agents`

Reusable VR AI-agent primitives — the spatial counterpart to voice stacks like
[VocalBridge](https://vocalbridgeai.com).

This package standardizes:

1. **Agent lifecycle** — `idle → listening → thinking → speaking → acting → confirming`
2. **Transport-agnostic intents** — voice, hands, text, or network all become `AgentIntent`
3. **Avatar runtime contract** — procedural fallback, VRM / Mixamo when loaded, capability reporting from mixer actions
4. **Model routing** — OpenRouter today, Jac byLLM or local models tomorrow

Rendering and voice stay outside the controller. Host apps (SpatiumVR, demos,
other WebXR products) subscribe to snapshots and draw whatever they want.

## Install

```bash
pnpm add @apex-vr/agents three @react-three/fiber @react-three/drei
```

Until published, link from a monorepo:

```bash
pnpm add @apex-vr/agents@workspace:*
```

## Quick start

```ts
import { AgentController } from "@apex-vr/agents";

const nova = new AgentController({
  identity: { id: "nova", displayName: "Nova" },
  initialPose: { position: [0, 0, 0.25], rotationY: 0 },
});

nova.subscribe((state) => {
  console.log(state.phase, state.clip, state.pose.position);
});

nova.setListening();
nova.say("I can rearrange those panes into a wall.");
nova.moveTo([1.5, 0, -2], [0, 1, -2]);
nova.interrupt("user_override");
```

### React Three Fiber

```tsx
import { Canvas } from "@react-three/fiber";
import { AgentController } from "@apex-vr/agents";
import { AgentNPC } from "@apex-vr/agents/react";

const nova = new AgentController({
  identity: { id: "nova", displayName: "Nova" },
});

export function Scene() {
  return (
    <Canvas>
      <AgentNPC controller={nova} />
    </Canvas>
  );
}
```

### Model routing (OpenRouter)

Keep keys server-side. The browser should never hold the OpenRouter secret.

```ts
import { ModelRouter, OpenRouterProvider } from "@apex-vr/agents";

const models = new ModelRouter();
models.register(
  new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY! }),
  true,
);

const reply = await models.complete({
  model: "openai/gpt-4.1-mini",
  messages: [
    { role: "system", content: "You are Nova, a concise VR coding teammate." },
    { role: "user", content: "Make checkout feel more trustworthy." },
  ],
});
```

## Intent surface

| Intent | Purpose |
| --- | --- |
| `set_phase` | Drive lifecycle + default clip (does not abort walks for presence phases) |
| `say` | Store utterance; optionally enter `speaking` without cancelling locomotion |
| `attend` | Semantic focus: pane ids in, anchors resolved by the host |
| `execute_plan` | Versioned network plan (`attend` / `focus_target` / capability-gated `gesture`) |
| `cancel_plan` | Drop in-flight plan + locomotion + gesture |
| `move_to` | Local walk toward a world point (never on the Vektral wire) |
| `play_clip` | Force a named animation |
| `focus_target` | Point at a pane / object id |
| `gesture` | Local one-shot if a dedicated LoopOnce clip is loaded |
| `set_busy` | Show work indicator + `work` clip (deferred while walking) |
| `custom` | App-specific extension point (preview reload events must be no-ops) |

Presence helpers (do **not** abort locomotion): `setListening`, `setThinking`,
`setSpeaking`. Barge-in: `interrupt("user_override")`. Cues: `signalCue("speech_start" | "speech_end")` from the host only — APEX never invents VocalBridge events. Missing cues time out.

Validate with `AgentIntentSchema` before accepting network or voice payloads.

Local screen selection should call `attend` (or `dispatch({ type: "attend", … })`) immediately. Do not wait on a model or HTTP round trip.

A named `PlanSequencer` inside `AgentController` runs multi-step plans. It is
not a second controller. Steps advance on local arrival, mixer `finished`
(`notifyClipFinished(generation)`), `signalCue`, or cue timeout. Receipts are
observational and cannot stall the queue.

`execute_plan` keeps `expiresAt`, `workspaceId`, and `actorId` required. v2
fields (`stepId`, `cue`, `gesture`) are additive. Advertise
`controller.capabilities` from loaded playback — never Mixamo URL maps. Do not
send `gesture` steps unless the client advertised `gesture.<name>`.

## Embodiment (semantic plans)

Vektral never sends world coordinates. The host injects an anchor resolver; APEX turns pane ids into local `move_to` + `focus_target`. A `PlanSequencer` inside the controller runs the queue. Receipts go out through `onPlanEvent` — the library does not call the API.

```ts
import {
  AgentController,
  apexIntentFromWire,
  mapAnchorResolver,
} from "@apex-vr/agents";

const nova = new AgentController({
  identity: { id: "nova", displayName: "Nova" },
  workspaceId: "ws_1",
  actorId: "firebase-uid",
  resolveAnchor: (paneId) => {
    const stand = standpointForPaneId(paneId, paneIds, layout);
    return stand ? { paneId, ...stand } : null;
  },
  onPlanEvent: (event) => {
    void postEmbodimentReceipt(workspaceId, event);
  },
});

// Local focus — must not wait for Vektral.
nova.attend({ paneIds: [paneId], primaryPaneId: paneId });

// SSE / command-response (snake_case or camelCase).
nova.dispatchWire(sseEvent);

// Host presence (does not abort a walk).
nova.setListening();
nova.signalCue("speech_start"); // only when VocalBridge actually emits it
```

| Intent | Who may send it |
| --- | --- |
| `attend` | Host (always) and Vektral plans |
| `execute_plan` / `cancel_plan` | Vektral (versioned, expiring) |
| `gesture` | Vektral plans only when `gesture.<name>` is advertised |
| `move_to`, `focus_target`, `custom` | Host only, after anchors resolve |

`dispatchRemote` / `dispatchWire` reject `move_to` as `unknown_action`. Snapshot fields `planId`, `revision`, `locomotionSubstate`, and `blockedReason` are the Yjs sync unit — not per-frame gaze (`getGazeWorldPoint()` is local).

v1 locomotion is attend-to-standpoint (arrival threshold 0.08). There is no navmesh.

See [`APEX_EMBODIMENT.md`](../../APEX_EMBODIMENT.md) and [`fixtures/embodiment/`](../../fixtures/embodiment/).

## Avatars

**Procedural fallback:** capsule avatar when `identity.avatarUrl` is omitted or fails to load.

**Rigged glTF / GLB:** set `identity.avatarUrl` and optionally pass `clipOverrides`
to `AgentNPC`. Clips resolve through `GLTF_CLIP_ALIASES` / `resolveGltfClipName`.

```ts
import { AgentController } from "@apex-vr/agents";
import { AgentNPC } from "@apex-vr/agents/react";

const agent = new AgentController({
  identity: {
    id: "guide",
    displayName: "Guide",
    avatarUrl: "/avatars/robot.gltf",
  },
  initialPose: { position: [0, -0.45, 0.25], rotationY: 0 },
});

// Walk toward a world point; AgentNPC interpolates and plays walk/work clips.
agent.moveTo([2, 0, -1], [0, 1.2, -2]);
agent.setBusy(true, "Updating…");
```

`AgentNPC` props:

| Prop | Purpose |
| --- | --- |
| `clipOverrides` | Map logical clips (`idle`, `walk`, `work`, …) to embedded glTF names |
| `avatarScale` | Uniform scale from model units to scene units (default `0.26`) |
| `workIndicatorHeight` | Badge height above the agent root |

Logical clips include `work` for in-place busy animations and additive
`wave` / `nod` / `present` one-shots. `move_to` sets `locomotion` on the
snapshot; call `controller.tick(delta)` from your render loop (handled
automatically by `AgentNPC`). Gesture capabilities are reported only when the
loaded mixer has a dedicated LoopOnce clip — idle/work aliases are never
advertised.

Meshes call `controller.reportLoadedPlayback(...)` and
`controller.notifyClipFinished(generation)`. Stale mixer events after
crossfade/interrupt are ignored. VRM gaze uses `vrm.lookAt.target` toward a
locally resolved pane/user; `gaze.speaker` is advertised only when that path
is wired.

**Mixamo / VRM path (optional):**

1. Export a [VRM](https://vrm.dev/) humanoid (VRoid / Ready Player Me → VRM).
2. Grab Mixamo clips: Idle, Talking, Walking, Pointing.
3. Retarget with `@pixiv/three-vrm` + `vrm-mixamo-retarget`.
4. Map filenames through `DEFAULT_CLIP_ASSETS` / `resolveClipAsset`.

GMod / Source models are possible but higher friction (license + retarget). Prefer
VRM or embedded glTF clips for an open-source library default.

## Design rules

- Controllers never import WebXR session APIs — scenes own input.
- Voice SDKs convert speech → `AgentIntent`; they do not mutate meshes.
- Dangerous side effects (git write, deploy) stay in the host approval layer.
- Keep comments rare; put durable knowledge in this README and typed names.

## Scripts

```bash
pnpm --filter @apex-vr/agents check
pnpm --filter @apex-vr/agents test
pnpm --filter @apex-vr/agents build
```
