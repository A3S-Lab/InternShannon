import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./predeploy-check.sh", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url)).replace(
	/\/$/,
	"",
);

function matches(role, executable, command, cwd) {
	const result = spawnSync(
		"bash",
		[
			"-c",
			'source "$1"; matches_internshannon_identity "$2" "$3" "$4" "$5" "$6"',
			"predeploy-check-test",
			script,
			role,
			executable,
			command,
			cwd,
			workspaceRoot,
		],
		{ encoding: "utf8" },
	);
	return result.status === 0;
}

function decodePath(value) {
	const result = spawnSync(
		"bash",
		[
			"-c",
			'source "$1"; decode_lsof_path "$2"',
			"predeploy-check-test",
			script,
			value,
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}

test("decodes the byte escapes emitted by macOS lsof for non-ASCII cwd paths", () => {
	assert.equal(
		decodePath("/tmp/\\xe4\\xb9\\xa6/InternShannon"),
		"/tmp/书/InternShannon",
	);
});

test("recognizes the built sidecar only inside apps/sidecar", () => {
	assert.equal(
		matches(
			"sidecar",
			"node",
			"node dist/main",
			`${workspaceRoot}/apps/sidecar`,
		),
		true,
	);
	assert.equal(
		matches("sidecar", "node", "node dist/main", `${workspaceRoot}/other`),
		false,
	);
});

test("recognizes rsbuild preview only inside apps/web", () => {
	assert.equal(
		matches(
			"preview",
			"rsbuild-node",
			"rsbuild-node",
			`${workspaceRoot}/apps/web`,
		),
		true,
	);
	assert.equal(
		matches(
			"preview",
			"rsbuild-node",
			"rsbuild-node",
			`${workspaceRoot}/apps/sidecar`,
		),
		false,
	);
});

test("rejects macOS ControlCenter and generic node processes", () => {
	assert.equal(
		matches(
			"preview",
			"/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
			"/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
			"/",
		),
		false,
	);
	assert.equal(
		matches("preview", "node", "node start", `${workspaceRoot}/apps/web`),
		false,
	);
	assert.equal(
		matches("sidecar", "node", "node start", `${workspaceRoot}/apps/sidecar`),
		false,
	);
});

test("does not accept sibling paths that only share the workspace prefix", () => {
	assert.equal(
		matches(
			"sidecar",
			"node",
			"node dist/main",
			`${workspaceRoot}-other/apps/sidecar`,
		),
		false,
	);
});

test("recognizes packaged InternShannon app children without matching system apps", () => {
	assert.equal(
		matches(
			"sidecar",
			"/Applications/InternShannon.app/Contents/MacOS/InternShannon",
			"/Applications/InternShannon.app/Contents/MacOS/InternShannon",
			"/",
		),
		true,
	);
	assert.equal(
		matches(
			"sidecar",
			"node",
			"node dist/main",
			"/Applications/InternShannon.app/Contents/Resources/sidecar",
		),
		true,
	);
});
