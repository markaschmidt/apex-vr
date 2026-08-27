import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D,
} from "three";
import type { AgentClip } from "../types.js";
import { resolveGltfClipName } from "./clipMap.js";

export interface RiggedAvatarPlayback {
  mixer: AnimationMixer;
  actions: Map<AgentClip, AnimationAction>;
  root: Object3D;
}

const CROSSFADE_SEC = 0.25;

/** Build a clip → action map from loaded glTF animations. */
export function createRiggedPlayback(
  root: Object3D,
  clips: AnimationClip[],
  clipOverrides?: Partial<Record<AgentClip, string>>,
): RiggedAvatarPlayback {
  const mixer = new AnimationMixer(root);
  const names = clips.map((clip) => clip.name);
  const actions = new Map<AgentClip, AnimationAction>();

  const clipKinds: AgentClip[] = [
    "idle",
    "listen",
    "think",
    "talk",
    "walk",
    "work",
    "point",
    "celebrate",
    "error",
  ];

  for (const kind of clipKinds) {
    const gltfName = resolveGltfClipName(kind, names, clipOverrides);
    if (!gltfName) continue;
    const source = clips.find((clip) => clip.name === gltfName);
    if (!source) continue;
    actions.set(kind, mixer.clipAction(source));
  }

  return { mixer, actions, root };
}

/** Crossfade to a logical clip; no-op when the action is missing. */
export function playRiggedClip(
  playback: RiggedAvatarPlayback,
  clip: AgentClip,
  current?: AnimationAction | null,
): AnimationAction | null {
  const next = playback.actions.get(clip);
  if (!next) return current ?? null;

  if (current && current !== next) {
    current.fadeOut(CROSSFADE_SEC);
  }

  next.reset().fadeIn(CROSSFADE_SEC).play();

  if (clip === "walk") {
    next.setLoop(LoopRepeat, Infinity);
  } else if (clip === "idle" || clip === "work" || clip === "listen" || clip === "think") {
    next.setLoop(LoopRepeat, Infinity);
  } else {
    next.setLoop(LoopOnce, 1);
    next.clampWhenFinished = true;
  }

  return next;
}
