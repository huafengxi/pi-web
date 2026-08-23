import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./[id]/freshness/route.ts", import.meta.url), "utf8");
const detailSource = await readFile(new URL("./[id]/route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET: getSessionFreshness } = await jiti.import("./[id]/freshness/route.ts");

test("freshness route is cheap and cache-free", () => {
  // The idle chat polls this every few seconds; it must stay a stat-only
  // endpoint without parsing the session file.
  assert.match(source, /sessionFileRevision\(filePath\)/);
  assert.match(source, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(source, /getEntries\(\)\.length\)\./);
  assert.match(source, /running: liveRpc \? liveRpc\.isRunning\(\) : false/);
  // The idle chat uses this flag to revive idle-reclaimed sessions. It must
  // be a plain registry lookup — no startRpcSession in this route.
  assert.match(source, /alive: Boolean\(liveRpc\)/);
  assert.doesNotMatch(source, /startRpcSession/);
});

test("session detail anchors the freshness baseline to its snapshot", () => {
  assert.match(detailSource, /freshness: sessionFileRevision\(filePath\)/);
});

test("freshness reflects the live registry before any file exists", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "freshness-live-test";
  const timestamp = "2026-08-23T01:02:03.000Z";
  const entry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp,
    message: { role: "user", content: "hello freshness" },
  };
  const sessionManager = {
    getEntries: () => [entry],
    getSessionFile: () => `/tmp/pi-web-freshness-not-persisted-${process.pid}.jsonl`,
  };
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isRunning: () => true,
    inner: { sessionManager },
    sessionFile: sessionManager.getSessionFile(),
    sessionId: id,
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const routeContext = { params: Promise.resolve({ id }) };
  const response = await getSessionFreshness(
    new Request(`http://localhost/api/sessions/${id}/freshness`),
    routeContext,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revision: "mem:1", running: true, alive: true });
});

test("freshness revision tracks the session file", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const dir = mkdtempSync(join(tmpdir(), "pi-web-freshness-"));
  const filePath = join(dir, "session.jsonl");
  writeFileSync(filePath, '{"type":"session"}\n');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const id = "freshness-file-test";
  const sessionManager = {
    getEntries: () => [],
    getSessionFile: () => filePath,
  };
  globalThis.__piSessions.set(id, {
    isAlive: () => true,
    isRunning: () => false,
    inner: { sessionManager },
    sessionFile: filePath,
    sessionId: id,
  });

  const routeContext = { params: Promise.resolve({ id }) };
  const firstResponse = await getSessionFreshness(
    new Request(`http://localhost/api/sessions/${id}/freshness`),
    routeContext,
  );
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.running, false);
  assert.match(first.revision, /^\d+(\.\d+)?:\d+$/);

  writeFileSync(filePath, '{"type":"message"}\n', { flag: "a" });
  const secondResponse = await getSessionFreshness(
    new Request(`http://localhost/api/sessions/${id}/freshness`),
    routeContext,
  );
  const second = await secondResponse.json();
  assert.notEqual(second.revision, first.revision);
});

test("unknown sessions report 404", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const response = await getSessionFreshness(
    new Request("http://localhost/api/sessions/definitely-missing-session/freshness"),
    { params: Promise.resolve({ id: "definitely-missing-session" }) },
  );
  assert.equal(response.status, 404);
});
