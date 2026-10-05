import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import type { ModelInfo } from "@agentclientprotocol/sdk";
import type {
	ModelSpec,
} from "@oh-my-pi/pi-ai";

export const PROVIDER_ID = "antigravity-acp";
export const API_ID = "antigravity-acp";

export type AntigravityModelSpec = ModelSpec<typeof API_ID> & ProviderModelConfig;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
type Effort = "low" | "medium" | "high";
type Variants = Partial<Record<Effort, string>>;

export const FALLBACK_MODELS: readonly AntigravityModelSpec[] = [
	reasoningModel("gemini-3.8-flash", "Gemini 3.8 Flash", {
		low: "gemini-3.8-flash-low",
		medium: "gemini-3.8-flash-medium",
		high: "gemini-3.8-flash-high",
	}),
	reasoningModel("gemini-3.7-flash", "Gemini 3.7 Flash", {
		low: "gemini-3.7-flash-low",
		medium: "gemini-3.7-flash-medium",
		high: "gemini-3.7-flash-high",
	}),
	reasoningModel("gemini-3.6-flash", "Gemini 3.6 Flash", {
		low: "gemini-3.6-flash-low",
		medium: "gemini-3.6-flash-medium",
		high: "gemini-3.6-flash-high",
	}),
	reasoningModel("gemini-3.1-pro", "Gemini 3.1 Pro", {
		low: "gemini-3.1-pro-low",
		high: "gemini-pro-agent",
	}),
];

/** Collapse Antigravity's effort-qualified ACP IDs into one OMP model. The
 * exact server IDs live in thinking.effortRouting, allowing Shift+Tab to select the
 * corresponding low/medium/high variant without cluttering /model. */
export function projectModels(models: readonly ModelInfo[]): AntigravityModelSpec[] {
	const safe = models.filter((candidate) => validModelId(candidate.modelId.trim()));
	const groups = new Map<
		string,
		{ name: string; variants: Variants; members: ModelInfo[] }
	>();

	for (const candidate of safe) {
		const id = candidate.modelId.trim();
		const parsed = effortFromName(candidate.name) ?? effortFromId(id);
		if (!id.startsWith("gemini-") || !parsed) continue;
		const key = parsed.baseName.toLowerCase();
		const group = groups.get(key) ?? { name: parsed.baseName, variants: {}, members: [] };
		group.variants[parsed.effort] = id;
		group.members.push(candidate);
		groups.set(key, group);
	}

	const emittedGroups = new Set<string>();
	const emittedIds = new Set<string>();
	const projected: AntigravityModelSpec[] = [];
	for (const candidate of safe) {
		const id = candidate.modelId.trim();
		if (emittedIds.has(id)) continue;
		const parsed = effortFromName(candidate.name) ?? effortFromId(id);
		const key = parsed?.baseName.toLowerCase();
		const group = key ? groups.get(key) : undefined;
		if (group && Object.keys(group.variants).length >= 2) {
			if (emittedGroups.has(key!)) continue;
			emittedGroups.add(key!);
			for (const member of group.members) emittedIds.add(member.modelId.trim());
			projected.push(
				reasoningModel(canonicalId(group.name, group.variants), group.name, group.variants),
			);
			continue;
		}
		emittedIds.add(id);
		projected.push(fixedModel(id, candidate.name.trim() || id));
	}
	return projected;
}

/** Resolve OMP's current reasoning level to the exact model ID advertised by
 * Antigravity. Unsupported programmatic levels clamp to the nearest tier. */
export function resolveAcpModelId(
	model: Pick<ModelSpec, "id" | "reasoning" | "thinking">,
	reasoning: string | undefined,
): string {
	const map = model.thinking?.effortRouting;
	if (!model.reasoning || !map) return model.id;
	const preferred: Effort =
		reasoning === "minimal" || reasoning === "low"
			? "low"
			: reasoning === "high" || reasoning === "xhigh" || reasoning === "max"
				? "high"
				: "medium";
	const order: Effort[] =
		preferred === "low"
			? ["low", "medium", "high"]
			: preferred === "high"
				? ["high", "medium", "low"]
				: ["medium", "high", "low"];
	for (const effort of order) {
		const value = map[effort];
		if (typeof value === "string" && value) return value;
	}
	return model.id;
}

function reasoningModel(
	id: string,
	name: string,
	variants: Variants,
): AntigravityModelSpec {
	const efforts = (["low", "medium", "high"] as const).filter((effort) => variants[effort]);
	return baseModel(id, name, true, {
		mode: "effort",
		efforts: efforts as NonNullable<ModelSpec["thinking"]>["efforts"],
		effortRouting: variants,
	});
}

function fixedModel(id: string, name: string): AntigravityModelSpec {
	return baseModel(id, name, false);
}

function baseModel(
	id: string,
	name: string,
	reasoning: boolean,
	thinking?: ModelSpec["thinking"],
): AntigravityModelSpec {
	return {
		id,
		name,
		api: API_ID,
		provider: PROVIDER_ID,
		baseUrl: "",
		reasoning,
		...(thinking ? { thinking } : {}),
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 65_536,
	};
}

function effortFromName(name: string): { baseName: string; effort: Effort } | undefined {
	const match = name.trim().match(/^(.+?)\s*\((low|medium|high)\)$/iu);
	if (!match?.[1] || !match[2]) return undefined;
	return { baseName: match[1].trim(), effort: match[2].toLowerCase() as Effort };
}

function effortFromId(id: string): { baseName: string; effort: Effort } | undefined {
	const match = id.match(/^(.+)-(low|medium|high)$/u);
	if (!match?.[1] || !match[2]) return undefined;
	return {
		baseName: titleFromId(match[1]),
		effort: match[2] as Effort,
	};
}

function canonicalId(name: string, variants: Variants): string {
	const bases = Object.values(variants)
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.replace(/-(?:low|medium|high)$/u, ""));
	if (bases.length > 0 && bases.every((value) => value === bases[0])) return bases[0]!;
	return name
		.toLowerCase()
		.replace(/[^a-z0-9.]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

function titleFromId(id: string): string {
	return id
		.split("-")
		.map((part) => (part === "gemini" ? "Gemini" : part.charAt(0).toUpperCase() + part.slice(1)))
		.join(" ");
}

function validModelId(id: string): boolean {
	return id.length > 0 && id.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(id);
}
