import type { AgentClip, AgentPhase, AgentSnapshot, PresencePhase, Vec3 } from "../types.js";
import { novaLocoLog } from "../debug/locoLog.js";
import type { ActiveGesture } from "./types.js";
import {
  ARRIVAL_THRESHOLD,
  ORIENT_THRESHOLD,
  clipForStanding,
  deriveClip,
  shortestAngle,
  yawToward,
} from "./utils.js";

export function beginLocomotion(input: {
  next: AgentSnapshot;
  position: Vec3;
  lookAt: Vec3 | undefined;
}): { arrived: boolean; locomotionElapsedSec: number } {
  const { next, position, lookAt } = input;
  const [x, , z] = next.pose.position;
  const dist = Math.hypot(position[0] - x, position[2] - z);
  novaLocoLog("controller.beginLocomotion", {
    from: next.pose.position,
    to: position,
    dist,
    snapArrive: dist <= ARRIVAL_THRESHOLD,
    clip: next.clip,
    substate: next.locomotionSubstate,
  });
  if (dist <= ARRIVAL_THRESHOLD) {
    next.pose = {
      position,
      rotationY: lookAt ? yawToward(position, lookAt) : next.pose.rotationY,
    };
    next.locomotion = undefined;
    next.locomotionSubstate = "attending";
    return { arrived: true, locomotionElapsedSec: 0 };
  }
  const desiredYaw = yawToward(next.pose.position, position);
  const yawError = shortestAngle(next.pose.rotationY, desiredYaw);
  next.locomotion = { target: position, lookAt };
  next.locomotionSubstate =
    Math.abs(yawError) > ORIENT_THRESHOLD ? "orienting" : "navigating";
  return { arrived: false, locomotionElapsedSec: 0 };
}

export type LocomotionStep =
  | { kind: "timeout" }
  | { kind: "none" }
  | {
      kind: "moved";
      snapshot: AgentSnapshot;
      arrived: boolean;
      locomotionElapsedSec: number;
    };

export function stepLocomotion(input: {
  snapshot: AgentSnapshot;
  moveDt: number;
  clockDt: number;
  locomotionElapsedSec: number;
  destinationTimeoutMs?: number;
  walkSpeed: number;
  turnSpeed: number;
  activeGesture: ActiveGesture | null;
  presence: PresencePhase;
  phaseClips: Record<AgentPhase, AgentClip>;
}): LocomotionStep {
  const { snapshot, moveDt, walkSpeed, turnSpeed, activeGesture, presence, phaseClips } =
    input;
  const { locomotion, pose } = snapshot;
  if (!locomotion) return { kind: "none" };

  const locomotionElapsedSec = input.locomotionElapsedSec + input.clockDt;
  if (
    input.destinationTimeoutMs &&
    locomotionElapsedSec * 1000 > input.destinationTimeoutMs
  ) {
    return { kind: "timeout" };
  }

  const clipArgs = { activeGesture, presence, phaseClips };
  const [tx, ty, tz] = locomotion.target;
  const [x, , z] = pose.position;
  const dx = tx - x;
  const dz = tz - z;
  const dist = Math.hypot(dx, dz);
  const walkYaw = yawToward(pose.position, [tx, ty, tz]);

  if (snapshot.locomotionSubstate === "orienting") {
    const yawError = shortestAngle(pose.rotationY, walkYaw);
    const maxTurn = turnSpeed * moveDt;
    if (Math.abs(yawError) > ORIENT_THRESHOLD && Math.abs(yawError) > maxTurn) {
      const next: AgentSnapshot = {
        ...snapshot,
        pose: {
          ...pose,
          rotationY: pose.rotationY + Math.sign(yawError) * maxTurn,
        },
        updatedAt: Date.now(),
      };
      next.clip = deriveClip({ next, ...clipArgs });
      return { kind: "moved", snapshot: next, arrived: false, locomotionElapsedSec };
    }
  }

  if (dist <= ARRIVAL_THRESHOLD) {
    const rotationY = locomotion.lookAt
      ? yawToward([tx, ty, tz], locomotion.lookAt)
      : pose.rotationY;
    const next: AgentSnapshot = {
      ...snapshot,
      pose: { position: [tx, ty, tz], rotationY },
      locomotion: undefined,
      locomotionSubstate: "attending",
      updatedAt: Date.now(),
    };
    next.clip = clipForStanding({ next, ...clipArgs });
    if (snapshot.phase === "acting" && !activeGesture) {
      const label = snapshot.workIndicator?.label;
      next.workIndicator = { active: true, label };
      if (presence === "idle") next.clip = "idle";
    }
    return { kind: "moved", snapshot: next, arrived: true, locomotionElapsedSec: 0 };
  }

  const step = Math.min(dist, walkSpeed * moveDt);
  const nx = x + (dx / dist) * step;
  const nz = z + (dz / dist) * step;
  const rotationY = yawToward([nx, ty, nz], [tx, ty, tz]);
  const moving: AgentSnapshot = {
    ...snapshot,
    pose: { position: [nx, ty, nz], rotationY },
    locomotionSubstate: "navigating",
    updatedAt: Date.now(),
  };
  moving.clip = deriveClip({ next: moving, ...clipArgs });
  return { kind: "moved", snapshot: moving, arrived: false, locomotionElapsedSec };
}
