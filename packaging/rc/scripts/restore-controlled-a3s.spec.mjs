import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	resolveRestoreAuthority,
	selectPrivateReleaseAsset,
} from "./restore-controlled-a3s.mjs";

describe("controlled A3S restore authority", () => {
	it("downloads a published verified target or accepts an explicit local mirror", () => {
		assert.equal(
			resolveRestoreAuthority({
				status: "verified",
				localAssetDir: null,
				target: "darwin-arm64",
			}),
			"private-release",
		);
		assert.equal(
			resolveRestoreAuthority({
				status: "verified",
				localAssetDir: "asset-cache",
				target: "darwin-arm64",
			}),
			"local",
		);
	});

	it("requires an explicit local asset directory while publication is pending", () => {
		assert.equal(
			resolveRestoreAuthority({
				status: "verified-local-pending-private-asset",
				localAssetDir: "asset-cache",
				target: "win32-x64",
			}),
			"local",
		);
		assert.throws(
			() =>
				resolveRestoreAuthority({
					status: "verified-local-pending-private-asset",
					localAssetDir: null,
					target: "win32-x64",
				}),
			/private release asset is pending.*--asset-dir/u,
		);
	});

	it("rejects unverified targets without a registry or cross-platform fallback", () => {
		assert.throws(
			() =>
				resolveRestoreAuthority({
					status: "pending-native-build",
					localAssetDir: "asset-cache",
					target: "win32-x64",
				}),
			/not verified.*refusing registry or cross-platform fallback/u,
		);
	});
});

describe("private A3S release asset selection", () => {
	it("accepts one exact asset with matching size and digest", () => {
		const sha256 = "a".repeat(64);
		const asset = selectPrivateReleaseAsset({
			assets: [
				{
					id: 42,
					name: "controlled.tgz",
					size: 123,
					digest: `sha256:${sha256}`,
				},
			],
			assetName: "controlled.tgz",
			expectedSha256: sha256,
			expectedBytes: 123,
		});
		assert.equal(asset.id, 42);
	});

	it("rejects duplicate, wrong-size, and wrong-digest assets", () => {
		const sha256 = "a".repeat(64);
		assert.throws(
			() =>
				selectPrivateReleaseAsset({
					assets: [],
					assetName: "controlled.tgz",
					expectedSha256: sha256,
					expectedBytes: 123,
				}),
			/exactly one/u,
		);
		assert.throws(
			() =>
				selectPrivateReleaseAsset({
					assets: [{ id: 42, name: "controlled.tgz", size: 124 }],
					assetName: "controlled.tgz",
					expectedSha256: sha256,
					expectedBytes: 123,
				}),
			/size mismatch/u,
		);
		assert.throws(
			() =>
				selectPrivateReleaseAsset({
					assets: [
						{
							id: 42,
							name: "controlled.tgz",
							size: 123,
							digest: `sha256:${"b".repeat(64)}`,
						},
					],
					assetName: "controlled.tgz",
					expectedSha256: sha256,
					expectedBytes: 123,
				}),
			/digest mismatch/u,
		);
	});
});
