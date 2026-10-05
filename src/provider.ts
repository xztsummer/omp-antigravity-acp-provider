import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { hasAntigravityAuth } from "./acp/antigravity.js";
import { API_ID, FALLBACK_MODELS, projectModels, PROVIDER_ID } from "./models.js";
import { AntigravityRuntime, MANAGED_AUTH_MARKER } from "./runtime.js";

export function createAntigravityProvider(runtime = new AntigravityRuntime()): {
	provider: ProviderConfig;
	runtime: AntigravityRuntime;
} {
	const provider: ProviderConfig = {
		api: API_ID,
		// This is a local transport, not a Google HTTP endpoint.
		baseUrl: "acp://antigravity",
		// Reuse the official ACP login without copying Google tokens into OMP.
		...(hasAntigravityAuth() ? { apiKey: MANAGED_AUTH_MARKER } : {}),
		models: [...FALLBACK_MODELS],
		oauth: {
			name: "Google Antigravity (official ACP)",
			async login(callbacks) {
				await runtime.loginGoogle(callbacks.signal, callbacks.onProgress, {
					showAuthorizationUrl(url, instructions) {
						callbacks.onAuth({ url, instructions });
					},
					promptForCallback: (signal) => callbacks.onManualCodeInput
						? callbacks.onManualCodeInput(signal)
						: callbacks.onPrompt({
							message: "Paste the final localhost callback URL:",
							placeholder: "http://127.0.0.1:PORT/?state=…&code=…",
						}),
				});
				return {
					refresh: MANAGED_AUTH_MARKER,
					access: MANAGED_AUTH_MARKER,
					expires: Number.MAX_SAFE_INTEGER,
				};
			},
			async refreshToken(credentials) { return credentials; },
			getApiKey() { return MANAGED_AUTH_MARKER; },
		},
		async fetchDynamicModels(apiKey) {
			if (!apiKey && !hasAntigravityAuth()) return [];
			return projectModels(await runtime.discoverModels(apiKey, AbortSignal.timeout(14_000)));
		},
		streamSimple(model, context, options) {
			return runtime.stream(model, context, options).stream;
		},
	};
	return { provider, runtime };
}

export const ANTIGRAVITY_ACP_API = API_ID;
export { PROVIDER_ID };
