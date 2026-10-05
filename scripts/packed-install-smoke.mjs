import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "omp-antigravity-acp-pack-"));
let tarball;

try {
	const packed = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: root, encoding: "utf8" }))[0];
	tarball = path.join(root, packed.filename);
	fs.writeFileSync(path.join(temporary, "package.json"), '{"private":true}\n');
	execFileSync(
		"npm",
		["install", "--ignore-scripts", tarball],
		{ cwd: temporary, stdio: "inherit" },
	);
	const installed = path.join(temporary, "node_modules", "omp-antigravity-acp-provider");
	for (const required of ["extensions/index.ts", "src/acp/supervisor.mjs", "src/mcp/bridge.ts"]) {
		if (!fs.existsSync(path.join(installed, required))) throw new Error(`Packed file is missing: ${required}`);
	}
	const unzipperPackage = path.join(temporary, "node_modules", "unzipper", "package.json");
	if (!fs.existsSync(unzipperPackage)) throw new Error("Antigravity ACP installer dependency is missing");
	const models = execFileSync(
		"omp",
		["models", "antigravity-acp", "--json", "--no-extensions", "-e", path.join(installed, "extensions/index.ts")],
		{
			encoding: "utf8",
			timeout: 60_000,
			env: { ...process.env, GEMINI_API_KEY: undefined },
		},
	);
	const catalog = JSON.parse(models);
	if (!catalog.models?.length || catalog.models.some(model => model.provider !== "antigravity-acp")) {
		throw new Error("Packed extension did not register Antigravity models in OMP");
	}
	process.stdout.write("Packed install passed with Antigravity ACP setup support.\n");
} finally {
	fs.rmSync(temporary, { recursive: true, force: true });
	if (tarball) fs.rmSync(tarball, { force: true });
}
