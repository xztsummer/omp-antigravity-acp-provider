import type { Api, Model } from "@oh-my-pi/pi-ai";
import { describe, expect, it } from "vitest";

import { PiEventWriter } from "../src/stream/pi-events.js";

const model: Model<Api> = {
	id: "test",
	name: "Test",
	api: "antigravity-acp",
	provider: "antigravity-acp",
	baseUrl: "",
	identity: { class: "unknown" },
	compat: undefined,
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000,
	maxTokens: 100,
};

describe("PiEventWriter", () => {
	it("balances blocks when switching thought and text", async () => {
		const writer = new PiEventWriter(model);
		writer.thinking("think");
		writer.text("answer");
		writer.done("stop");
		const events = [];
		for await (const event of writer.stream) events.push(event);
		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"done",
		]);
	});

	it("emits a valid empty response", async () => {
		const writer = new PiEventWriter(model);
		writer.done("stop");
		const events = [];
		for await (const event of writer.stream) events.push(event);
		expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_end", "done"]);
	});

	it("emits a complete synthetic tool call", async () => {
		const writer = new PiEventWriter(model);
		writer.toolCall("call-1", "permission", { requestId: "one" });
		writer.done("toolUse");
		const events = [];
		for await (const event of writer.stream) events.push(event);
		expect(events.map((event) => event.type)).toEqual([
			"start",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		expect(writer.message.stopReason).toBe("toolUse");
	});

	it("terminates errors once", async () => {
		const writer = new PiEventWriter(model);
		writer.fail(new Error("failed"));
		writer.done("stop");
		const events = [];
		for await (const event of writer.stream) events.push(event);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: "error", reason: "error" });
	});
});
