#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { availableTools, createServer, defaultTools } from "./server.js";
import packageJson from "../package.json" with { type: "json" };

const help = `Usage: pi-tools-mcp [--cwd DIRECTORY] [--tools NAME,NAME,...] [--shell-path PATH]

  --cwd           Base directory for relative paths and shell commands (default: process cwd)
  --tools         Tools to expose (default: ${defaultTools.join(",")})
  --shell-path    Use a custom Bash executable
  --help          Show this help
  --version       Print the server version

Available tools on this platform: ${availableTools.join(", ")}
`;

async function main() {
  const { values } = parseArgs({
    options: {
      cwd: { type: "string" },
      tools: { type: "string" },
      "shell-path": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.help || values.version) {
    process.stdout.write(values.help ? help : `${packageJson.version}\n`);
    return;
  }

  const toolNames = values.tools === undefined
    ? defaultTools
    : [...new Set(values.tools.split(",").map((name) => name.trim()))];
  for (const name of toolNames) {
    if (name === "powershell" && process.platform !== "win32") {
      throw new Error("The powershell tool is only available on native Windows.");
    }
    if (!availableTools.includes(name)) throw new Error(`Unknown tool: ${name || "(empty)"}`);
  }

  const cwd = resolve(values.cwd ?? ".");
  if (!(await stat(cwd)).isDirectory()) throw new Error(`Working directory is not a directory: ${cwd}`);

  const shellPath = values["shell-path"] && resolve(values["shell-path"]);
  const server = createServer({ cwd, toolNames, shellPath });
  const close = () => {
    process.removeListener("SIGINT", close);
    process.removeListener("SIGTERM", close);
    process.stdin.removeListener("end", close);
    void server.close().catch(reportError);
  };
  server.onerror = (error) => console.error(`pi-tools-mcp: ${error.message}`);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.stdin.once("end", close);
  await server.connect(new StdioServerTransport());
}

function reportError(error) {
  console.error(`pi-tools-mcp: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}

await main().catch(reportError);
