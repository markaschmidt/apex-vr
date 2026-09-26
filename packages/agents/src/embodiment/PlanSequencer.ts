import type { AvatarCue } from "../types.js";
import type { NetworkPlanStep } from "./validate.js";

export type CueTickResult = "timeout" | "waiting" | "ready";

/**
 * Deterministic multi-step plan queue owned by `AgentController`.
 * Advances only on typed local completions (arrival, mixer finish, cue, timeout).
 * Not a second AgentController — receipts never gate the queue.
 */
export class PlanSequencer {
  private steps: NetworkPlanStep[] = [];
  private index = -1;
  private waitCue: Exclude<AvatarCue, "immediate"> | null = null;
  private cueRemainingSec = 0;
  private token = 0;
  planId?: string;
  revision?: number;

  get generation(): number {
    return this.token;
  }

  get active(): boolean {
    return this.index >= 0 && this.index < this.steps.length;
  }

  get drained(): boolean {
    return this.steps.length > 0 && this.index >= this.steps.length;
  }

  get empty(): boolean {
    return this.steps.length === 0;
  }

  get current(): NetworkPlanStep | undefined {
    return this.index >= 0 ? this.steps[this.index] : undefined;
  }

  get currentIndex(): number {
    return this.index;
  }

  get waitingCue(): Exclude<AvatarCue, "immediate"> | null {
    return this.waitCue;
  }

  get length(): number {
    return this.steps.length;
  }

  load(planId: string, revision: number, steps: NetworkPlanStep[]): void {
    this.steps = [...steps];
    this.index = 0;
    this.waitCue = null;
    this.cueRemainingSec = 0;
    this.planId = planId;
    this.revision = revision;
    this.token += 1;
  }

  clear(): void {
    this.steps = [];
    this.index = -1;
    this.waitCue = null;
    this.cueRemainingSec = 0;
    this.planId = undefined;
    this.revision = undefined;
  }

  /**
   * Latch a non-immediate cue. Returns the cue to wait for, or null when the
   * step may run now (`undefined` / `immediate`).
   */
  beginWaitIfNeeded(
    cueTimeoutSec: number,
  ): Exclude<AvatarCue, "immediate"> | null {
    const cue = this.current?.cue;
    if (!cue || cue === "immediate") {
      this.waitCue = null;
      this.cueRemainingSec = 0;
      return null;
    }
    this.waitCue = cue;
    this.cueRemainingSec = Math.max(cueTimeoutSec, 0.05);
    return cue;
  }

  signalCue(cue: AvatarCue): boolean {
    if (cue === "immediate" || !this.waitCue || this.waitCue !== cue) {
      return false;
    }
    this.waitCue = null;
    this.cueRemainingSec = 0;
    return true;
  }

  tickCue(deltaSeconds: number): CueTickResult {
    if (!this.waitCue) return "ready";
    this.cueRemainingSec -= Math.max(deltaSeconds, 0);
    if (this.cueRemainingSec > 0) return "waiting";
    this.waitCue = null;
    this.cueRemainingSec = 0;
    return "timeout";
  }

  /** Move to the next step. Undefined means the queue has drained. */
  advance(): NetworkPlanStep | undefined {
    this.waitCue = null;
    this.cueRemainingSec = 0;
    if (this.index < 0) return undefined;
    this.index += 1;
    if (this.index >= this.steps.length) return undefined;
    return this.current;
  }
}
