import type { Tool } from "@oh-my-pi/pi-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "@oh-my-pi/omptype/typebox";
import { type } from "@oh-my-pi/omptype";
import { describe, expect, it, vi } from "vitest";

import { PiMcpBridge } from "../src/mcp/bridge.js";

const tools: Tool[] = [
	{
		name: "echo",
		description: "Echo text",
		parameters: Type.Object({ text: Type.String() }),
	},
];

describe("PiMcpBridge", () => {
	it.each(["typebox", "omptype", "omp-wire"])("authenticates and revalidates original %s arguments", async (schemaKind) => {
		const onCall = vi.fn(async ({ arguments: args }) => ({
			content: [{ type: "text" as const, text: String(args.text) }],
		}));
		const native = type({ text: "string", i: "string" });
		const parameters = schemaKind === "omp-wire" ? native.toJsonSchema() as unknown as Tool["parameters"] : type({ text: "string" });
		const bridge = new PiMcpBridge({ tools: schemaKind === "typebox" ? tools : [{ ...tools[0]!, parameters }], onCall });
		const descriptor = await bridge.start();
		if (!descriptor || !("url" in descriptor)) throw new Error("bridge did not start");
		const headers = Object.fromEntries(descriptor.headers.map((header) => [header.name, header.value]));
		const client = new Client({ name: "bridge-test", version: "1" }, { capabilities: {} });
		const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
			requestInit: { headers },
		});
		try {
			await client.connect(transport as Parameters<typeof client.connect>[0]);
			const catalog = await client.listTools();
			expect(catalog.tools.map((tool) => tool.name)).toEqual(["pi_echo"]);
			const invalid = await client.callTool({ name: "pi_echo", arguments: { text: 7 } });
			expect(invalid.isError).toBe(true);
			expect(onCall).not.toHaveBeenCalled();
			if (schemaKind === "omp-wire") {
				const missingIntent = await client.callTool({ name: "pi_echo", arguments: { text: "hello" } });
				expect(missingIntent.isError).toBe(true);
				expect(onCall).not.toHaveBeenCalled();
			}
			const valid = await client.callTool({ name: "pi_echo", arguments: { text: "hello", ...(schemaKind === "omp-wire" ? { i: "Echo the test string" } : {}) } });
			expect(valid.content).toEqual([{ type: "text", text: "hello" }]);
			expect(onCall).toHaveBeenCalledOnce();
			const unauthorized = await fetch(descriptor.url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			});
			expect(unauthorized.status).toBe(401);
		} finally {
			await client.close();
			await bridge.close();
		}
	});
});
