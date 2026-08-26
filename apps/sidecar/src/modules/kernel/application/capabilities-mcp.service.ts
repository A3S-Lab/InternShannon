import { Injectable } from "@nestjs/common";
import { CapabilitiesToolService, type CapabilityRequest } from "./capabilities-tool.service";

interface JsonRpcRequest {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
}

export interface McpHttpResult {
    status: number;
    body?: Record<string, unknown>;
}

@Injectable()
export class CapabilitiesMcpService {
    constructor(private readonly capabilities: CapabilitiesToolService) {}

    async handle(input: unknown, userId: string): Promise<McpHttpResult> {
        const request = this.asRequest(input);
        if (!request) {
            return this.error(null, -32600, "Invalid JSON-RPC request");
        }

        if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") {
            return { status: 202 };
        }

        const id = request.id ?? null;
        switch (request.method) {
            case "initialize":
                return this.success(id, {
                    protocolVersion: this.protocolVersion(request.params?.protocolVersion),
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "internshannon-capabilities", version: "1.0.0" },
                });
            case "ping":
                return this.success(id, {});
            case "tools/list": {
                const tool = this.capabilities.toolDefinition();
                return this.success(id, {
                    tools: [
                        { name: tool.name, description: tool.description, inputSchema: tool.input_schema },
                        {
                            name: "knowledge_search",
                            description:
                                "Search the user-visible OKF knowledge base and indexed source files. Use personal scope for the current user.",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    query: { type: "string", description: "Natural-language or keyword query" },
                                    scope: {
                                        type: "string",
                                        enum: ["personal", "docs", "global"],
                                        description: "Knowledge scope; defaults to personal",
                                    },
                                    limit: { type: "number", description: "Maximum hits, 1-50; defaults to 8" },
                                    includeTableCatalog: {
                                        type: "boolean",
                                        description: "Include a bounded table catalog for grounding planning",
                                    },
                                    searchCursor: {
                                        type: "string",
                                        description: "Opaque cursor returned by the previous search page",
                                    },
                                    catalogCursor: {
                                        type: "string",
                                        description: "Opaque cursor returned by the previous table catalog page",
                                    },
                                },
                                required: ["query"],
                            },
                        },
                        {
                            name: "knowledge_read",
                            description:
                                "Read one OKF concept or indexed source chunk returned by knowledge_search, preserving citations.",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    path: { type: "string", description: "Concept id or path returned by search" },
                                    scope: {
                                        type: "string",
                                        enum: ["personal", "docs", "global"],
                                        description: "Same scope used for search; defaults to personal",
                                    },
                                    assetId: { type: "string", description: "Asset id when a global hit is ambiguous" },
                                    identifiers: {
                                        type: "array",
                                        items: { type: "string" },
                                        description: "Exact record identifiers to locate across a tabular source",
                                    },
                                    filters: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                column: { type: "string" },
                                                op: { type: "string", enum: ["eq", "in"] },
                                                value: {},
                                            },
                                            required: ["column", "op", "value"],
                                        },
                                        description: "Exact schema-bound relation filters",
                                    },
                                    expectedRevision: {
                                        type: "string",
                                        description: "Index revision returned by search; rejects mixed-revision reads",
                                    },
                                },
                                required: ["path"],
                            },
                        },
                        {
                            name: "knowledge_query",
                            description:
                                "Run bounded revision-aware CSV filters, aggregates, and schema-declared equi-joins. Arbitrary SQL is not accepted.",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    scope: {
                                        type: "string",
                                        description: "personal, docs, or global; defaults to personal",
                                    },
                                    assetId: {
                                        type: "string",
                                        description: "Required when global scope contains multiple assets",
                                    },
                                    from: { type: "string", description: "Public raw/sources/*.csv path" },
                                    select: { type: "array", items: { type: "string" } },
                                    filters: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                column: { type: "string" },
                                                op: {
                                                    type: "string",
                                                    description: "eq, in, contains, gt, gte, lt, or lte",
                                                },
                                                value: {
                                                    description: "A scalar value, or an array of scalar values for in",
                                                },
                                            },
                                            required: ["column", "op", "value"],
                                        },
                                    },
                                    aggregates: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                op: { type: "string", description: "count, sum, min, or max" },
                                                column: { type: "string" },
                                                as: { type: "string" },
                                            },
                                            required: ["op", "as"],
                                        },
                                    },
                                    joins: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                targetPath: { type: "string" },
                                                sourceColumn: { type: "string" },
                                                targetColumn: { type: "string" },
                                                type: { type: "string", description: "inner or left" },
                                            },
                                            required: ["targetPath", "sourceColumn", "targetColumn"],
                                        },
                                    },
                                    orderBy: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                column: { type: "string" },
                                                direction: { type: "string", description: "asc or desc" },
                                            },
                                            required: ["column"],
                                        },
                                    },
                                    limit: { type: "number", description: "Maximum rows per page, 1-200" },
                                    cursor: { type: "string", description: "Opaque cursor returned by a prior query" },
                                    expectedRevision: {
                                        type: "string",
                                        description: "Index revision required by the caller",
                                    },
                                },
                                required: ["from"],
                            },
                        },
                    ],
                });
            }
            case "tools/call":
                return this.callTool(id, request.params, userId);
            default:
                return this.error(id, -32601, `Method not found: ${request.method}`);
        }
    }

    private async callTool(
        id: string | number | null,
        params: Record<string, unknown> | undefined,
        userId: string,
    ): Promise<McpHttpResult> {
        const name = typeof params?.name === "string" ? params.name : "";
        if (!["capabilities", "knowledge_search", "knowledge_read", "knowledge_query"].includes(name)) {
            return this.success(id, this.toolResult(`Unknown tool: ${name || "(missing)"}`, true));
        }
        const args = params?.arguments;
        if (!args || typeof args !== "object" || Array.isArray(args)) {
            return this.success(id, this.toolResult("Tool arguments must be an object", true));
        }

        try {
            const result = await this.capabilities.dispatch(this.capabilityRequest(name, args), userId);
            return this.success(id, this.toolResult(JSON.stringify(result), false, result));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.success(id, this.toolResult(message, true));
        }
    }

    private capabilityRequest(name: string, args: object): CapabilityRequest {
        if (name === "knowledge_search") {
            return {
                action: "execute",
                module: "knowledge",
                operation: "search",
                params: args as Record<string, unknown>,
            };
        }
        if (name === "knowledge_read") {
            return {
                action: "execute",
                module: "knowledge",
                operation: "read",
                params: args as Record<string, unknown>,
            };
        }
        if (name === "knowledge_query") {
            return {
                action: "execute",
                module: "knowledge",
                operation: "query",
                params: args as Record<string, unknown>,
            };
        }
        return args as CapabilityRequest;
    }

    private toolResult(text: string, isError: boolean, structuredContent?: unknown): Record<string, unknown> {
        return {
            content: [{ type: "text", text }],
            ...(structuredContent && typeof structuredContent === "object" ? { structuredContent } : {}),
            ...(isError ? { isError: true } : {}),
        };
    }

    private success(id: string | number | null, result: Record<string, unknown>): McpHttpResult {
        return { status: 200, body: { jsonrpc: "2.0", id, result } };
    }

    private error(id: string | number | null, code: number, message: string): McpHttpResult {
        return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } } };
    }

    private asRequest(input: unknown): JsonRpcRequest | null {
        if (!input || typeof input !== "object" || Array.isArray(input)) return null;
        const request = input as JsonRpcRequest;
        if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || !request.method.trim()) return null;
        return request;
    }

    private protocolVersion(value: unknown): string {
        return typeof value === "string" && value.trim() ? value.trim() : "2024-11-05";
    }
}
