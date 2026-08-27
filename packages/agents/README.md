# `@apex-vr/agents`

Reusable VR AI-agent primitives — the spatial counterpart to voice stacks like
[VocalBridge](https://vocalbridgeai.com).

This package standardizes:

1. **Agent lifecycle** — `idle → listening → thinking → speaking → acting → confirming`
2. **Transport-agnostic intents** — voice, hands, text, or network all become `AgentIntent`
3. **Avatar runtime contract** — procedural fallback now; VRM / Mixamo assets later
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

nova.setPhase("listening");
nova.say("I can rearrange those panes into a wall.");
nova.moveTo([1.5, 0, -2], [0, 1, -2]);
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
| `set_phase` | Drive lifecycle + default clip |
| `say` | Store utterance; optionally enter `speaking` |
| `move_to` | Walk/teleport toward a world point |
| `play_clip` | Force a named animation |
| `focus_target` | Point at a pane / object id |
| `set_busy` | Show work indicator + `work` clip (deferred while walking) |
| `custom` | App-specific extension point |

Validate with `AgentIntentSchema` before accepting network or voice payloads.

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

Logical clips include `work` for in-place busy animations. `move_to` sets
`locomotion` on the snapshot; call `controller.tickLocomotion(delta)` from your
render loop (handled automatically by `AgentNPC`).

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
