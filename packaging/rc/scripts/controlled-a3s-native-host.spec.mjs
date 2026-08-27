import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const foreignTarget =
	process.platform === "win32" ? "darwin-arm64" : "win32-x64";

for (const script of [
	"stage-controlled-a3s-dependency.mjs",
	"install-controlled-a3s-dependencies.mjs",
	"verify-controlled-a3s-install.mjs",
]) {
	test(`${script} rejects a foreign target on the current host`, () => {
		const result = spawnSync(
			process.execPath,
			[path.join(SCRIPT_DIR, script), "--target", foreignTarget],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /must run on its native host/u);
	});
}
