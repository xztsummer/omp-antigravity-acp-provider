import { describe, expect, it, vi } from "vitest";

import { projectModels, resolveAcpModelId } from "../src/models.js";
import { createAntigravityProvider } from "../src/provider.js";
import { MANAGED_AUTH_MARKER } from "../src/constants.js";

describe("projectModels", () => {
	it("deduplicates and rejects unsafe ids", () => {
		const models = projectModels([
			{ modelId: "gemini-a", name: "Gemini A" },
			{ modelId: "gemini-a", name: "duplicate" },
			{ modelId: "bad\nmodel", name: "bad" },
		]);
		expect(models.map((model) => model.id)).toEqual(["gemini-a"]);
		expect(models[0]?.cost.input).toBe(0);
	});

	it("collapses ACP effort variants into Pi reasoning levels", () => {
		const models = projectModels([
			{ modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
			{ modelId: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
			{ modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
			{ modelId: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
			{ modelId: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
		]);

		expect(models.map((model) => model.id)).toEqual(["gemini-3.8-flash", "gemini-3.1-pro"]);
		expect(models[0]?.thinking?.effortRouting?.off).toBeUndefined();
		expect(models[0]?.thinking?.effortRouting?.medium).toBe("gemini-3.8-flash-medium");
		expect(resolveAcpModelId(models[0]!, "low")).toBe("gemini-3.8-flash-low");
		expect(resolveAcpModelId(models[0]!, "high")).toBe("gemini-3.8-flash-high");
		expect(models[1]?.thinking?.effortRouting?.medium).toBeUndefined();
		expect(resolveAcpModelId(models[1]!, "medium")).toBe("gemini-pro-agent");
	});

	it("registers the OMP OAuth adapter and stream provider", async () => {
		const { provider, runtime } = createAntigravityProvider();
		try {
			expect(provider.oauth?.name).toBe("Google Antigravity (official ACP)");
			expect(provider.streamSimple).toBeTypeOf("function");
		} finally {
			await runtime.close();
		}
	});

	it("relays OMP OAuth callbacks and stores only a non-secret marker", async () => {
		const { provider, runtime } = createAntigravityProvider();
		const signal = new AbortController().signal;
		const onAuth = vi.fn();
		const onManualCodeInput = vi.fn(async () => "http://127.0.0.1:1234/?code=example&state=test");
		vi.spyOn(runtime, "loginGoogle").mockImplementation(async (receivedSignal, _progress, interaction) => {
			expect(receivedSignal).toBe(signal);
			interaction!.showAuthorizationUrl("https://accounts.google.com/example", "Sign in with the official runtime");
			expect(await interaction!.promptForCallback(signal)).toContain("code=example");
		});
		try {
			const credentials = await provider.oauth!.login({ onAuth, onPrompt: vi.fn(), onManualCodeInput, signal });
			if (typeof credentials === "string") throw new Error("Expected an OMP OAuth marker credential");
			expect(onAuth).toHaveBeenCalledWith({ url: "https://accounts.google.com/example", instructions: "Sign in with the official runtime" });
			expect(onManualCodeInput).toHaveBeenCalledWith(signal);
			expect(credentials.access).toBe(MANAGED_AUTH_MARKER);
			expect(credentials.refresh).toBe(MANAGED_AUTH_MARKER);
		} finally { await runtime.close(); }
	});

	it("discovers models through ACP with a deadline within OMP's discovery limit", async () => {
		const { provider, runtime } = createAntigravityProvider();
		const discover = vi.spyOn(runtime, "discoverModels").mockResolvedValue([
			{ modelId: "gemini-test-low", name: "Gemini Test (Low)" },
			{ modelId: "gemini-test-high", name: "Gemini Test (High)" },
		]);
		try {
			const models = await provider.fetchDynamicModels!(MANAGED_AUTH_MARKER);
			expect(models[0]?.id).toBe("gemini-test");
			expect(models[0]?.thinking?.effortRouting?.high).toBe("gemini-test-high");
			expect(discover).toHaveBeenCalledWith(MANAGED_AUTH_MARKER, expect.any(AbortSignal));
		} finally { await runtime.close(); }
	});
});
