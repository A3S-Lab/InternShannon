/**
 * Test environment defaults.
 *
 * `A3S_CODE_SANDBOX=auto` lets Code node tests run even when the `srt` binary
 * isn't installed on the test host — they fall back to the unsandboxed
 * AsyncFunction path that the engine already covers structurally. Production
 * deployments leave this env unset, getting the secure `srt`-required default.
 *
 * Override per-suite by setting the env explicitly in `beforeEach` (see
 * code-executor.spec.ts → "sandbox mode" tests).
 */
if (!process.env.A3S_CODE_SANDBOX) {
    process.env.A3S_CODE_SANDBOX = 'auto';
}
