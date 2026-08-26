export const FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS = [
	"oneOf",
	"anyOf",
	"allOf",
	"enum",
	"const",
	"not",
];

function functionDefinition(tool) {
	return tool?.type === "function" && tool.function ? tool.function : tool;
}

export function assertReadToolSchemaContract(requests) {
	const readDefinitions = requests
		.flatMap((request) => request?.body?.tools ?? [])
		.map(functionDefinition)
		.filter((definition) => definition?.name === "read");
	if (readDefinitions.length === 0) {
		throw new Error(
			"Packaged provider request did not expose the built-in read tool schema",
		);
	}

	for (const definition of readDefinitions) {
		const schema = definition.parameters ?? definition.inputSchema;
		if (schema?.type !== "object") {
			throw new Error("read tool schema root must have type=object");
		}
		for (const forbidden of FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS) {
			if (Object.hasOwn(schema, forbidden)) {
				throw new Error(`read tool schema leaked top-level ${forbidden}`);
			}
		}
		if (schema?.properties?.file_path?.type !== "string") {
			throw new Error("read tool schema is missing string file_path");
		}
		if (schema?.properties?.files?.type !== "array") {
			throw new Error("read tool schema is missing array files");
		}
	}

	return { definitions: readDefinitions.length };
}
