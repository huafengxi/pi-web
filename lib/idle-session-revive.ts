// State machine for reviving server-side sessions that were reclaimed by the
// 10-minute idle shutdown (lib/rpc-manager.ts). The chat polls the freshness
// endpoint while idle; when it reports the session wrapper as dead and the
// tab is visible, the chat reboots the session with a side-effect-free
// command so extension session_start handlers can drain their inbox.
//
// This module only decides *when* an attempt may fire: at most one attempt
// in flight, exponential backoff after failures, and a permanent stop once
// the session file is gone (404).

export const IDLE_REVIVE_BACKOFF_BASE_MS = 10_000;
export const IDLE_REVIVE_BACKOFF_MAX_MS = 60_000;

export type IdleSessionReviveOutcome = "ok" | "failed" | "not_found";

export interface IdleSessionReviverOptions {
  /** Revival only makes sense while the user can observe the chat. */
  isVisible: () => boolean;
  /** Injectable clock for tests. */
  now?: () => number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class IdleSessionReviver {
  private readonly isVisible: () => boolean;
  private readonly now: () => number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private inFlight = false;
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;
  private gaveUp = false;

  constructor(options: IdleSessionReviverOptions) {
    this.isVisible = options.isVisible;
    this.now = options.now ?? Date.now;
    this.baseDelayMs = options.baseDelayMs ?? IDLE_REVIVE_BACKOFF_BASE_MS;
    this.maxDelayMs = options.maxDelayMs ?? IDLE_REVIVE_BACKOFF_MAX_MS;
  }

  shouldAttempt(): boolean {
    if (this.gaveUp || this.inFlight) return false;
    if (!this.isVisible()) return false;
    return this.now() >= this.nextAttemptAt;
  }

  markAttemptStarted(): void {
    this.inFlight = true;
  }

  reportOutcome(outcome: IdleSessionReviveOutcome): void {
    this.inFlight = false;
    switch (outcome) {
      case "ok":
        // The session may be reclaimed again after the next idle window;
        // stay ready and drop any accumulated backoff.
        this.consecutiveFailures = 0;
        this.nextAttemptAt = 0;
        break;
      case "not_found":
        // The session file is gone: reviving can never succeed.
        this.gaveUp = true;
        break;
      case "failed": {
        this.consecutiveFailures += 1;
        const backoff = Math.min(
          this.maxDelayMs,
          this.baseDelayMs * 2 ** (this.consecutiveFailures - 1),
        );
        this.nextAttemptAt = this.now() + backoff;
        break;
      }
    }
  }
}
