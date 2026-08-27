import {
    buildKnowledgeTableCatalog,
    parseKnowledgeGroundingSchema,
    type KnowledgeTableCatalogEntry,
} from "./knowledge-table-catalog";

function table(path: string, primaryKey: string, columns: string[]): KnowledgeTableCatalogEntry {
    return {
        assetId: "asset-1",
        path,
        title: path.split("/").at(-1) ?? path,
        mime: "text/csv",
        columns,
        primaryKey,
        recordCount: 2,
        recordIds: ["A-1", "A-2"],
        recordIdsTruncated: false,
        resource: `asset://asset-1/${path}`,
    };
}

describe("knowledge table catalog", () => {
    it("infers generic relations without relying on domain filenames", () => {
        const catalog = buildKnowledgeTableCatalog([
            table("raw/sources/a.csv", "account_id", ["account_id", "name"]),
            table("raw/sources/b.csv", "order_id", ["order_id", "account_id", "amount"]),
            table("raw/sources/c.csv", "node_id", ["node_id", "label"]),
            table("raw/sources/d.csv", "event_id", ["event_id", "start_node"]),
        ]);

        expect(catalog[1]?.relations).toContainEqual(
            expect.objectContaining({
                sourceColumn: "account_id",
                targetPath: "raw/sources/a.csv",
                confidence: "high",
            }),
        );
        expect(catalog[3]?.relations).toContainEqual(
            expect.objectContaining({
                sourceColumn: "start_node",
                targetPath: "raw/sources/c.csv",
                confidence: "medium",
            }),
        );
    });

    it("accepts only bounded declarative schema paths and relations", () => {
        const schema = [
            "```knowledge-grounding",
            JSON.stringify({
                version: 1,
                tables: [
                    {
                        path: "raw/sources/orders.csv",
                        aliases: ["订单", "交易"],
                        primaryKey: "order_id",
                        relations: [
                            {
                                column: "account_id",
                                targetPath: "raw/sources/accounts.csv",
                                targetColumn: "account_id",
                            },
                        ],
                    },
                    { path: "../secret.csv", aliases: ["bad"] },
                ],
            }),
            "```",
        ].join("\n");

        expect(parseKnowledgeGroundingSchema(schema)).toEqual([
            {
                path: "raw/sources/orders.csv",
                aliases: ["订单", "交易"],
                primaryKey: "order_id",
                relations: [
                    {
                        column: "account_id",
                        targetPath: "raw/sources/accounts.csv",
                        targetColumn: "account_id",
                    },
                ],
            },
        ]);
    });
});
