import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./idle-session-revive.ts");
}

function createClock(start = 0) {
  const clock = { time: start, now: () => clock.time, advance: (ms) => { clock.time += ms; } };
  return clock;
}

test("allows an attempt only while the tab is visible", async () => {
  const { IdleSessionReviver } = await loadSubject();
  let visible = false;
  const reviver = new IdleSessionReviver({ isVisible: () => visible, now: () => 0 });

  assert.equal(reviver.shouldAttempt(), false, "hidden tab must not revive");
  visible = true;
  assert.equal(reviver.shouldAttempt(), true);
});

test("blocks concurrent attempts until the outcome is reported", async () => {
  const { IdleSessionReviver } = await loadSubject();
  const reviver = new IdleSessionReviver({ isVisible: () => true, now: () => 0 });

  assert.equal(reviver.shouldAttempt(), true);
  reviver.markAttemptStarted();
  assert.equal(reviver.shouldAttempt(), false, "attempt already in flight");
  reviver.reportOutcome("ok");
  assert.equal(reviver.shouldAttempt(), true, "ready again after success");
});

test("backs off exponentially after failures and caps at the maximum", async () => {
  const { IdleSessionReviver, IDLE_REVIVE_BACKOFF_BASE_MS, IDLE_REVIVE_BACKOFF_MAX_MS } = await loadSubject();
  const clock = createClock();
  const reviver = new IdleSessionReviver({ isVisible: () => true, now: clock.now });

  reviver.markAttemptStarted();
  reviver.reportOutcome("failed");
  assert.equal(reviver.shouldAttempt(), false, "inside the first backoff window");
  clock.advance(IDLE_REVIVE_BACKOFF_BASE_MS);
  assert.equal(reviver.shouldAttempt(), true, "first backoff elapsed");

  reviver.markAttemptStarted();
  reviver.reportOutcome("failed");
  assert.equal(reviver.shouldAttempt(), false);
  clock.advance(IDLE_REVIVE_BACKOFF_BASE_MS);
  assert.equal(reviver.shouldAttempt(), false, "second backoff doubles");
  clock.advance(IDLE_REVIVE_BACKOFF_BASE_MS);
  assert.equal(reviver.shouldAttempt(), true);

  // Many failures must not grow the delay beyond the cap.
  for (let i = 0; i < 10; i += 1) {
    reviver.markAttemptStarted();
    reviver.reportOutcome("failed");
  }
  assert.equal(reviver.shouldAttempt(), false);
  clock.advance(IDLE_REVIVE_BACKOFF_MAX_MS);
  assert.equal(reviver.shouldAttempt(), true, "backoff capped at the maximum");
});

test("gives up permanently once the session file is gone", async () => {
  const { IdleSessionReviver } = await loadSubject();
  const clock = createClock();
  const reviver = new IdleSessionReviver({ isVisible: () => true, now: clock.now });

  reviver.markAttemptStarted();
  reviver.reportOutcome("not_found");
  clock.advance(Number.MAX_SAFE_INTEGER);
  assert.equal(reviver.shouldAttempt(), false, "404 is terminal");
});

test("a success clears accumulated backoff so later reclaims revive promptly", async () => {
  const { IdleSessionReviver } = await loadSubject();
  const clock = createClock();
  const reviver = new IdleSessionReviver({ isVisible: () => true, now: clock.now });

  reviver.markAttemptStarted();
  reviver.reportOutcome("failed");
  clock.advance(10 * 60 * 1000);
  reviver.markAttemptStarted();
  reviver.reportOutcome("ok");

  // Session is reclaimed again after the next idle window: the next attempt
  // must not inherit the stale backoff.
  clock.advance(10 * 60 * 1000);
  assert.equal(reviver.shouldAttempt(), true);
  reviver.markAttemptStarted();
  reviver.reportOutcome("failed");
  assert.equal(reviver.shouldAttempt(), false, "backoff restarts from the base");
});

test("supports custom backoff bounds", async () => {
  const { IdleSessionReviver } = await loadSubject();
  const clock = createClock();
  const reviver = new IdleSessionReviver({
    isVisible: () => true,
    now: clock.now,
    baseDelayMs: 100,
    maxDelayMs: 250,
  });

  reviver.markAttemptStarted();
  reviver.reportOutcome("failed");
  clock.advance(100);
  assert.equal(reviver.shouldAttempt(), true);
  reviver.markAttemptStarted();
  reviver.reportOutcome("failed");
  clock.advance(200);
  assert.equal(reviver.shouldAttempt(), true, "second delay is 200ms");
  reviver.markAttemptStarted();
  reviver.reportOutcome("failed");
  clock.advance(250);
  assert.equal(reviver.shouldAttempt(), true, "third delay capped at 250ms");
});
