import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function runScript(args, options = {}) {
	return spawnSync("bash", [script, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...options.env },
	});
}

function runHarness(body, options = {}) {
	return spawnSync(
		"bash",
		[
			"-c",
			'source "$1"; eval "$2"',
			"predeploy-check-test",
			script,
			body,
		],
		{
			encoding: "utf8",
			env: { ...process.env, ...options.env },
		},
	);
}

function withSequenceFile(run) {
	const directory = mkdtempSync(join(tmpdir(), "predeploy-check-"));
	const sequenceFile = join(directory, "sequence");
	writeFileSync(sequenceFile, "0");
	try {
		return run(sequenceFile);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
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

for (const signal of ["TERM", "KILL"]) {
	test(`does not send SIG${signal} when the listener PID changes after validation`, () => {
		const result = withSequenceFile((sequenceFile) =>
			runHarness(
				`
listener_pids() {
  local count
  count=$(cat "$SEQUENCE_FILE")
  count=$((count + 1))
  printf '%s' "$count" > "$SEQUENCE_FILE"
  if [ "$count" -eq 1 ]; then echo 51001; else echo 51002; fi
}
assert_internshannon_process() { return 0; }
process_start_token() { echo stable-start; }
print_process_details() { :; }
kill() { printf 'SIGNAL %s %s\\n' "$1" "$2"; }
signal_listeners ${signal} preview:5001
`,
				{ env: { SEQUENCE_FILE: sequenceFile } },
			),
		);

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /listeners changed during validation/);
		assert.doesNotMatch(result.stdout, /SIGNAL/);
	});

	test(`does not send SIG${signal} when an unvalidated listener joins immediately before signaling`, () => {
		const result = withSequenceFile((sequenceFile) =>
			runHarness(
				`
listener_pids() {
  local count
  count=$(cat "$SEQUENCE_FILE")
  count=$((count + 1))
  printf '%s' "$count" > "$SEQUENCE_FILE"
  if [ "$count" -lt 4 ]; then echo 51001; else printf '51001\\n51002\\n'; fi
}
assert_internshannon_process() { return 0; }
process_start_token() { echo stable-start; }
print_process_details() { :; }
kill() { printf 'SIGNAL %s %s\\n' "$1" "$2"; }
signal_listeners ${signal} preview:5001
`,
				{ env: { SEQUENCE_FILE: sequenceFile } },
			),
		);

		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			new RegExp(`listeners changed immediately before SIG${signal}`),
		);
		assert.doesNotMatch(result.stdout, /SIGNAL/);
	});
}

test("signals only the immutable validated PID when the listener stays stable", () => {
	const result = runHarness(`
listener_pids() { echo 51001; }
assert_internshannon_process() { return 0; }
process_start_token() { echo stable-start; }
kill() { printf 'SIGNAL %s %s\\n' "$1" "$2"; }
signal_listeners TERM preview:5001
`);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /SIGNAL -TERM 51001/);
	assert.doesNotMatch(result.stdout, /51002/);
});

test("rechecks the listener set before each signal in a multi-PID snapshot", () => {
	const result = withSequenceFile((sequenceFile) =>
		runHarness(
			`
listener_pids() {
  local count
  count=$(cat "$SEQUENCE_FILE")
  count=$((count + 1))
  printf '%s' "$count" > "$SEQUENCE_FILE"
  if [ "$count" -lt 6 ]; then printf '61001\\n61002\\n'; else printf '61001\\n61002\\n61003\\n'; fi
}
assert_internshannon_process() { return 0; }
process_start_token() { echo stable-start; }
print_process_details() { :; }
kill() { printf 'SIGNAL %s %s\\n' "$1" "$2"; }
signal_listeners TERM preview:5001
`,
			{ env: { SEQUENCE_FILE: sequenceFile } },
		),
	);

	assert.notEqual(result.status, 0);
	assert.match(result.stdout, /SIGNAL -TERM 61001/);
	assert.doesNotMatch(result.stdout, /SIGNAL -TERM 61002/);
	assert.match(result.stderr, /listeners changed immediately before SIGTERM/);
});

test("does not signal a reused PID whose process start token changed", () => {
	const result = withSequenceFile((sequenceFile) =>
		runHarness(
			`
listener_pids() { echo 52001; }
assert_internshannon_process() { return 0; }
process_start_token() {
  local count
  count=$(cat "$SEQUENCE_FILE")
  count=$((count + 1))
  printf '%s' "$count" > "$SEQUENCE_FILE"
  if [ "$count" -eq 1 ]; then echo first-start; else echo reused-start; fi
}
kill() { printf 'SIGNAL %s %s\\n' "$1" "$2"; }
signal_listeners TERM preview:5001
`,
			{ env: { SEQUENCE_FILE: sequenceFile } },
		),
	);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /PID 52001 was reused during validation/);
	assert.doesNotMatch(result.stdout, /SIGNAL/);
});

test("accepts an explicit preview role on port 5001 for check and stop", () => {
	const checkResult = runHarness(`
listener_pids() { :; }
check_targets preview:5001
`);
	assert.equal(checkResult.status, 0, checkResult.stderr);
	assert.match(checkResult.stdout, /port 5001 \(preview\) is free/);

	const stopResult = runHarness(`
listener_pids() { :; }
sleep() { :; }
kill() { printf 'UNEXPECTED SIGNAL %s %s\\n' "$1" "$2"; }
stop_targets preview:5001
`);
	assert.equal(stopResult.status, 0, stopResult.stderr);
	assert.doesNotMatch(stopResult.stdout, /UNEXPECTED SIGNAL/);
});

test("uses PUBLIC_DESKTOP_DEV_PORT as the default preview target", () => {
	const result = runHarness(
		"listener_pids() { :; }; sleep() { :; }; main check; main stop",
		{ env: { PUBLIC_DESKTOP_DEV_PORT: "5001" } },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /port 5001 \(preview\) is free/);
	assert.doesNotMatch(result.stdout, /port 5000/);
});

test("rejects invalid roles, ports, and ambiguous custom bare ports", () => {
	for (const target of ["worker:5001", "preview:70000", "5001"]) {
		const result = runScript(["check", target]);
		assert.notEqual(result.status, 0, target);
		assert.match(result.stderr, /ERROR:/, target);
	}
});
