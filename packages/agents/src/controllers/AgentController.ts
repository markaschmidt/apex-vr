import {
  AgentIntentSchema,
  DEFAULT_PHASE_CLIPS,
  type AgentClip,
  type AgentIntent,
  type AgentListener,
  type AgentPhase,
  type AgentSnapshot,
  type AttendIntent,
  type AvatarCue,
  type ExecutePlanIntent,
  type FocusTargetIntent,
  type GestureIntent,
  type GestureName,
  type PresencePhase,
  type Vec3,
} from "../types.js";
import type { AnchorResolver } from "../embodiment/anchors.js";
import {
  PlanBlockReason,
  unsupportedCapabilityReason,
  type PlanEvent,
  type PlanEventListener,
} from "../embodiment/events.js";
import { apexIntentFromWire, isRemoteIntentType } from "../embodiment/wire.js";
import {
  gateExecutePlan,
  paneIdsForStep,
  parseNetworkStep,
  resolvePaneIds,
  type NetworkPlanStep,
} from "../embodiment/validate.js";
import { PlanSequencer } from "../embodiment/PlanSequencer.js";
import {
  buildRuntimeCapabilities,
  isGestureCapability,
  type AgentRuntimeCapabilities,
} from "../embodiment/capabilities.js";
import { resolveGazeWorldPoint, selectGazeTargetId } from "../embodiment/gaze.js";
import {
  resolveGestureClip,
  type LoadedPlaybackInfo,
} from "../avatar/gestures.js";
import { novaLocoLog } from "../debug/locoLog.js";
import { closeGesture, decayGesture, openGesture } from "./gestures.js";
import { beginLocomotion, stepLocomotion } from "./locomotion.js";
import {
  type ActiveGesture,
  type AgentControllerOptions,
  type CompletionKind,
  type IntentSource,
} from "./types.js";
import {
  DEFAULT_CUE_TIMEOUT_MS,
  DEFAULT_GAZE_CYCLE_SEC,
  MAX_CLOCK_DELTA,
  MAX_LOCOMOTION_DELTA,
  MAX_STEP_CHAIN,
  clipForStanding as standingClip,
  deriveClip as clipFromSnapshot,
  extraActual,
  extraTargetFromStep,
  isPresencePhase,
  motorsBusy as snapshotMotorsBusy,
  stepTarget as planStepTarget,
} from "./utils.js";

/**
 * Pure agent runtime: phase machine + pose + clip selection + semantic attend.
 * Rendering, voice, HTTP, and scene layout stay outside — subscribe and drive
 * your scene; inject `resolveAnchor` for pane ids.
 *
 * Multi-step network plans are owned by a single {@link PlanSequencer} inside
 * this controller. Presence APIs never abort locomotion.
 */
export class AgentController {
  private readonly listeners = new Set<AgentListener>();
  private readonly phaseClips: Record<AgentPhase, AgentClip>;
  private readonly walkSpeed: number;
  private readonly turnSpeed: number;
  private readonly destinationTimeoutMs?: number;
  private readonly cueTimeoutSec: number;
  private readonly gazeCycleSec: number;
  private resolveAnchor?: AnchorResolver;
  private onPlanEvent?: PlanEventListener;
  private workspaceId?: string;
  private actorId?: string;
  private snapshot: AgentSnapshot;
  private lastRevision = 0;
  private lastPlanId?: string;
  private locomotionElapsedSec = 0;
  private pendingCompletion: CompletionKind = null;
  private readonly sequencer = new PlanSequencer();
  private presence: PresencePhase = "idle";
  private activeGesture: ActiveGesture | null = null;
  private gestureGeneration = 0;
  private playback: LoadedPlaybackInfo | null = null;
  private speakerTargetId?: string;
  private speakerLookAt?: Vec3;
  private cycleIds: string[] = [];
  private cycleIndex = 0;
  private gazeCycleElapsed = 0;
  private advancing = false;
  private pendingAdvance = false;

  constructor(options: AgentControllerOptions) {
    this.phaseClips = { ...DEFAULT_PHASE_CLIPS, ...options.phaseClips };
    this.walkSpeed = options.walkSpeed ?? 1.35;
    this.turnSpeed = options.turnSpeed ?? 3.2;
    this.destinationTimeoutMs = options.destinationTimeoutMs;
    this.cueTimeoutSec = (options.cueTimeoutMs ?? DEFAULT_CUE_TIMEOUT_MS) / 1000;
    this.gazeCycleSec = options.gazeCycleSec ?? DEFAULT_GAZE_CYCLE_SEC;
    this.resolveAnchor = options.resolveAnchor;
    this.onPlanEvent = options.onPlanEvent;
    this.workspaceId = options.workspaceId;
    this.actorId = options.actorId;
    this.snapshot = {
      identity: options.identity,
      phase: "idle",
      clip: this.phaseClips.idle,
      pose: options.initialPose ?? { position: [0, 0, 0], rotationY: 0 },
      updatedAt: Date.now(),
      presence: "idle",
    };
  }

  get state(): AgentSnapshot {
    return this.snapshot;
  }

  /** Named queue — tests and hosts may inspect, not drive. */
  get planSequencer(): PlanSequencer {
    return this.sequencer;
  }

  get capabilities(): AgentRuntimeCapabilities {
    return buildRuntimeCapabilities({ playback: this.playback });
  }

  setAnchorResolver(resolveAnchor: AnchorResolver | undefined): void {
    this.resolveAnchor = resolveAnchor;
  }

  setPlanListener(listener: PlanEventListener | undefined): void {
    this.onPlanEvent = listener;
  }

  setWorkspace(workspaceId: string | undefined, actorId?: string): void {
    this.workspaceId = workspaceId;
    if (actorId !== undefined) this.actorId = actorId;
  }

  /** Swap the embodied VRM. The NPC mesh reloads from `identity.avatarUrl`. */
  setAvatarUrl(avatarUrl: string): AgentSnapshot {
    const next = avatarUrl.trim();
    if (!next || this.snapshot.identity.avatarUrl === next) return this.snapshot;
    return this.commit({
      ...this.snapshot,
      identity: { ...this.snapshot.identity, avatarUrl: next },
      updatedAt: Date.now(),
    });
  }

  /**
   * Report actually loaded mixer actions. Never pass Mixamo URL maps.
   * `lookAt: true` only when `vrm.lookAt` is wired.
   */
  reportLoadedPlayback(info: LoadedPlaybackInfo | null): void {
    this.playback = info;
  }

  subscribe(listener: AgentListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  /** Validate and apply a transport-agnostic intent (local primitives allowed). */
  dispatch(raw: unknown): AgentSnapshot {
    const intent = AgentIntentSchema.parse(raw);
    return this.apply(intent, "local");
  }

  /**
   * Apply a network/SSE intent. `move_to` and other local primitives are
   * ignored and reported as `blocked` (`unknown_action`).
   */
  dispatchRemote(raw: unknown): AgentSnapshot {
    const parsed = AgentIntentSchema.safeParse(raw);
    if (!parsed.success || !isRemoteIntentType(parsed.data.type)) {
      return this.blockStandalone(PlanBlockReason.unknownAction);
    }
    return this.apply(parsed.data, "remote");
  }

  /** Map a snake_case Vektral envelope, then `dispatchRemote`. */
  dispatchWire(payload: unknown): AgentSnapshot {
    const intent = apexIntentFromWire(payload);
    if (!intent) return this.blockStandalone(PlanBlockReason.unknownAction);
    return this.dispatchRemote(intent);
  }

  setPhase(phase: AgentPhase): AgentSnapshot {
    return this.apply({ type: "set_phase", phase }, "local");
  }

  setListening(): AgentSnapshot {
    return this.setPresence("listening");
  }

  setThinking(): AgentSnapshot {
    return this.setPresence("thinking");
  }

  setSpeaking(): AgentSnapshot {
    return this.setPresence("speaking");
  }

  setIdle(): AgentSnapshot {
    return this.setPresence("idle");
  }

  say(text: string, speak = true): AgentSnapshot {
    return this.apply({ type: "say", text, speak }, "local");
  }

  moveTo(position: Vec3, lookAt?: Vec3): AgentSnapshot {
    return this.apply({ type: "move_to", position, lookAt }, "local");
  }

  setBusy(active: boolean, label?: string): AgentSnapshot {
    return this.apply({ type: "set_busy", active, label }, "local");
  }

  attend(input: Omit<AttendIntent, "type">): AgentSnapshot {
    return this.apply({ type: "attend", ...input }, "local");
  }

  playGesture(gesture: GestureName, paneId?: string): AgentSnapshot {
    return this.apply({ type: "gesture", gesture, paneId }, "local");
  }

  cancelPlan(reason: string = PlanBlockReason.userOverride, planId?: string): AgentSnapshot {
    return this.apply({ type: "cancel_plan", planId, reason }, "local");
  }

  interrupt(reason: string = PlanBlockReason.userOverride): AgentSnapshot {
    return this.applyCancel(this.snapshot.planId, reason);
  }

  /**
   * Host-only VocalBridge/LiveKit cue. APEX never invents these events.
   * Missing cues time out via {@link tick}; they never hang the queue.
   */
  signalCue(cue: AvatarCue): AgentSnapshot {
    if (!this.sequencer.signalCue(cue)) return this.snapshot;
    this.executeCurrentStep();
    return this.snapshot;
  }

  setSpeakerTarget(targetId: string | undefined): void {
    this.speakerTargetId = targetId;
    this.refreshGazeTarget();
  }

  setSpeakerLookAt(lookAt: Vec3 | undefined): void {
    this.speakerLookAt = lookAt;
  }

  /** World point for `vrm.lookAt.target`. Omit from replicated snapshots. */
  getGazeWorldPoint(): Vec3 | undefined {
    return resolveGazeWorldPoint({
      hint: this.snapshot.gazeHint,
      targetId: this.snapshot.gazeTargetId,
      speakerLookAt: this.speakerLookAt,
      resolveAnchor: this.resolveAnchor,
    });
  }

  /**
   * Mixer `finished` from VRM/rigged meshes. Stale generations after
   * crossfade/interrupt are ignored.
   */
  notifyClipFinished(generation?: number): AgentSnapshot {
    if (!this.activeGesture) return this.snapshot;
    if (generation !== this.activeGesture.generation) return this.snapshot;
    return this.completeGesture();
  }

  /**
   * Advance simulation: cue timeouts, bounded gestures, orient, navigate.
   * Call from the render loop (e.g. R3F `useFrame`).
   */
  tick(deltaSeconds: number): AgentSnapshot {
    const dt = Math.max(deltaSeconds, 0);
    const moveDt = Math.min(dt, MAX_LOCOMOTION_DELTA);
    const clockDt = Math.min(dt, MAX_CLOCK_DELTA);

    if (this.sequencer.waitingCue) {
      const cueResult = this.sequencer.tickCue(clockDt);
      if (cueResult === "timeout") {
        return this.failActivePlan(PlanBlockReason.cueTimeout);
      }
    }

    if (this.activeGesture) {
      const decayed = decayGesture(this.activeGesture, clockDt);
      this.activeGesture = decayed.active;
      if (decayed.finished) this.completeGesture();
    }

    if (this.snapshot.gazeHint === "cycle" && this.cycleIds.length > 1) {
      this.gazeCycleElapsed += clockDt;
      if (this.gazeCycleElapsed >= this.gazeCycleSec) {
        this.gazeCycleElapsed = 0;
        this.cycleIndex = (this.cycleIndex + 1) % this.cycleIds.length;
        this.refreshGazeTarget();
      }
    }

    if (this.snapshot.locomotion) {
      return this.advanceLocomotion(moveDt, clockDt);
    }
    return this.snapshot;
  }

  /**
   * Advance locomotion toward `move_to` target. Call from the render loop
   * (e.g. R3F `useFrame`). Returns the updated snapshot when position changes.
   */
  tickLocomotion(deltaSeconds: number): AgentSnapshot {
    return this.tick(deltaSeconds);
  }

  private apply(intent: AgentIntent, source: IntentSource): AgentSnapshot {
    if (intent.type === "attend") {
      return this.applyAttend(intent, source, false);
    }
    if (intent.type === "execute_plan") {
      return this.applyExecutePlan(intent);
    }
    if (intent.type === "cancel_plan") {
      return this.applyCancel(intent.planId, intent.reason);
    }
    if (intent.type === "gesture") {
      return this.applyGesture(intent, source);
    }

    const next: AgentSnapshot = {
      ...this.snapshot,
      updatedAt: Date.now(),
      blockedReason: undefined,
    };

    switch (intent.type) {
      case "set_phase":
        if (isPresencePhase(intent.phase)) {
          return this.setPresence(intent.phase);
        }
        next.phase = intent.phase;
        if (intent.phase !== "acting" && !next.locomotion && !this.activeGesture) {
          next.workIndicator = undefined;
        }
        next.clip = this.deriveClip(next);
        break;
      case "say":
        next.lastUtterance = intent.text;
        if (intent.speak) {
          this.presence = "speaking";
          next.presence = "speaking";
          if (!this.motorsBusy(next)) next.phase = "speaking";
        }
        next.clip = this.deriveClip(next);
        break;
      case "move_to": {
        if (source === "local") this.preemptPlan();
        const after = { ...this.snapshot, updatedAt: Date.now(), blockedReason: undefined };
        this.beginLocomotion(after, intent.position, intent.lookAt);
        after.phase = "acting";
        after.workIndicator = undefined;
        after.clip = this.deriveClip(after);
        this.pendingCompletion = null;
        return this.commit(after);
      }
      case "play_clip":
        next.clip = intent.clip;
        break;
      case "focus_target":
        return this.applyFocus(intent, source, false);
      case "set_busy":
        if (intent.active) {
          next.workIndicator = {
            active: !next.locomotion,
            label: intent.label,
          };
          if (!next.locomotion && !this.activeGesture) next.clip = "idle";
        } else {
          next.workIndicator = undefined;
          next.clip = this.deriveClip(next);
        }
        break;
      case "custom":
        break;
    }

    return this.commit(next);
  }

  private setPresence(phase: PresencePhase): AgentSnapshot {
    this.presence = phase;
    const next: AgentSnapshot = {
      ...this.snapshot,
      presence: phase,
      updatedAt: Date.now(),
      blockedReason: undefined,
    };
    if (!this.motorsBusy(next)) {
      next.phase = phase;
      next.workIndicator = undefined;
    }
    next.clip = this.deriveClip(next);
    return this.commit(next);
  }

  private applyGesture(intent: GestureIntent, source: IntentSource): AgentSnapshot {
    if (source === "local") this.preemptPlan();
    const resolved = resolveGestureClip(intent.gesture, this.playback);
    if (!resolved) {
      return this.blockStandalone(
        unsupportedCapabilityReason(`gesture.${intent.gesture}`),
        { actualTarget: intent.paneId },
      );
    }
    if (intent.paneId && this.resolveAnchor && !this.resolveAnchor(intent.paneId)) {
      return this.blockStandalone(PlanBlockReason.unresolvedPane, {
        actualTarget: intent.paneId,
      });
    }
    if (intent.paneId) {
      this.applyFocus(
        { type: "focus_target", targetId: intent.paneId },
        source,
        true,
      );
    }
    this.startGesture(intent.gesture, resolved.name, resolved.duration);
    return this.snapshot;
  }

  private applyAttend(
    intent: AttendIntent,
    source: IntentSource,
    fromSequencer: boolean,
  ): AgentSnapshot {
    if (!fromSequencer && source === "local") {
      this.preemptPlan();
    }

    if (!this.resolveAnchor) {
      return this.failOrBlock(PlanBlockReason.missingResolver, fromSequencer, {
        actualTarget: intent.primaryPaneId,
      });
    }

    const paneIds = paneIdsForStep(intent);
    const { anchors, failed } = resolvePaneIds(paneIds, this.resolveAnchor);
    if (failed.length || anchors.length === 0) {
      return this.failOrBlock(PlanBlockReason.unresolvedPane, fromSequencer, {
        actualTarget: intent.primaryPaneId,
      });
    }

    const primary =
      anchors.find((anchor) => anchor.paneId === intent.primaryPaneId) ?? anchors[0];
    if (!primary) {
      return this.failOrBlock(PlanBlockReason.unresolvedPane, fromSequencer, {
        actualTarget: intent.primaryPaneId,
      });
    }

    this.cycleIds = intent.paneIds;
    this.cycleIndex = 0;
    this.gazeCycleElapsed = 0;

    const gazeHint = intent.gazeHint;
    const gazeTargetId = selectGazeTargetId({
      hint: gazeHint,
      primaryPaneId: intent.primaryPaneId,
      cycleIds: intent.paneIds,
      cycleIndex: 0,
      speakerTargetId: this.speakerTargetId,
    });

    const next: AgentSnapshot = {
      ...this.snapshot,
      updatedAt: Date.now(),
      blockedReason: undefined,
      focusTargetId: intent.primaryPaneId,
      gazeTargetId,
      gazeHint,
      secondaryFocusIds: intent.paneIds.filter((id) => id !== intent.primaryPaneId),
      phase: intent.phaseHint ?? "acting",
    };
    if (intent.speechHint) next.lastUtterance = intent.speechHint;

    novaLocoLog("controller.attend", {
      paneIds: intent.paneIds,
      primaryPaneId: intent.primaryPaneId,
      fromSequencer,
      source,
      stand: primary.position,
      pose: next.pose.position,
    });
    const arrived = this.beginLocomotion(next, primary.position, primary.lookAt);
    next.clip = this.deriveClip(next);
    if (arrived && intent.clipHint && intent.clipHint !== "walk") {
      next.clip = intent.clipHint;
    }

    if (!fromSequencer) {
      this.pendingCompletion =
        source === "remote" || this.snapshot.planId ? "plan" : "local";
    }

    const committed = this.commit(next);
    if (!fromSequencer) {
      this.emitPlan({
        status: "accepted",
        planId: committed.planId,
        revision: committed.revision,
        actualTarget: intent.primaryPaneId,
        stepId: intent.stepId,
      });
      this.emitPlan({
        status: "running",
        planId: committed.planId,
        revision: committed.revision,
        actualTarget: intent.primaryPaneId,
        stepId: intent.stepId,
      });
    } else {
      this.emitPlan({
        status: "running",
        planId: committed.planId,
        revision: committed.revision,
        actualTarget: intent.primaryPaneId,
        stepId: intent.stepId,
        stepIndex: this.sequencer.currentIndex,
      });
    }
    if (arrived) this.finishArrival(this.snapshot);
    return this.snapshot;
  }

  private applyFocus(
    intent: FocusTargetIntent,
    source: IntentSource,
    skipReceipts: boolean,
  ): AgentSnapshot {
    if (source === "remote" && this.resolveAnchor && !this.resolveAnchor(intent.targetId)) {
      return this.failOrBlock(PlanBlockReason.unresolvedPane, this.sequencer.active, {
        actualTarget: intent.targetId,
      });
    }
    const next: AgentSnapshot = {
      ...this.snapshot,
      updatedAt: Date.now(),
      blockedReason: undefined,
      focusTargetId: intent.targetId,
      gazeTargetId: intent.targetId,
    };
    if (!next.locomotion && !this.activeGesture) next.clip = this.deriveClip(next);
    const committed = this.commit(next);
    if (!skipReceipts && !this.sequencer.active) {
      this.emitPlan({
        status: "running",
        planId: committed.planId,
        revision: committed.revision,
        actualTarget: intent.targetId,
        stepId: intent.stepId,
      });
    }
    return committed;
  }

  private applyExecutePlan(plan: ExecutePlanIntent): AgentSnapshot {
    if (this.lastPlanId === plan.planId && this.lastRevision === plan.revision) {
      return this.snapshot;
    }

    const gate = gateExecutePlan(plan, {
      workspaceId: this.workspaceId,
      actorId: this.actorId,
      lastRevision: this.lastRevision,
    });
    if (gate) {
      return this.blockStandalone(gate.reason, {
        planId: plan.planId,
        revision: plan.revision,
      });
    }

    const parsedSteps: NetworkPlanStep[] = [];
    for (const step of plan.steps) {
      const parsed = parseNetworkStep(step);
      if (!parsed) {
        return this.blockStandalone(PlanBlockReason.unknownAction, {
          planId: plan.planId,
          revision: plan.revision,
        });
      }
      parsedSteps.push(parsed);
    }

    const capabilities = this.capabilities;
    for (const step of parsedSteps) {
      if (step.type === "gesture" && !isGestureCapability(capabilities, step.gesture)) {
        return this.blockStandalone(
          unsupportedCapabilityReason(`gesture.${step.gesture}`),
          { planId: plan.planId, revision: plan.revision },
        );
      }
    }

    if (!this.resolveAnchor) {
      return this.blockStandalone(PlanBlockReason.missingResolver, {
        planId: plan.planId,
        revision: plan.revision,
      });
    }

    const paneIds = parsedSteps.flatMap(paneIdsForStep);
    const { failed } = resolvePaneIds(paneIds, this.resolveAnchor);
    if (failed.length) {
      return this.blockStandalone(PlanBlockReason.unresolvedPane, {
        planId: plan.planId,
        revision: plan.revision,
        actualTarget: paneIds[0],
      });
    }

    if (this.sequencer.active || this.snapshot.planId) {
      this.clearMotors();
      this.sequencer.clear();
      this.snapshot = {
        ...this.snapshot,
        locomotion: undefined,
        locomotionSubstate: undefined,
        gestureName: undefined,
        gestureGeneration: this.gestureGeneration,
        planId: undefined,
      };
    }

    this.lastRevision = plan.revision;
    this.lastPlanId = plan.planId;
    this.pendingCompletion = null;

    this.commit({
      ...this.snapshot,
      planId: plan.planId,
      revision: plan.revision,
      blockedReason: undefined,
      updatedAt: Date.now(),
    });

    this.sequencer.load(plan.planId, plan.revision, parsedSteps);
    this.emitPlan({
      status: "accepted",
      planId: plan.planId,
      revision: plan.revision,
      actualTarget: this.stepTarget(parsedSteps[0]),
      stepId: parsedSteps[0]?.stepId,
      stepIndex: 0,
    });
    this.startCurrentStep();
    return this.snapshot;
  }

  private startCurrentStep(): void {
    const step = this.sequencer.current;
    if (!step) return;
    const wait = this.sequencer.beginWaitIfNeeded(this.cueTimeoutSec);
    if (wait) {
      this.emitPlan({
        status: "running",
        planId: this.sequencer.planId ?? this.snapshot.planId,
        revision: this.sequencer.revision ?? this.snapshot.revision,
        actualTarget: this.stepTarget(step),
        stepId: step.stepId,
        stepIndex: this.sequencer.currentIndex,
      });
      return;
    }
    this.executeCurrentStep();
  }

  private executeCurrentStep(): void {
    const step = this.sequencer.current;
    if (!step) return;
    if (step.type === "attend") {
      this.applyAttend(step, "remote", true);
      return;
    }
    if (step.type === "focus_target") {
      const snapshot = this.applyFocus(step, "remote", true);
      if (snapshot.blockedReason) return;
      this.emitPlan({
        status: "running",
        planId: this.snapshot.planId,
        revision: this.snapshot.revision,
        actualTarget: step.targetId,
        stepId: step.stepId,
        stepIndex: this.sequencer.currentIndex,
      });
      this.advanceSequencer();
      return;
    }
    if (step.type === "gesture") {
      const resolved = resolveGestureClip(step.gesture, this.playback);
      if (!resolved) {
        this.failActivePlan(unsupportedCapabilityReason(`gesture.${step.gesture}`));
        return;
      }
      if (step.paneId) {
        const focused = this.applyFocus(
          { type: "focus_target", targetId: step.paneId },
          "remote",
          true,
        );
        if (focused.blockedReason) return;
      }
      this.emitPlan({
        status: "running",
        planId: this.snapshot.planId,
        revision: this.snapshot.revision,
        actualTarget: step.paneId ?? this.snapshot.focusTargetId,
        stepId: step.stepId,
        stepIndex: this.sequencer.currentIndex,
      });
      const hold = step.gesture === "dance" ? 4.5 : resolved.duration;
      this.startGesture(step.gesture, resolved.name, hold);
    }
  }

  private advanceSequencer(): void {
    if (this.advancing) {
      this.pendingAdvance = true;
      return;
    }
    this.advancing = true;
    try {
      let guard = 0;
      while (guard < MAX_STEP_CHAIN) {
        guard += 1;
        this.pendingAdvance = false;
        const next = this.sequencer.advance();
        if (!next) {
          const planId = this.snapshot.planId;
          const revision = this.snapshot.revision;
          const actualTarget = this.snapshot.focusTargetId;
          this.sequencer.clear();
          this.emitPlan({
            status: "completed",
            planId,
            revision,
            actualTarget,
          });
          const restored: AgentSnapshot = {
            ...this.snapshot,
            clip: this.clipForStanding(this.snapshot),
            updatedAt: Date.now(),
          };
          this.commit(restored);
          return;
        }
        const wait = this.sequencer.beginWaitIfNeeded(this.cueTimeoutSec);
        if (wait) {
          this.emitPlan({
            status: "running",
            planId: this.snapshot.planId,
            revision: this.snapshot.revision,
            actualTarget: this.stepTarget(next),
            stepId: next.stepId,
            stepIndex: this.sequencer.currentIndex,
          });
          return;
        }
        if (next.type === "focus_target") {
          const snapshot = this.applyFocus(next, "remote", true);
          if (snapshot.blockedReason) return;
          this.emitPlan({
            status: "running",
            planId: this.snapshot.planId,
            revision: this.snapshot.revision,
            actualTarget: next.targetId,
            stepId: next.stepId,
            stepIndex: this.sequencer.currentIndex,
          });
          continue;
        }
        if (next.type === "attend") {
          this.applyAttend(next, "remote", true);
          if (this.pendingAdvance) continue;
          return;
        }
        if (next.type === "gesture") {
          this.executeCurrentStep();
          if (this.pendingAdvance) continue;
          return;
        }
      }
    } finally {
      this.advancing = false;
    }
  }

  private startGesture(name: GestureName, clip: AgentClip, duration: number): void {
    const opened = openGesture({
      snapshot: this.snapshot,
      name,
      clip,
      duration,
      generation: this.gestureGeneration,
    });
    this.gestureGeneration = opened.generation;
    this.activeGesture = opened.active;
    this.commit(opened.snapshot);
  }

  private completeGesture(): AgentSnapshot {
    const wasPlanStep =
      this.sequencer.active && this.sequencer.current?.type === "gesture";
    const closed = closeGesture({
      snapshot: this.snapshot,
      generation: this.gestureGeneration,
      presence: this.presence,
      phaseClips: this.phaseClips,
    });
    this.activeGesture = null;
    this.gestureGeneration = closed.generation;
    this.commit(closed.snapshot);
    if (wasPlanStep) this.advanceSequencer();
    return this.snapshot;
  }

  private applyCancel(planId?: string, reason?: string): AgentSnapshot {
    const currentId = this.snapshot.planId;
    if (planId && currentId && planId !== currentId) {
      return this.snapshot;
    }
    const hadWork =
      Boolean(currentId) ||
      Boolean(this.snapshot.locomotion) ||
      Boolean(this.activeGesture) ||
      this.sequencer.active;
    if (!hadWork) return this.snapshot;

    novaLocoLog("controller.cancel", {
      reason,
      planId: currentId ?? planId,
      locomotion: this.snapshot.locomotion?.target,
      substate: this.snapshot.locomotionSubstate,
      clip: this.snapshot.clip,
      pose: this.snapshot.pose.position,
    });

    const revision = this.snapshot.revision;
    const actualTarget = this.snapshot.focusTargetId;
    this.clearMotors();
    this.sequencer.clear();
    this.pendingCompletion = null;
    const committed = this.commit({
      ...this.snapshot,
      locomotion: undefined,
      locomotionSubstate: undefined,
      planId: undefined,
      blockedReason: undefined,
      gestureName: undefined,
      gestureGeneration: this.gestureGeneration,
      phase: this.presence,
      clip: this.phaseClips[this.presence],
      updatedAt: Date.now(),
    });
    this.emitPlan({
      status: "cancelled",
      planId: currentId ?? planId,
      revision,
      actualTarget,
      reason: reason ?? PlanBlockReason.userOverride,
    });
    return committed;
  }

  private beginLocomotion(
    next: AgentSnapshot,
    position: Vec3,
    lookAt: Vec3 | undefined,
  ): boolean {
    const started = beginLocomotion({ next, position, lookAt });
    this.locomotionElapsedSec = started.locomotionElapsedSec;
    return started.arrived;
  }

  private advanceLocomotion(moveDt: number, clockDt: number): AgentSnapshot {
    const stepped = stepLocomotion({
      snapshot: this.snapshot,
      moveDt,
      clockDt,
      locomotionElapsedSec: this.locomotionElapsedSec,
      destinationTimeoutMs: this.destinationTimeoutMs,
      walkSpeed: this.walkSpeed,
      turnSpeed: this.turnSpeed,
      activeGesture: this.activeGesture,
      presence: this.presence,
      phaseClips: this.phaseClips,
    });
    if (stepped.kind === "none") return this.snapshot;
    if (stepped.kind === "timeout") {
      return this.failOrBlock(PlanBlockReason.destinationTimeout, this.sequencer.active, {
        actualTarget: this.snapshot.focusTargetId,
      });
    }
    this.locomotionElapsedSec = stepped.locomotionElapsedSec;
    const committed = this.commit(stepped.snapshot);
    if (stepped.arrived) {
      this.finishArrival(committed);
      return this.snapshot;
    }
    return committed;
  }

  private finishArrival(snapshot: AgentSnapshot): void {
    this.locomotionElapsedSec = 0;
    if (this.sequencer.active && this.sequencer.current?.type === "attend") {
      this.advanceSequencer();
      return;
    }
    const kind = this.pendingCompletion;
    this.pendingCompletion = null;
    if (!kind) return;
    this.emitPlan({
      status: "completed",
      planId: snapshot.planId,
      revision: snapshot.revision,
      actualTarget: snapshot.focusTargetId,
    });
  }

  private failOrBlock(
    reason: string,
    fromSequencer: boolean,
    extra?: { planId?: string; revision?: number; actualTarget?: string },
  ): AgentSnapshot {
    novaLocoLog("controller.blocked", {
      reason,
      fromSequencer,
      sequencerActive: this.sequencer.active,
      actualTarget: extra?.actualTarget,
      pose: this.snapshot.pose.position,
      clip: this.snapshot.clip,
    });
    if (fromSequencer || this.sequencer.active) {
      return this.failActivePlan(reason);
    }
    return this.blockStandalone(reason, extra);
  }

  private failActivePlan(reason: string): AgentSnapshot {
    const step = this.sequencer.current;
    const stepId = step?.stepId;
    const stepIndex = this.sequencer.active ? this.sequencer.currentIndex : undefined;
    const planId = this.sequencer.planId ?? this.snapshot.planId;
    const revision = this.sequencer.revision ?? this.snapshot.revision;
    this.clearMotors();
    this.sequencer.clear();
    this.pendingCompletion = null;
    const committed = this.commit({
      ...this.snapshot,
      locomotion: undefined,
      locomotionSubstate: undefined,
      gestureName: undefined,
      gestureGeneration: this.gestureGeneration,
      blockedReason: reason,
      clip: this.clipForStanding(this.snapshot),
      updatedAt: Date.now(),
    });
    this.emitPlan({
      status: "blocked",
      planId,
      revision,
      actualTarget: extraActual(committed, extraTargetFromStep(step)),
      reason,
      stepId,
      stepIndex,
    });
    return committed;
  }

  private blockStandalone(
    reason: string,
    extra?: { planId?: string; revision?: number; actualTarget?: string },
  ): AgentSnapshot {
    const committed = this.commit({
      ...this.snapshot,
      blockedReason: reason,
      updatedAt: Date.now(),
    });
    this.emitPlan({
      status: "blocked",
      planId: extra?.planId ?? committed.planId,
      revision: extra?.revision ?? committed.revision,
      actualTarget: extra?.actualTarget ?? committed.focusTargetId,
      reason,
    });
    return committed;
  }

  private preemptPlan(): void {
    if (!this.snapshot.planId && !this.sequencer.active) return;
    this.applyCancel(this.snapshot.planId, PlanBlockReason.userOverride);
  }

  private clearMotors(): void {
    this.activeGesture = null;
    this.gestureGeneration += 1;
    this.locomotionElapsedSec = 0;
    this.pendingCompletion = null;
  }

  private motorsBusy(next: AgentSnapshot): boolean {
    return snapshotMotorsBusy(next, this.activeGesture, this.sequencer.active);
  }

  private deriveClip(next: AgentSnapshot): AgentClip {
    return clipFromSnapshot({
      next,
      activeGesture: this.activeGesture,
      presence: this.presence,
      phaseClips: this.phaseClips,
    });
  }

  private clipForStanding(next: AgentSnapshot): AgentClip {
    return standingClip({
      next,
      activeGesture: this.activeGesture,
      presence: this.presence,
      phaseClips: this.phaseClips,
    });
  }

  private refreshGazeTarget(): void {
    const gazeTargetId = selectGazeTargetId({
      hint: this.snapshot.gazeHint,
      primaryPaneId: this.snapshot.focusTargetId,
      cycleIds: this.cycleIds,
      cycleIndex: this.cycleIndex,
      speakerTargetId: this.speakerTargetId,
    });
    if (gazeTargetId === this.snapshot.gazeTargetId) return;
    this.commit({
      ...this.snapshot,
      gazeTargetId,
      updatedAt: Date.now(),
    });
  }

  private stepTarget(step: NetworkPlanStep | undefined): string | undefined {
    return planStepTarget(step, this.snapshot.focusTargetId);
  }

  private emitPlan(event: PlanEvent): void {
    try {
      this.onPlanEvent?.(event);
    } catch {
      /* observational receipts must never stall sequencing */
    }
  }

  private commit(next: AgentSnapshot): AgentSnapshot {
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }
}
