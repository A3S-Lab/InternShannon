import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    EXPECTED_ACL_VERSION,
    EXPECTED_CODE_SDK_VERSION,
    inspectBundledSdk,
} from './verify-sdk-runtime.mjs';

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({ aclVersion = EXPECTED_ACL_VERSION, sdkVersion = EXPECTED_CODE_SDK_VERSION } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-sdk-runtime.'));
    const nodeModules = path.join(root, 'sidecar', 'node_modules');
    const bindingName = '@a3s-lab/code-darwin-arm64';
    writeJson(path.join(nodeModules, '@a3s-lab', 'code', 'package.json'), {
        name: '@a3s-lab/code',
        version: sdkVersion,
        optionalDependencies: { [bindingName]: sdkVersion },
    });
    writeJson(path.join(nodeModules, '@a3s-lab', 'code-darwin-arm64', 'package.json'), {
        name: bindingName,
        version: sdkVersion,
        main: 'index.darwin-arm64.node',
    });
    fs.writeFileSync(
        path.join(nodeModules, '@a3s-lab', 'code-darwin-arm64', 'index.darwin-arm64.node'),
        Buffer.from(`native-bytes:/cargo/registry/a3s-acl-${aclVersion}/src/lexer.rs:end`),
    );
    return root;
}

test('accepts the expected SDK and ACL embedded in a packaged native binary', t => {
    const root = makeFixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const report = inspectBundledSdk(root);

    assert.equal(report.ok, true);
    assert.equal(report.codePackage.version, EXPECTED_CODE_SDK_VERSION);
    assert.equal(report.nativeBindings[0].aclVersion, EXPECTED_ACL_VERSION);
});

test('rejects a stale packaged native SDK even if a newer workspace dependency exists', t => {
    const root = makeFixture({ aclVersion: '0.2.0', sdkVersion: '4.2.1' });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const report = inspectBundledSdk(root);

    assert.equal(report.ok, false);
    assert.match(report.issues.join('\n'), /expected @a3s-lab\/code@6\.1\.0, found 4\.2\.1/);
    assert.match(report.issues.join('\n'), /a3s-acl-0\.3\.0/);
});
