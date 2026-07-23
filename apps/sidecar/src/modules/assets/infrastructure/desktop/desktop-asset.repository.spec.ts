import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DesktopAssetRepository } from './desktop-asset.repository';

describe('DesktopAssetRepository atomic files', () => {
    let dataDir: string;
    let previousDataDir: string | undefined;

    beforeEach(() => {
        previousDataDir = process.env.INTERNSHANNON_DATA_DIR;
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-atomic-repository-'));
        process.env.INTERNSHANNON_DATA_DIR = dataDir;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (previousDataDir === undefined) delete process.env.INTERNSHANNON_DATA_DIR;
        else process.env.INTERNSHANNON_DATA_DIR = previousDataDir;
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('publishes a complete external blob only after its temporary write succeeds', async () => {
        const repository = new DesktopAssetRepository();
        const originalWrite = fs.writeFileSync;
        jest.spyOn(fs, 'writeFileSync').mockImplementationOnce((target, content, options) => {
            originalWrite(target, Buffer.from(content as Buffer).subarray(0, 4), options as never);
            throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        });

        await expect(repository.writeBlobData('asset-a', 'raw/sources/partial.bin', Buffer.alloc(1024, 0x51)))
            .rejects.toMatchObject({ code: 'ENOSPC' });
        await expect(repository.readBlobData('asset-a', 'raw/sources/partial.bin')).resolves.toBeNull();
        expect(findTemporaryFiles(dataDir)).toEqual([]);
    });

    it('keeps the previous complete blob when its replacement cannot be written', async () => {
        const repository = new DesktopAssetRepository();
        await repository.writeBlobData('asset-a', 'raw/sources/existing.bin', Buffer.from('previous-complete-content'));
        const originalWrite = fs.writeFileSync;
        jest.spyOn(fs, 'writeFileSync').mockImplementationOnce((target, content, options) => {
            originalWrite(target, Buffer.from(content as Buffer).subarray(0, 4), options as never);
            throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        });

        await expect(repository.writeBlobData('asset-a', 'raw/sources/existing.bin', Buffer.from('replacement')))
            .rejects.toMatchObject({ code: 'ENOSPC' });
        await expect(repository.readBlobData('asset-a', 'raw/sources/existing.bin'))
            .resolves.toEqual(Buffer.from('previous-complete-content'));
        expect(findTemporaryFiles(dataDir)).toEqual([]);
    });
});

function findTemporaryFiles(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter(entry => entry.endsWith('.tmp'));
}
