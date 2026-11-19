// Minimal config for the vendored Pi shell and search tools.
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const VERSION = "1.5.2";

export function getBinDir() {
  if (process.env.PI_TOOLS_MCP_BIN_DIR) return resolve(process.env.PI_TOOLS_MCP_BIN_DIR);

  const cacheDir = process.platform === "win32"
    ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    : process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheDir, "pi-tools-mcp", "bin");
}
