import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath, sessionFileRevision } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

// GET /api/sessions/[id]/freshness - Cheap freshness signal for idle
// sessions. The chat polls this at low frequency while the agent event
// stream is disconnected and reloads messages when the revision changes
// (for example, a turn injected by an extension into an idle session).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;

    let filePath: string | null = liveRpc?.sessionFile || null;
    if (!filePath) filePath = await resolveSessionPath(id);
    if (!filePath && !liveRpc) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // A live session keeps entries in memory until the first assistant
    // message flushes them, so fall back to the in-memory entry count.
    let revision = sessionFileRevision(filePath);
    if (!revision && liveRpc) {
      revision = `mem:${liveRpc.inner.sessionManager.getEntries().length}`;
    }

    return NextResponse.json(
      {
        revision,
        running: liveRpc ? liveRpc.isRunning() : false,
        // Whether the server-side wrapper is alive. A dead wrapper means
        // the session was reclaimed by the idle shutdown and the chat may
        // revive it (see lib/idle-session-revive.ts). Cheap registry lookup,
        // never starts anything.
        alive: Boolean(liveRpc),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
