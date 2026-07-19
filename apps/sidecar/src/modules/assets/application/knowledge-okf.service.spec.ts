import JSZip = require("jszip");
import type { IAssetService } from "../domain/services/asset.service.interface";
import { KnowledgeAuditService } from "./knowledge-audit.service";
import { KnowledgeContentService } from "./knowledge-content.service";
import { BadRequestException } from "@/shared/common/errors";
import {
	KnowledgeOkfService,
	MAX_OKF_IMPORT_BYTES,
	MAX_OKF_IMPORT_ENTRY_BYTES,
	MAX_OKF_IMPORT_FILES,
} from "./knowledge-okf.service";

function createService() {
	return new KnowledgeOkfService(
		{} as IAssetService,
		{} as KnowledgeContentService,
		{} as KnowledgeAuditService,
	);
}

async function zipBase64(
	entries: Array<{ path: string; content: string }>,
	compression: "STORE" | "DEFLATE" = "DEFLATE",
) {
	const archive = new JSZip();
	for (const entry of entries) archive.file(entry.path, entry.content);
	return archive.generateAsync({
		type: "base64",
		compression,
		compressionOptions: { level: 9 },
	});
}

describe("KnowledgeOkfService import safety", () => {
	it("reports malformed ZIP input as a bad request", async () => {
		const service = createService();
		const archiveBase64 = Buffer.from("not a ZIP archive").toString("base64");
		const operation = service.readZip(archiveBase64);

		await expect(operation).rejects.toBeInstanceOf(BadRequestException);
		await expect(operation).rejects.toThrow("OKF ZIP 无法解析");
	});

	it("rejects file-array paths that collide after normalization", () => {
		const service = createService();

		expect(() =>
			service.readFileInput([
				{ path: "x.md", content: "# First" },
				{ path: "a/../x.md", content: "# Second" },
			]),
		).toThrow("OKF 文档路径规范化后重复");
	});

	it("rejects ZIP paths that collide after normalization before extraction", async () => {
		const service = createService();
		const archiveBase64 = await zipBase64([
			{ path: "bundle/x.md", content: "# First" },
			{ path: "bundle/./x.md", content: "# Second" },
		]);

		await expect(service.readZip(archiveBase64)).rejects.toThrow(
			"OKF 文档路径规范化后重复",
		);
	});

	it("rejects a highly compressible entry from its declared expansion size", async () => {
		const service = createService();
		const archiveBase64 = await zipBase64([
			{
				path: "large.md",
				content: `---\ntype: Note\n---\n${"A".repeat(MAX_OKF_IMPORT_ENTRY_BYTES + 1)}`,
			},
		]);

		expect(Buffer.byteLength(archiveBase64, "base64")).toBeLessThan(
			MAX_OKF_IMPORT_ENTRY_BYTES / 100,
		);
		await expect(service.readZip(archiveBase64)).rejects.toThrow(
			"OKF 单个文档解压后不能超过",
		);
	});

	it("rejects cumulative expansion before reading entry streams", async () => {
		const service = createService();
		const entryBytes = Math.floor(MAX_OKF_IMPORT_BYTES / 6) + 1;
		const archiveBase64 = await zipBase64(
			Array.from({ length: 6 }, (_, index) => ({
				path: `note-${index}.md`,
				content: "B".repeat(entryBytes),
			})),
		);

		await expect(service.readZip(archiveBase64)).rejects.toThrow(
			"OKF 解压后不能超过",
		);
	});

	it("rejects an over-count archive before extracting any file", async () => {
		const service = createService();
		const archiveBase64 = await zipBase64(
			Array.from({ length: MAX_OKF_IMPORT_FILES + 1 }, (_, index) => ({
				path: `note-${index}.md`,
				content: "",
			})),
			"STORE",
		);

		await expect(service.readZip(archiveBase64)).rejects.toThrow(
			"OKF ZIP 条目数量不能超过",
		);
	});
});
