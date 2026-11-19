import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const builtIns = ["bash", "edit", "find", "grep", "ls", "read", "write"];

async function connect(t, flags = [], launcherDir) {
  assert.ok(existsSync(cli), "the pi-tools-mcp stdio executable exists");
  const cwd = await mkdtemp(join(tmpdir(), "pi tools mcp "));
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    cwd: launcherDir,
    args: [cli, "--cwd", cwd, ...flags],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|SYSTEMROOT|PROGRAMFILES(?:\(X86\))?|LOCALAPPDATA|HOME|USERPROFILE|TEMP|TMP|PREFIX|PI_OFFLINE|PI_TOOLS_MCP_BIN_DIR)$/i.test(key)
      )
    ),
    stderr: "pipe",
  });
  const protocolErrors = [];
  const stderr = [];
  client.onerror = (error) => protocolErrors.push(error.message);
  transport.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  t.after(async () => {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
    assert.deepEqual(protocolErrors, [], "stdout carries only MCP messages");
    assert.deepEqual(stderr, [], "normal tool operations keep stderr quiet");
  });
  await client.connect(transport);
  return { cwd, client };
}

function call(client, name, args, options) {
  return client.callTool({ name, arguments: args }, undefined, options);
}

function asText(result) {
  return result.content.filter(({ type }) => type === "text").map(({ text }) => text).join("\n");
}

test("stdio advertises just the built-in tool capability", async (t) => {
  const { client } = await connect(t);
  assert.deepEqual(Object.keys(client.getServerCapabilities()), ["tools"]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), builtIns);
  assert.deepEqual(tools.find(({ name }) => name === "read").inputSchema.required, ["path"]);
});

test("a caller can select a subset of tools", async (t) => {
  const { client } = await connect(t, ["--tools", "read,ls"]);
  assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), ["read", "ls"]);
  await assert.rejects(call(client, "bash", { command: "exit 0" }), /Unknown tool: bash/);
});

test("writes, edits and reads Unicode files relative to the configured directory", async (t) => {
  const { client, cwd } = await connect(t);
  const path = "子目录/hello world.txt";
  const write = await call(client, "write", { path, content: "alpha\r\nbeta\r\n" });
  assert.equal(write.isError, undefined, asText(write));
  const edit = await call(client, "edit", {
    path,
    edits: [{ oldText: "alpha", newText: "bonjour" }, { oldText: "beta", newText: "再见" }],
  });
  assert.equal(edit.isError, undefined, asText(edit));
  assert.match(edit._meta["pi-tools-mcp/details"].patch, /\+bonjour/);
  assert.equal(await readFile(join(cwd, path), "utf8"), "bonjour\r\n再见\r\n");
  assert.match(asText(await call(client, "read", { path, offset: 2, limit: 1 })), /再见/);
  assert.match(asText(await call(client, "ls", { path: "子目录" })), /hello world\.txt/);
});

test("normalizes Pi's legacy edit arguments before validating", async (t) => {
  const { client, cwd } = await connect(t);
  await writeFile(join(cwd, "notes.txt"), "before");
  const result = await call(client, "edit", {
    path: "notes.txt", oldText: "before", newText: "after",
  });
  assert.equal(result.isError, undefined, asText(result));
  assert.equal(await readFile(join(cwd, "notes.txt"), "utf8"), "after");
});

test("searches content and finds files through the upstream backends", async (t) => {
  const { client, cwd } = await connect(t);
  await writeFile(join(cwd, "notes.txt"), "needle\n");
  const grep = await call(client, "grep", { pattern: "needle" }, { timeout: 180_000 });
  assert.equal(grep.isError, undefined, asText(grep));
  assert.match(asText(grep), /notes\.txt:1: needle/);
  const finds = await Promise.all([
    call(client, "find", { pattern: "*.txt" }, { timeout: 180_000 }),
    call(client, "find", { pattern: "notes.*" }, { timeout: 180_000 }),
  ]);
  for (const result of finds) {
    assert.equal(result.isError, undefined, asText(result));
    assert.match(asText(result), /notes\.txt/);
  }
});

test("returns images as MCP image blocks", async (t) => {
  const { client, cwd } = await connect(t);
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
  await writeFile(join(cwd, "pixel.png"), Buffer.from(pixel, "base64"));
  const result = await call(client, "read", { path: "pixel.png" });
  assert.equal(result.isError, undefined, asText(result));
  const image = result.content.find(({ type }) => type === "image");
  assert.equal(image?.mimeType, "image/png", JSON.stringify(result.content));
  assert.equal(Buffer.from(image.data, "base64").subarray(1, 4).toString("ascii"), "PNG");
});

test("bash uses the configured directory and reports nonzero exit codes", async (t) => {
  const { client, cwd } = await connect(t);
  await writeFile(join(cwd, "shell file.txt"), "from cwd");
  const success = await call(client, "bash", { command: "cat 'shell file.txt'" });
  assert.equal(asText(success), "from cwd");
  const failure = await call(client, "bash", { command: "printf 'message'; exit 7" });
  assert.equal(failure.isError, true);
  assert.equal(failure.structuredContent.exit_code, 7);
  assert.match(asText(failure), /message/);
});

test("bash enforces tool timeouts", async (t) => {
  const { client } = await connect(t);
  const result = await call(client, "bash", { command: "sleep 30", timeout: 0.5 }, { timeout: 10_000 });
  assert.equal(result.isError, true);
  assert.match(asText(result), /timed out/i);
});

test("PowerShell is opt-in on native Windows", { skip: process.platform !== "win32" }, async (t) => {
  const { client, cwd } = await connect(t, ["--tools", "powershell"]);
  await writeFile(join(cwd, "shell file.txt"), "from cwd");
  assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), ["powershell"]);
  const result = await call(client, "powershell", { command: "Get-Content -Raw -LiteralPath 'shell file.txt'" });
  assert.equal(result.isError, undefined, asText(result));
  assert.equal(asText(result).trim(), "from cwd");
});

test("bad arguments and file errors produce MCP tool errors", async (t) => {
  const { client } = await connect(t);
  const invalid = await call(client, "read", { path: 42 });
  assert.equal(invalid.isError, true);
  assert.match(asText(invalid), /Invalid arguments/);
  const missing = await call(client, "read", { path: "missing.txt" });
  assert.equal(missing.isError, true);
  assert.match(asText(missing), /missing\.txt/);
});

test("invalid CLI arguments fail on stderr", () => {
  assert.throws(() => execFileSync(process.execPath, [cli, "--tools", "invalid"], { stdio: "pipe" }),
    (error) => error.status === 1 && /Unknown tool: invalid/.test(error.stderr.toString())
      && error.stdout.length === 0);
});

test("grep honors cancellation while preparing the search", async (t) => {
  const { client, cwd } = await connect(t);
  await writeFile(join(cwd, "notes.txt"), "find me\n");
  const warmup = await call(client, "grep", { pattern: "find me" }, { timeout: 180_000 });
  assert.equal(warmup.isError, undefined, asText(warmup));

  const { createGrepTool } = await import("../vendor/pi/core/tools/grep.js");
  const controller = new AbortController();
  const tool = createGrepTool(cwd, {
    operations: {
      isDirectory: async () => {
        controller.abort();
        return true;
      },
    },
  });
  await assert.rejects(tool.execute("cancelled-grep", { pattern: "find me" }, controller.signal), /Operation aborted/);
});

test("resolves a relative custom shell path from the launcher directory", { skip: process.platform === "win32" }, async (t) => {
  const bash = execFileSync("which", ["bash"], { encoding: "utf8" }).trim();
  const launcherDir = await mkdtemp(join(tmpdir(), "pi-shell-launcher-"));
  t.after(() => rm(launcherDir, { recursive: true, force: true }));
  await symlink(bash, join(launcherDir, "test-bash"));
  const { client } = await connect(t, ["--shell-path", "./test-bash"], launcherDir);
  const result = await call(client, "bash", { command: "printf 'custom shell'" });
  assert.equal(result.isError, undefined, asText(result));
  assert.equal(asText(result), "custom shell");
});
