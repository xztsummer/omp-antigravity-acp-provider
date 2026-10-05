import { describe, expect, it, vi } from "vitest";
import { applyAcpProxyEnvironment } from "../src/acp/proxy.js";

const system = `HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7897\nSOCKSEnable : 1\nSOCKSProxy : 127.0.0.1\nSOCKSPort : 7897`;
describe("official ACP proxy environment", () => {
	it("prefers an enabled macOS HTTP proxy and bypasses the local MCP bridge", () => {
		const source = { NO_PROXY: "example.com" };
		const result = applyAcpProxyEnvironment(source, "darwin", () => system);
		expect(result.HTTPS_PROXY).toBe("http://127.0.0.1:7897/");
		expect(result.ALL_PROXY).toBe(result.HTTPS_PROXY);
		expect(result.no_proxy).toBe("example.com,localhost,127.0.0.1,::1");
		expect(source).toEqual({ NO_PROXY: "example.com" });
	});
	it("preserves explicitly selected proxies", () => {
		const probe = vi.fn(() => system);
		const result = applyAcpProxyEnvironment({ https_proxy: "http://proxy:8080", no_proxy: "internal" }, "darwin", probe);
		expect(result.https_proxy).toBe("http://proxy:8080");
		expect(result.no_proxy).toContain("internal");
		expect(probe).not.toHaveBeenCalled();
	});
	it("uses the dedicated override without changing the parent environment", () => {
		const result = applyAcpProxyEnvironment({ OMP_ANTIGRAVITY_ACP_PROXY: "http://local:1234", ALL_PROXY: "socks5://old:1" }, "linux");
		expect(result.ALL_PROXY).toBe("http://local:1234");
	});
	it("does not reinterpret SOCKS-only system settings", () => {
		expect(applyAcpProxyEnvironment({}, "darwin", () => "SOCKSEnable : 1\nSOCKSProxy : localhost\nSOCKSPort : 1234")).toEqual({});
		expect(() => applyAcpProxyEnvironment({ OMP_ANTIGRAVITY_ACP_PROXY: "socks5://localhost:1234" })).toThrow("HTTP or HTTPS");
	});
	it("tolerates an unavailable macOS probe", () => {
		expect(applyAcpProxyEnvironment({}, "darwin", () => { throw new Error("unavailable"); })).toEqual({});
	});
});
