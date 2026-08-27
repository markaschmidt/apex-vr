import type { AgentPhase } from "../types.js";

/** Simple palette used by the procedural (no-asset) avatar fallback. */
export const PHASE_COLORS: Record<AgentPhase, string> = {
  idle: "#8b5cf6",
  listening: "#06b6d4",
  thinking: "#f59e0b",
  speaking: "#38bdf8",
  acting: "#ec4899",
  confirming: "#10b981",
  error: "#ef4444",
};

export interface ProceduralAvatarParams {
  phase: AgentPhase;
  /** Seconds; used for idle bob / think sway. */
  time: number;
}

export function proceduralMotion(params: ProceduralAvatarParams): {
  yOffset: number;
  yaw: number;
  color: string;
} {
  const { phase, time } = params;
  const color = PHASE_COLORS[phase];

  switch (phase) {
    case "listening":
      return { yOffset: Math.sin(time * 3.2) * 0.03, yaw: Math.sin(time * 1.4) * 0.12, color };
    case "thinking":
      return { yOffset: Math.sin(time * 1.6) * 0.02, yaw: Math.sin(time * 2.8) * 0.35, color };
    case "speaking":
      return { yOffset: Math.sin(time * 6.5) * 0.015, yaw: Math.sin(time * 2.1) * 0.08, color };
    case "acting":
      return { yOffset: Math.abs(Math.sin(time * 8)) * 0.04, yaw: time * 0.4, color };
    case "confirming":
      return { yOffset: Math.abs(Math.sin(time * 5)) * 0.06, yaw: Math.sin(time * 4) * 0.2, color };
    case "error":
      return { yOffset: Math.sin(time * 12) * 0.01, yaw: Math.sin(time * 9) * 0.25, color };
    default:
      return { yOffset: Math.sin(time * 2.2) * 0.04, yaw: Math.sin(time * 0.55) * 0.18, color };
  }
}
