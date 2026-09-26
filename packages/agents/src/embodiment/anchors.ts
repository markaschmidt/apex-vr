import type { Vec3 } from "../types.js";

/** Host-resolved stand pose for a pane. World units stay off the Vektral wire. */
export interface PaneAnchor {
  paneId: string;
  position: Vec3;
  lookAt?: Vec3;
}

/**
 * Spatium (or any host) injects this. Typical adapter:
 * `standpointForPaneId(paneId, …)` → `{ paneId, position, lookAt }`.
 */
export type AnchorResolver = (paneId: string) => PaneAnchor | null | undefined;

/** Test/host helper: static pane_id → stand pose. */
export function mapAnchorResolver(
  anchors: Record<string, Pick<PaneAnchor, "position" | "lookAt">>,
): AnchorResolver {
  return (paneId) => {
    const found = anchors[paneId];
    if (!found) return null;
    return { paneId, position: found.position, lookAt: found.lookAt };
  };
}
