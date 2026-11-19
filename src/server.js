import Ajv from "ajv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { createTool } from "../vendor/pi/core/tools/index.js";
import packageJson from "../package.json" with { type: "json" };

export const defaultTools = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export const availableTools = process.platform === "win32" ? [...defaultTools, "powershell"] : defaultTools;
const readOnlyTools = new Set(["read", "grep", "find", "ls"]);

function toolError(text) {
  return { isError: true, content: [{ type: "text", text }] };
}

export function createServer({ cwd, toolNames, shellPath }) {
  const ajv = new Ajv({ allErrors: true });
  const tools = new Map();
  for (const name of toolNames) {
    const tool = createTool(name, cwd, {
      bash: { shellPath, exposeSessionEnvironment: false },
      powershell: { exposeSessionEnvironment: false },
    });
    const readOnly = readOnlyTools.has(name);
    tools.set(name, {
      tool,
      validate: ajv.compile(tool.parameters),
      definition: {
        name,
        description: tool.description,
        inputSchema: tool.parameters,
        ...(tool.outputSchema?.type === "object" && { outputSchema: tool.outputSchema }),
        annotations: {
          readOnlyHint: readOnly,
          openWorldHint: ["bash", "powershell", "grep", "find"].includes(name),
        },
      },
    });
  }

  const server = new Server({ name: packageJson.name, version: packageJson.version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools.values()].map(({ definition }) => definition),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, { requestId, signal }) => {
    const entry = tools.get(params.name);
    if (!entry) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${params.name}`);

    const { tool, validate } = entry;
    try {
      signal.throwIfAborted();
      const args = params.arguments ?? {};
      const input = tool.prepareArguments ? tool.prepareArguments(args) : args;
      if (!validate(input)) return toolError(`Invalid arguments: ${ajv.errorsText(validate.errors)}`);

      const result = await tool.execute(String(requestId), input, signal);
      const reply = { content: result.content };
      if (result.isError) reply.isError = true;
      if (entry.definition.outputSchema && result.structuredContent !== undefined) {
        reply.structuredContent = result.structuredContent;
      }
      if (result.details !== undefined) reply._meta = { "pi-tools-mcp/details": result.details };
      return reply;
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  });
  return server;
}
