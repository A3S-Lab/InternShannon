import { Asset } from "../domain/entities/asset.entity";
import type { IAssetService } from "../domain/services/asset.service.interface";
import { KnowledgeContentService } from "./knowledge-content.service";

describe("KnowledgeContentService internal path safety", () => {
    it("keeps snapshots, trash and derived files out of wiki contents, pages and sources", async () => {
        const asset = Asset.create({
            name: "knowledge",
            ownerId: "user-1",
            ownerType: "user",
            category: "knowledge",
            visibility: "private",
            metadata: {
                blobContents: {
                    "wiki/page.md": "# Visible",
                    "wiki/.shuan-os-snapshots/page.md": "# Snapshot",
                    "wiki/.shuan-os-trash/page.md": "# Trash",
                    "raw/sources/source.csv": "id\nA-1",
                    "raw/sources/.shuan-os-snapshots/source.csv": "id\nOLD",
                    "raw/sources/.shuan-os-trash/source.csv": "id\nDELETED",
                    ".internshannon/knowledge/index/manifest.json": "{}",
                },
            },
        });
        const service = new KnowledgeContentService({
            getAsset: jest.fn(async () => asset),
            getBlobContent: jest.fn(async () => null),
        } as unknown as IAssetService);

        expect(Object.keys(await service.loadContents(asset, "wiki/"))).toEqual(["wiki/page.md"]);
        expect(service.pageEntries(asset).map((entry) => entry.path)).toEqual(["wiki/page.md"]);
        expect(service.sourceEntries(asset).map((entry) => entry.path)).toEqual(["raw/sources/source.csv"]);
    });
});
