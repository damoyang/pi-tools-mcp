# Pi Tools MCP

A local stdio MCP server for the built-in coding tools from [Pi v1.5.2](https://github.com/earendil-works/pi/releases/tag/v1.5.2). The MCP host supplies the model, system prompt, permissions and orchestration. The server runs the vendored Pi tool implementations directly and requires only Node.js 22.19 or later. It exposes the MCP `tools` capability.

## Install

Install the package from the [GitHub release](https://github.com/damoyang/pi-tools-mcp/releases/tag/v0.1.0).

```sh
npm install -g https://github.com/damoyang/pi-tools-mcp/releases/download/v0.1.0/pi-tools-mcp-0.1.0.tgz
pi-tools-mcp --help
```

For a local checkout, run:

```sh
git clone https://github.com/damoyang/pi-tools-mcp.git
cd pi-tools-mcp
npm ci
node src/cli.js --help
```

## Connect an MCP client

For clients that accept an `mcpServers` JSON configuration, point `node` at the checked-out CLI. Use absolute paths to the CLI and your project.

```json
{
  "mcpServers": {
    "pi-tools": {
      "command": "node",
      "args": [
        "/absolute/path/to/pi-tools-mcp/src/cli.js",
        "--cwd",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

On Windows, JSON paths such as `C:/Projects/pi-tools-mcp/src/cli.js` work with the native Node executable. If your client has a different `PATH` from your terminal, set `command` to the absolute path to Node. You can also configure a global install using the path to its JavaScript entry point. Run `npm root -g` to locate the global `node_modules` directory, then append `pi-tools-mcp/src/cli.js`.

`--cwd` defaults to the server's startup directory. `--tools read,grep,find,ls` exposes only the file inspection tools. Use `--shell-path PATH` to select a particular Bash executable. A relative shell path is resolved from the server's startup directory. Pass `--skip-permissions` to mark all exposed tools with `readOnlyHint: true`, prompting MCP clients to skip permission confirmation prompts for write and shell tools. A trusted client can run shell commands and read or modify any files accessible to the server process. `--cwd` is a base for resolving relative paths.

## Tools

| Tool | Behavior | Availability |
| --- | --- | --- |
| `read` | Read text with line ranges and truncation, or return an image block | Default |
| `bash` | Run Bash with optional timeout and output truncation | Default |
| `edit` | Replace exact text, including multiple targeted edits in one call | Default |
| `write` | Create or overwrite a file and create parent directories | Default |
| `grep` | Search file contents with ripgrep | Default |
| `find` | Find paths by glob with fd | Default |
| `ls` | List directory entries | Default |
| `powershell` | Run Windows PowerShell or PowerShell 7 | Native Windows, enabled with `--tools` |

Tool arguments are validated against the upstream schemas, after Pi's argument normalization when applicable. Tool failures carry MCP's `isError` flag, including nonzero shell exit codes. Shell calls include an object in `structuredContent` with the exit code and output. The server passes request cancellation to Pi's tools. When available, Pi's result details are included in `_meta["pi-tools-mcp/details"]`.

## Platforms

| Environment | Shell and search tools |
| --- | --- |
| macOS or Linux | Pi's Bash discovery selects system Bash, Bash on `PATH`, or `sh` when Bash is absent. |
| Native Windows | Install Git for Windows for Bash, set `--shell-path`, or select `--tools read,powershell,edit,write,grep,find,ls`. Pi prefers `pwsh.exe` and falls back to `powershell.exe`. |
| WSL | Launch the MCP subprocess with Linux Node inside the distribution. Linux paths, commands, and `rg`/`fd` apply. |
| Android (Termux) | Install `nodejs`, `bash`, `which`, `ripgrep`, and `fd` with `pkg`. Launch the subprocess inside Termux. |

Pi's upstream resolver checks for `rg` and `fd` (or `fdfind`) on the machine. On desktop x64 and ARM64 it can download missing tools from their upstream releases. Downloads use the server's per-user cache, configurable with `PI_TOOLS_MCP_BIN_DIR`. Set `PI_OFFLINE=1` to use existing binaries only.

The [GitHub Actions matrix](https://github.com/damoyang/pi-tools-mcp/actions/workflows/ci.yml) runs the same stdio integration tests on macOS, Linux, and Windows, with native x64 and ARM64 jobs. WSL and Termux use Pi's upstream platform logic and have no separate CI jobs.

## Development and provenance

Run `npm ci` and `npm test`. The test suite starts the CLI as a subprocess with the official MCP SDK client. The package can be built with `npm pack`.

The vendored JavaScript is from the npm distribution of Pi v1.5.2. The adapters remove Pi's prompt metadata and terminal rendering and supply the version and binary cache location used by the standalone tools. See [third-party notices](THIRD_PARTY_NOTICES.md) for the pinned revision, license and regeneration steps.
