import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalFileStorage } from './local-file.storage';

let pdfTextResult: { text: string; total?: number } | Error = { text: 'extracted pdf text', total: 2 };
const destroyMock = jest.fn(() => Promise.resolve());

jest.mock('pdf-parse', () => ({
    PDFParse: jest.fn().mockImplementation(() => ({
        getText: jest.fn(() => (pdfTextResult instanceof Error ? Promise.reject(pdfTextResult) : Promise.resolve(pdfTextResult))),
        destroy: destroyMock,
    })),
}));

describe('LocalFileStorage.readFile', () => {
    let root: string;
    let storage: LocalFileStorage;

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), 'internshannon-storage-'));
        storage = new LocalFileStorage();
        pdfTextResult = { text: 'extracted pdf text', total: 2 };
        destroyMock.mockClear();
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('reads UTF-8 text even when the extension is not in the known text list', async () => {
        const filePath = path.join(root, 'changes.patch');
        await writeFile(filePath, 'diff --git a/example b/example\n+hello\n', 'utf8');

        await expect(storage.readFile(filePath)).resolves.toContain('+hello');
    });

    it('returns a clear non-UTF-8 message for unknown binary files', async () => {
        const filePath = path.join(root, 'payload.bin');
        await writeFile(filePath, Buffer.from([0xff, 0xfe, 0x00, 0x81]));

        const result = await storage.readFile(filePath);

        expect(result).toContain('binary or non-UTF-8 file');
        expect(result).toContain('could not be decoded as UTF-8 text');
    });

    it('extracts readable PDF text', async () => {
        const filePath = path.join(root, 'paper.pdf');
        await writeFile(filePath, Buffer.from('%PDF-1.7\nmock body\n'));

        const result = await storage.readFile(filePath);

        expect(result).toContain('Type: PDF document');
        expect(result).toContain('Pages: 2');
        expect(result).toContain('extracted pdf text');
        expect(destroyMock).toHaveBeenCalled();
    });

    it('returns a clear message for PDFs without extractable text', async () => {
        pdfTextResult = { text: '   ', total: 1 };
        const filePath = path.join(root, 'scanned.pdf');
        await writeFile(filePath, Buffer.from('%PDF-1.7\nmock body\n'));

        const result = await storage.readFile(filePath);

        expect(result).toContain('No extractable text was found in this PDF');
    });

    it('returns PDF extraction failure as text instead of throwing', async () => {
        pdfTextResult = new Error('parse failed');
        const filePath = path.join(root, 'broken.pdf');
        await writeFile(filePath, Buffer.from('%PDF-1.7\nnot a valid pdf body\n'));

        const result = await storage.readFile(filePath);

        expect(result).toContain('Type: PDF document');
        expect(result).toContain('PDF text extraction failed: parse failed');
    });

    it('describes images as metadata instead of decoding them as text', async () => {
        const filePath = path.join(root, 'image.png');
        await writeFile(
            filePath,
            Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03,
            ]),
        );

        const result = await storage.readFile(filePath);

        expect(result).toContain('Type: PNG image');
        expect(result).toContain('Dimensions: 2x3');
        expect(result).toContain('Use an image preview or vision-capable attachment path');
        expect(result).not.toContain('stream did not contain valid UTF-8');
    });
});
