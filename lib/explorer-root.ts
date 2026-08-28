import { homedir } from "os";
import path from "path";

/**
 * Optional configured root for the sidebar Explorer. Set `PI_WEB_EXPLORER_ROOT`
 * (e.g. `/home/user/workspace` or `~/workspace`) to pin the Explorer to that
 * directory instead of following the selected session's cwd. When unset, the
 * behavior is unchanged.
 *
 * This only changes *which* root the UI shows and adds it to the file-access
 * allow-list; all path-traversal protection in lib/path-security.ts
 * (lexical prefix check + realpath containment) still applies, so neither
 * `../` nor symlinks can escape the configured root.
 */
export function getConfiguredExplorerRoot(): string | null {
  const raw = process.env.PI_WEB_EXPLORER_ROOT;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const expanded =
    trimmed === "~"
      ? homedir()
      : trimmed.startsWith("~/")
        ? path.join(homedir(), trimmed.slice(2))
        : trimmed;
  return path.resolve(expanded);
}
