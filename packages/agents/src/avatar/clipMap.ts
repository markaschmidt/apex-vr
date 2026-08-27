import type { AgentClip } from "../types.js";

/**
 * Canonical clip names → preferred Mixamo / glTF animation filenames.
 * Keep assets under public/avatars/animations/ in host apps.
 */
export const DEFAULT_CLIP_ASSETS: Record<AgentClip, string> = {
  idle: "Idle.fbx",
  listen: "Listening.fbx",
  think: "Thinking.fbx",
  talk: "Talking.fbx",
  walk: "Walking.fbx",
  work: "Working.fbx",
  point: "Pointing.fbx",
  celebrate: "Celebration.fbx",
  error: "Disappointed.fbx",
};

/** glTF animation names commonly used in rigged models (case-insensitive match). */
export const GLTF_CLIP_ALIASES: Record<AgentClip, readonly string[]> = {
  idle: ["idle", "iddle", "Idle", "IDLE"],
  listen: ["listen", "listening", "Listening"],
  think: ["think", "thinking", "Thinking"],
  talk: ["talk", "talking", "Talking", "hello"],
  walk: ["walk", "walking", "Walking", "walkstart"],
  work: ["work", "working", "grab", "attackwithhand"],
  point: ["point", "pointing", "Pointing"],
  celebrate: ["celebrate", "celebration", "hello", "jump"],
  error: ["error", "disappointed", "sad"],
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
