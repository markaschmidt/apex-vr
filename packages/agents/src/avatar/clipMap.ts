import type { AgentClip } from "../types.js";

/**
 * Canonical clip names → preferred Mixamo / glTF animation filenames.
 * Keep assets under public/avatars/animations/ in host apps.
 * Capability advertising must NOT read this map — only loaded mixer actions.
 */
export const DEFAULT_CLIP_ASSETS: Record<AgentClip, string> = {
  idle: "idle.fbx",
  listen: "idle_2.fbx",
  think: "Thinking.fbx",
  talk: "Talking.fbx",
  walk: "walking.fbx",
  work: "Working.fbx",
  point: "Pointing.fbx",
  celebrate: "dancing_2.fbx",
  error: "Disappointed.fbx",
  wave: "standard_greeting.fbx",
  nod: "head_nod_yes.fbx",
  present: "happy_hand_gesture.fbx",
};

/** glTF animation names commonly used in rigged models (case-insensitive match). */
export const GLTF_CLIP_ALIASES: Record<AgentClip, readonly string[]> = {
  idle: ["idle", "iddle", "Idle", "IDLE"],
  listen: ["listen", "listening", "Listening", "idle_2", "idle2"],
  think: ["think", "thinking", "Thinking"],
  talk: ["talk", "talking", "Talking", "hello"],
  walk: ["walk", "walking", "Walking", "walkstart", "walking_start"],
  work: ["work", "working", "grab", "attackwithhand"],
  point: ["point", "pointing", "Pointing"],
  celebrate: ["celebrate", "celebration", "dance", "dancing", "victory", "jump"],
  error: ["error", "disappointed", "sad"],
  wave: ["wave", "waving", "greeting", "standard_greeting"],
  nod: ["nod", "nodding", "headnod", "head_nod", "yes"],
  present: ["present", "presenting", "showcase", "show"],
};

export function resolveClipAsset(
  clip: AgentClip,
  overrides?: Partial<Record<AgentClip, string>>,
): string {
  return overrides?.[clip] ?? DEFAULT_CLIP_ASSETS[clip];
}

/** Pick an embedded glTF animation clip name for a logical agent clip. */
export function resolveGltfClipName(
  clip: AgentClip,
  availableNames: readonly string[],
  overrides?: Partial<Record<AgentClip, string>>,
): string | undefined {
  const override = overrides?.[clip];
  if (override) {
    const exact = availableNames.find(
      (name) => name.localeCompare(override, undefined, { sensitivity: "accent" }) === 0,
    );
    if (exact) return exact;
  }

  const aliases = GLTF_CLIP_ALIASES[clip];
  const lower = new Map(availableNames.map((name) => [name.toLowerCase(), name]));
  for (const alias of aliases) {
    const match = lower.get(alias.toLowerCase());
    if (match) return match;
  }
  return undefined;
}
