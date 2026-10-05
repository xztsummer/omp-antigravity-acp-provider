import { execFileSync } from "node:child_process";

/** The macOS ACP runtime's Python HTTP client can select system SOCKS settings
 * without bundling python-socks. Prefer an enabled system HTTP proxy when the
 * caller has not explicitly chosen proxy settings. Never rewrite SOCKS URLs. */
export function applyAcpProxyEnvironment(
	env: NodeJS.ProcessEnv,
	platform = process.platform,
	readSystemProxy: () => string = () => execFileSync("/usr/sbin/scutil", ["--proxy"], {
		encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"],
	}),
): NodeJS.ProcessEnv {
	const result = { ...env };
	const explicit = env.OMP_ANTIGRAVITY_ACP_PROXY?.trim();
	if (explicit) {
		const url = new URL(explicit);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("OMP_ANTIGRAVITY_ACP_PROXY must be an HTTP or HTTPS proxy URL; the official ACP runtime does not bundle SOCKS support.");
		}
		setProxy(result, explicit);
	} else if (platform === "darwin" && !["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].some(key => env[key])) {
		try {
			const settings = readSystemProxy();
			const field = (key: string) => settings.match(new RegExp(`^\\s*${key}\\s*:\\s*(.*?)\\s*$`, "m"))?.[1];
			const kind = field("HTTPSEnable") === "1" ? "HTTPS" : field("HTTPEnable") === "1" ? "HTTP" : undefined;
			const host = kind && field(`${kind}Proxy`);
			const port = kind && Number(field(`${kind}Port`));
			if (host && port && Number.isInteger(port) && port > 0 && port <= 65535) {
				const url = new URL(`http://${host.includes(":") ? `[${host}]` : host}:${port}`);
				setProxy(result, url.toString());
			}
		} catch {
			// An unavailable system proxy probe must not prevent runtime startup.
		}
	}
	if (["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].some(key => result[key])) {
		// The authenticated MCP bridge is local; don't send it to a remote proxy.
		const bypass = [...new Set([...(result.NO_PROXY ?? "").split(","), ...(result.no_proxy ?? "").split(","), "localhost", "127.0.0.1", "::1"].filter(Boolean))].join(",");
		result.NO_PROXY = result.no_proxy = bypass;
	}
	return result;
}

function setProxy(env: NodeJS.ProcessEnv, url: string): void {
	for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) env[key] = url;
}
