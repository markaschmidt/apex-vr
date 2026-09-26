/**
 * Browser locomotion diagnostics. Silence with localStorage nova-loco-debug=0.
 * Pose ticks are not logged; only attend/cancel/clip/VRM lifecycle.
 */
export function novaLocoLog(event: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage?.getItem("nova-loco-debug") === "0") return;
  } catch {
    /* private mode */
  }
  console.info(`[nova-loco] ${event}`, detail ?? "");
}
