import {
  AgentIntentSchema,
  DEFAULT_PHASE_CLIPS,
  type AgentClip,
  type AgentIdentity,
  type AgentIntent,
  type AgentListener,
  type AgentPhase,
  type AgentPose,
  type AgentSnapshot,
  type Vec3,
} from "./types.js";

export interface AgentControllerOptions {
  identity: AgentIdentity;
  initialPose?: AgentPose;
  phaseClips?: Partial<Record<AgentPhase, AgentClip>>;
  /** World-units per second when walking toward a move target. */
  walkSpeed?: number;
}

const ARRIVAL_THRESHOLD = 0.08;

/**
 * Pure agent runtime: phase machine + pose + clip selection.
 * Rendering and voice stay outside — subscribe and drive your scene.
 */
export class AgentController {
  private readonly listeners = new Set<AgentListener>();
  private readonly phaseClips: Record<AgentPhase, AgentClip>;
  private readonly walkSpeed: number;
  private snapshot: AgentSnapshot;

  constructor(options: AgentControllerOptions) {
    this.phaseClips = { ...DEFAULT_PHASE_CLIPS, ...options.phaseClips };
    this.walkSpeed = options.walkSpeed ?? 1.35;
    this.snapshot = {
      identity: options.identity,
      phase: "idle",
      clip: this.phaseClips.idle,
      pose: options.initialPose ?? { position: [0, 0, 0], rotationY: 0 },
      updatedAt: Date.now(),
    };
  }

  get state(): AgentSnapshot {
    return this.snapshot;
  }

  subscribe(listener: AgentListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  /** Validate and apply a transport-agnostic intent. */
  dispatch(raw: unknown): AgentSnapshot {
    const intent = AgentIntentSchema.parse(raw);
    return this.apply(intent);
  }

  setPhase(phase: AgentPhase): AgentSnapshot {
    return this.apply({ type: "set_phase", phase });
  }

  say(text: string, speak = true): AgentSnapshot {
    return this.apply({ type: "say", text, speak });
  }

  moveTo(position: Vec3, lookAt?: Vec3): AgentSnapshot {
    return this.apply({ type: "move_to", position, lookAt });
  }

  setBusy(active: boolean, label?: string): AgentSnapshot {
    return this.apply({ type: "set_busy", active, label });
  }

  /**
   * Advance locomotion toward `move_to` target. Call from the render loop
   * (e.g. R3F `useFrame`). Returns the updated snapshot when position changes.
   */
  tickLocomotion(deltaSeconds: number): AgentSnapshot {
    const { locomotion, pose } = this.snapshot;
    if (!locomotion) return this.snapshot;

    const [tx, ty, tz] = locomotion.target;
    const [x, , z] = pose.position;
    const dx = tx - x;
    const dz = tz - z;
    const dist = Math.hypot(dx, dz);

    if (dist <= ARRIVAL_THRESHOLD) {
      const rotationY = locomotion.lookAt
        ? yawToward([tx, ty, tz], locomotion.lookAt)
        : pose.rotationY;
      const next: AgentSnapshot = {
        ...this.snapshot,
        pose: { position: [tx, ty, tz], rotationY },
        locomotion: undefined,
        clip: this.clipForPhase(this.snapshot.phase, false),
        updatedAt: Date.now(),
      };
      if (this.snapshot.phase === "acting") {
        const label = this.snapshot.workIndicator?.label;
        next.workIndicator = { active: true, label };
        next.clip = "work";
      }
      return this.commit(next);
    }

    const step = Math.min(dist, this.walkSpeed * deltaSeconds);
    const nx = x + (dx / dist) * step;
    const nz = z + (dz / dist) * step;
    const rotationY = locomotion.lookAt
      ? yawToward([nx, ty, nz], locomotion.lookAt)
      : Math.atan2(dx, dz);

    const next: AgentSnapshot = {
      ...this.snapshot,
      pose: { position: [nx, ty, nz], rotationY },
      clip: "walk",
      updatedAt: Date.now(),
    };
    return this.commit(next);
  }

  private apply(intent: AgentIntent): AgentSnapshot {
    const next: AgentSnapshot = {
      ...this.snapshot,
      updatedAt: Date.now(),
    };

    switch (intent.type) {
      case "set_phase":
        next.phase = intent.phase;
        next.clip = this.clipForPhase(intent.phase, Boolean(next.locomotion));
        if (intent.phase !== "acting") {
          next.workIndicator = undefined;
          next.locomotion = undefined;
        }
        break;
      case "say":
        next.lastUtterance = intent.text;
        next.phase = intent.speak ? "speaking" : this.snapshot.phase;
        next.clip = intent.speak ? this.phaseClips.speaking : this.snapshot.clip;
        break;
      case "move_to": {
        next.locomotion = { target: intent.position, lookAt: intent.lookAt };
        next.phase = "acting";
        next.clip = "walk";
        next.workIndicator = undefined;
        break;
      }
      case "play_clip":
        next.clip = intent.clip;
        break;
      case "focus_target":
        next.focusTargetId = intent.targetId;
        next.clip = "point";
        break;
      case "set_busy":
        if (intent.active) {
          next.workIndicator = {
            active: !next.locomotion,
            label: intent.label,
          };
          if (!next.locomotion) next.clip = "work";
        } else {
          next.workIndicator = undefined;
          next.clip = this.clipForPhase(next.phase, false);
        }
        break;
      case "custom":
        // Host apps handle custom intents via listeners; we only stamp time.
        break;
    }

    return this.commit(next);
  }

  private clipForPhase(phase: AgentPhase, moving: boolean): AgentClip {
    if (phase === "acting") return moving ? "walk" : "work";
    return this.phaseClips[phase];
  }

  private commit(next: AgentSnapshot): AgentSnapshot {
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }
}

function yawToward(from: Vec3, to: Vec3): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}
