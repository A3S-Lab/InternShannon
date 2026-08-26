import assert from "node:assert/strict";
import test from "node:test";
import { assertReadToolSchemaContract } from "./a3s-tool-schema-contract.mjs";

function request(parameters) {
	return {
		body: {
			tools: [
				{
					type: "function",
					function: { name: "read", parameters },
				},
			],
		},
	};
}

const validSchema = {
	type: "object",
	properties: {
		file_path: { type: "string" },
		files: { type: "array", items: { type: "object" } },
	},
	additionalProperties: false,
};

test("accepts the provider-compatible read tool schema", () => {
	assert.deepEqual(assertReadToolSchemaContract([request(validSchema)]), {
		definitions: 1,
	});
});

test("rejects the legacy read schema with a top-level oneOf", () => {
	assert.throws(
		() =>
			assertReadToolSchemaContract([
				request({
					...validSchema,
					oneOf: [{ required: ["file_path"] }, { required: ["files"] }],
				}),
			]),
		/top-level oneOf/,
	);
});

test("rejects a provider request that does not expose read", () => {
	assert.throws(
		() => assertReadToolSchemaContract([{ body: { tools: [] } }]),
		/did not expose the built-in read tool schema/,
	);
});
