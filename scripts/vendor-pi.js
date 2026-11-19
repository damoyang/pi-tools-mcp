import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = "1.5.2";
const input = process.argv[2];
if (!input) throw new Error("Usage: node scripts/vendor-pi.js /path/to/unpacked/npm/package");

const source = resolve(input);
const destination = fileURLToPath(new URL("../vendor/pi/", import.meta.url));
const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
if (pkg.name !== "@earendil-works/pi-coding-agent" || pkg.version !== version) {
  throw new Error(`Expected @earendil-works/pi-coding-agent@${version}`);
}

const tools = [
  "bash", "edit", "edit-diff", "file-mutation-queue", "find", "grep", "index", "ls", "output-accumulator",
  "path-utils", "powershell", "read", "tool-definition-wrapper", "truncate", "write",
];
const utils = [
  "child-process", "exif-orientation", "image-convert", "image-process", "image-resize",
  "image-resize-core", "image-resize-worker", "management-http", "mime", "output-files", "paths",
  "photon", "shell", "text", "tools-manager",
];

async function put(file, code) {
  const target = join(destination, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, code);
}

for (const base of tools) {
  const file = `core/tools/${base}.js`;
  const upstream = await readFile(join(source, "dist", file), "utf8");
  let code = upstream
    .replace(/^import .* from "\.\/renderers\/.*";\n/gm, "")
    .replace(/^ {8}\.\.\.(?:\w+Renderers|createShellRenderers\(config\.prompt\)),\n/gm, "")
    .replace(/^export const \w+ToolSystemPromptContribution = \{\n[\s\S]*?^\};\n/gm, "")
    .replace(/^ +prompt(?:Snippet|Guidelines)?: .*\n/gm, "");
  if (base === "grep") {
    // Cancellation can arrive before the ripgrep process or its listener exists.
    code = code.replace('                        const rgPath = await ensureTool("rg");', `                        const rgPath = await ensureTool("rg");
                        if (signal?.aborted) throw new Error("Operation aborted");`)
      .replace("                        // Clamp so String()", `                        if (signal?.aborted) throw new Error("Operation aborted");
                        // Clamp so String()`);
  }
  if (base === "read") {
    code = code.replace("First line alone exceeds the byte limit. Point the model at a bash fallback.",
      "First line alone exceeds the byte limit.")
      .replace(/ limit\. Use bash: sed .*?\]`;/, " limit.]`;");
  }
  const throttle = base === "bash" ? "const BASH_UPDATE_THROTTLE_MS = 100;\n" : "";
  await put(file, throttle + code.replace(/^\/\/# sourceMappingURL=.*$/m, "").trimEnd() + "\n");
}

for (const base of utils) {
  const file = `utils/${base}.js`;
  let code = await readFile(join(source, "dist", file), "utf8");
  if (base === "image-convert") {
    // The remaining exports serve terminal graphics. Keep the shared PNG encoder.
    code = code.split("\n/**\n * Convert image to PNG format for terminal display.")[0]
      .replace(/^import .* from "@earendil-works\/pi-tui";\n/m, "");
  }
  if (base === "tools-manager") {
    code = code.replace('import { getPiUserAgent } from "./pi-user-agent.js";\n', "")
      .replace("getPiUserAgent(VERSION)", '`pi-tools-mcp (Pi ${VERSION})`');
    // Use a private download directory for each install, including concurrent MCP servers.
    // Move the ready executable into the cache only after setting its permissions.
    code = code.replace("mkdirSync, readdirSync", "mkdirSync, mkdtempSync, readdirSync")
      .replace("    const archivePath = join(TOOLS_DIR, assetName);\n", "")
      .replace(/    \/\/ Download\n[\s\S]*?    try \{\n(?=        if \(assetName)/, `    const extractDir = mkdtempSync(join(TOOLS_DIR, ".install-"));
    const archivePath = join(extractDir, assetName);
    try {
        await downloadFile(downloadUrl, archivePath);
`)
      .replace("            renameSync(extractedBinary, binaryPath);", `            if (plat !== "win32") chmodSync(extractedBinary, 0o755);
            if (!existsSync(binaryPath)) {
                try {
                    renameSync(extractedBinary, binaryPath);
                } catch (error) {
                    if (!existsSync(binaryPath)) throw error;
                }
            }`)
      .replace(/        \/\/ Make executable \(Unix only\)\n        if \(plat !== "win32"\) \{\n            chmodSync\(binaryPath, 0o755\);\n        \}\n/, "")
      .replace("        rmSync(archivePath, { force: true });\n", "");
  }
  if (base === "shell") {
    code = code.replace("Set shellPath in settings.json", "Pass --shell-path to pi-tools-mcp");
  }
  await put(file, code.replace(/^\/\/# sourceMappingURL=.*$/m, "").trimEnd() + "\n");
}

await put("config.js", `// Minimal config for the vendored Pi shell and search tools.
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const VERSION = "${version}";

export function getBinDir() {
  if (process.env.PI_TOOLS_MCP_BIN_DIR) return resolve(process.env.PI_TOOLS_MCP_BIN_DIR);

  const cacheDir = process.platform === "win32"
    ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    : process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheDir, "pi-tools-mcp", "bin");
}
`);
