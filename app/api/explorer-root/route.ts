import { NextResponse } from "next/server";
import { getConfiguredExplorerRoot } from "@/lib/explorer-root";

/**
 * Reports the configured Explorer root (PI_WEB_EXPLORER_ROOT), or null when
 * unset so the client keeps its default behavior (following the selected
 * session's cwd).
 */
export async function GET() {
  return NextResponse.json({ root: getConfiguredExplorerRoot() });
}
