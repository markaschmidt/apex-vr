import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D,
} from "three";
import type { AgentClip } from "../types.js";
import { novaLocoLog } from "../debug/locoLog.js";
import { resolveGltfClipName } from "./clipMap.js";

export interface RiggedAvatarPlayback {
  mixer: AnimationMixer;
  actions: Map<AgentClip, AnimationAction>;
  root: Object3D;
}

const CROSSFADE_SEC = 0.25;

export const RIGGED_CLIP_KINDS: AgentClip[] = [
  "idle",
  "listen",
  "think",
  "talk",
  "walk",
  "work",
  "point",
  "celebrate",
  "error",
  "wave",
  "nod",
  "present",
];

const LOOP_REPEAT_CLIPS = new Set<AgentClip>([
  "idle",
  "listen",
  "think",
  "talk",
  "walk",
  "work",
  "celebrate",
]);

/** Build a clip → action map from loaded glTF animations. */
export function createRiggedPlayback(
  root: Object3D,
  clips: AnimationClip[],
  clipOverrides?: Partial<Record<AgentClip, string>>,
): RiggedAvatarPlayback {
  const mixer = new AnimationMixer(root);
  const names = clips.map((clip) => clip.name);
  const actions = new Map<AgentClip, AnimationAction>();

  for (const kind of RIGGED_CLIP_KINDS) {
    const gltfName = resolveGltfClipName(kind, names, clipOverrides);
    if (!gltfName) continue;
    const source = clips.find((clip) => clip.name === gltfName);
    if (!source) continue;
    actions.set(kind, mixer.clipAction(source));
  }

  return { mixer, actions, root };
}

/** Build playback from a pre-retargeted AgentClip → AnimationClip map (e.g. Mixamo). */
export function createRiggedPlaybackFromClips(
  root: Object3D,
  clips: Partial<Record<AgentClip, AnimationClip>>,
): RiggedAvatarPlayback {
  const mixer = new AnimationMixer(root);
  const actions = new Map<AgentClip, AnimationAction>();
  for (const [kind, clip] of Object.entries(clips) as Array<
    [AgentClip, AnimationClip | undefined]
  >) {
    if (!clip) continue;
    actions.set(kind, mixer.clipAction(clip));
  }
  return { mixer, actions, root };
}

export type PlayRiggedClipOptions = {
  /** When false, missing clips return null instead of idle. Gestures must not idle-fallback. */
  fallbackIdle?: boolean;
  /** Force LoopOnce (one-shot gesture over a clip that is LoopRepeat for presence). */
  loopOnce?: boolean;
};

/** Crossfade to a logical clip; missing clips fall back to idle unless disabled. */
export function playRiggedClip(
  playback: RiggedAvatarPlayback,
  clip: AgentClip,
  current?: AnimationAction | null,
  options?: PlayRiggedClipOptions,
): AnimationAction | null {
  const fallback = options?.fallbackIdle !== false;
  const mapped = playback.actions.get(clip);
  if (!mapped && clip !== "idle") {
    novaLocoLog("clip.missing", {
      requested: clip,
      fallbackIdle: fallback,
      loaded: [...playback.actions.keys()],
    });
  }
  const next =
    mapped ??
    (fallback ? playback.actions.get("idle") : undefined) ??
    null;
  if (!next) return current ?? null;

  if (current && current !== next) {
    current.fadeOut(CROSSFADE_SEC);
  }

  if (current !== next) {
    next.reset().fadeIn(CROSSFADE_SEC).play();
  }

  const oneShot = options?.loopOnce === true || !LOOP_REPEAT_CLIPS.has(clip);
  if (oneShot) {
    next.setLoop(LoopOnce, 1);
    next.clampWhenFinished = true;
  } else {
    next.setLoop(LoopRepeat, Infinity);
  }

  return next;
}

/**
 * Secondary Mixamo idle (`listen` / idle_2) played once after a long stand.
 * Mixer emits `finished` so the caller can return to looping `idle`.
 */
export function playStandingFidget(
  playback: RiggedAvatarPlayback,
  current?: AnimationAction | null,
): AnimationAction | null {
  const fidget = playback.actions.get("listen");
  if (!fidget) return current ?? null;
  if (current && current !== fidget) {
    current.fadeOut(CROSSFADE_SEC);
  }
  fidget.reset().setLoop(LoopOnce, 1);
  fidget.clampWhenFinished = true;
  fidget.fadeIn(CROSSFADE_SEC).play();
  return fidget;
}
