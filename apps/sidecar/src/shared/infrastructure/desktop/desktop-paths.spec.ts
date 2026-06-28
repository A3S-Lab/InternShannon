import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { desktopDataDir, desktopJsonFilePath } from './desktop-paths';

describe('desktop-paths', () => {
    const originalEnv = { ...process.env };
    let tmpRoot: string;

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.INTERNSHANNON_DATA_DIR;
        delete process.env.INTERN_SHANNON_DATA_DIR;
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-desktop-paths-'));
    });

    afterEach(() => {
        process.env = originalEnv;
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('uses INTERNSHANNON_DATA_DIR when provided', () => {
        const configured = path.join(tmpRoot, 'data');
        process.env.INTERNSHANNON_DATA_DIR = configured;

        expect(desktopDataDir()).toBe(path.resolve(configured));
    });

    it('keeps INTERN_SHANNON_DATA_DIR as a compatible alias', () => {
        const configured = path.join(tmpRoot, 'alias-data');
        process.env.INTERN_SHANNON_DATA_DIR = configured;

        expect(desktopDataDir()).toBe(path.resolve(configured));
    });

    it('creates the configured data directory for JSON files', () => {
        const configured = path.join(tmpRoot, 'nested', 'desktop-local');
        process.env.INTERNSHANNON_DATA_DIR = configured;

        expect(desktopJsonFilePath('config.json')).toBe(path.join(path.resolve(configured), 'config.json'));
        expect(fs.existsSync(configured)).toBe(true);
    });
});
