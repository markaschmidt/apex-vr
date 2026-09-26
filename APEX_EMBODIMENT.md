# APEX embodiment wire contract

Cross-repo format for Vektral ↔ Spatium ↔ `@apex-vr/agents` (`APEX-VR/packages/agents`).
This document is the wire contract. Runtime sequencing, locomotion, gaze, and
gestures live in `@apex-vr/agents` — there is no Spatium `packages/apex-vr-agents`
copy.

## Responsibility split

| Layer | Owns | Must not |
|-------|------|----------|
| **Vektral API** | Auth, pane validation, context TTL/revisions, robust coding model vs `EMBODIMENT_MODEL`, versioned semantic plans, receipts | `Vec3`, world transforms, bone names, frame-level motor control, HTTP inside APEX |
| **Robust reasoner/coder** | Conversation, screenshots (`image_refs`), repo, task progress | Direct NPC motors |
| **Lightweight planner** | Allowlisted `attend` / `focus_target` / capability-gated `gesture` hints | Coordinates, `move_to`, arbitrary methods |
| **`@apex-vr/agents`** | `AgentController`, named `PlanSequencer`, `AgentIntent`, `AgentSnapshot`, `AgentNPC`, presence, locomotion, gaze, gestures, `onPlanEvent` | Vektral credentials, SSE, scene layout, HTTP, VocalBridge event invention |
| **Spatium host** | WebXR input, `pane_id` → anchors (`standpointForPaneId`), forwarding plans/receipts, multi-user arbitration, preview containers | Re-implementing a second NPC controller; putting coordinates on the wire |

Local screen selection **always** submits `attend` immediately on the host. It
must not wait for either model or an API round trip.

APEX performs **no HTTP**. Preview iframe/WebView prepare, swap, crash, and
reload never enter APEX intents and must not reset locomotion, focus, gesture
generation, plan revision, or anchor identity. Only pane deletion invalidates
an anchor.

v1 locomotion is **attend-to-standpoint** (straight-line lerp, arrival 0.08).
There is no navmesh or collision in v1.

## Semantic intents (over the wire)

Backend and SSE payloads use snake_case envelopes. APEX consumes camelCase
`apex_intent` after `apexIntentFromWire`. `expiresAt`, `workspaceId`, and
`actorId` stay **required** on `execute_plan`.

### `attend` (semantic)

```json
{
  "type": "attend",
  "stepId": "s1",
  "cue": "immediate",
  "paneIds": ["pane_a", "pane_b"],
  "primaryPaneId": "pane_a",
  "phaseHint": "acting",
  "clipHint": "walk",
  "gazeHint": "primary",
  "speechHint": ""
}
```

Host resolves pane ids through the injected `AnchorResolver`. APEX orients,
navigates, and looks at the stand. `move_to` **never** appears on the Vektral
wire. Optional `stepId` / `cue` are additive; omit or use `immediate` until
VocalBridge playback events exist. Missing non-immediate cues time out — APEX
never invents `speech_start` / `speech_end`.

### `execute_plan` (versioned network plan)

```json
{
  "type": "execute_plan",
  "planId": "plan_…",
  "revision": 3,
  "expiresAt": "2026-09-20T09:22:00+00:00",
  "workspaceId": "ws_…",
  "actorId": "firebase-uid",
  "steps": [
    { "type": "attend", "paneIds": ["pane_a"], "primaryPaneId": "pane_a", "cue": "immediate" },
    { "type": "focus_target", "targetId": "pane_a", "cue": "immediate" }
  ]
}
```

Reject when: actor/workspace mismatch, any pane id fails to resolve, `revision`
is not newer than the last applied plan, `expiresAt` is past, or a step is not
allowlisted. Unknown actions become `blocked` (`unknown_action`). Unsupported
gestures become `blocked` (`unsupported_capability:gesture.<name>`) **before**
any movement. The named `PlanSequencer` inside `AgentController` advances only
on local arrival, mixer finish, `signalCue`, or cue timeout. Receipts are
observational and never gate the queue.

Network steps: `attend`, `focus_target`, and `gesture` (capability-gated).
Never emit `gesture` to a client that did not advertise `gesture.<name>`.

### Local-only primitives

`move_to`, `focus_target` (as a host primitive), `custom`, and presence APIs
stay in APEX. Spatium may apply them after anchor resolution. Vektral never
emits coordinates.

### Presence vs locomotion

`setListening` / `setThinking` / `setSpeaking` / `signalCue` do **not** abort
walks. `interrupt("user_override")` clears queue, locomotion, and gesture
atomically. Clip priority: active gesture > locomotion walk > presence phase >
idle/fidget.

### Gestures and gaze

Gestures require dedicated LoopOnce clips on the loaded mixer (`wave`, `nod`,
`point`, `present`). Never map `nod→idle` or `present→work`. Advertise
`controller.capabilities` from loaded `playback.actions`, never the Mixamo URL
map. `gaze.speaker` is advertised only when `vrm.lookAt.target` is wired.

## HTTP

| Method | Path | Purpose |
|--------|------|----------|
| PUT | `/api/workspaces/{id}/agent-context` | Debounced semantic focus (not continuous transforms) |
| GET | `/api/workspaces/{id}/embodiment/state` | Reconnect/bootstrap |
| POST | `/api/workspaces/{id}/embodiment/receipts` | `accepted` / `running` / `completed` / `blocked` / `cancelled` |

Context body: `client_revision`, `primary_pane_id`, ordered `focused_pane_ids`,
visibility + coarse `near|mid|far` / `front|left|right|behind`, NPC phase,
capabilities from APEX runtime, short-lived `image_refs` (no `data:` URLs),
`visible_text`.

Commands (`submit_command`, pane commands, `vocalbridge/query`) include
`context_revision`, `focused_pane_ids`, `primary_pane_id` so the reasoner is not
tied to a stale server snapshot. Chat focus (`active_chat_pane_id`) stays
separate from the preview focus set.

## SSE

Existing `workspace_update`, `job_update`, `pane_reload`, and `job_failed`
are unchanged. Additional events:

| `type` | When |
|--------|------|
| `embodiment_plan` | New plan `(planId, revision)` |
| `embodiment_cancel` | Plan cancelled or blocked |

Deduplicate command-response `embodiment_json` and SSE copies by
`(planId, revision)`. Plans carry `expires_at` so reconnecting clients drop
stale events. Events never include tokens, credentials, or unrestricted
client commands.

## Snapshots / Yjs

Replicate `planId`, `revision`, `phase`, `clip`, `locomotionSubstate`
(`orienting` | `navigating` | `attending`), `blockedReason`. Do **not**
replicate per-frame gaze, bone transforms, path samples, or `getGazeWorldPoint()`.

## Rollout

`EMBODIMENT_ENABLED` (default false):

1. APEX deterministic `attend` + Spatium adapter + Vektral context/receipts
2. Additive v2 sequencer (`avatar.plan.v2`) with `cue: immediate`
3. Gesture / `assistant_avatar` only after loaded LoopOnce clips + fixture parity
4. Lightweight planner (`EMBODIMENT_MODEL`)
5. Multimodal `image_refs` after privacy controls

Shared fixtures: [`fixtures/embodiment/`](fixtures/embodiment/) (checksums in
`checksums.json`).
