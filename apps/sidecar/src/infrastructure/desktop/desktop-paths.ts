import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DATA_DIR_NAME = '.internshannon';
const DATA_DIR_ENV_KEYS = ['INTERNSHANNON_DATA_DIR', 'INTERN_SHANNON_DATA_DIR'];

export function desktopDataDir(): string {
  for (const envKey of DATA_DIR_ENV_KEYS) {
    const configured = process.env[envKey]?.trim();
    if (configured) {
      return path.resolve(configured);
    }
  }

  return path.join(os.homedir(), DATA_DIR_NAME);
}

export function desktopJsonFilePath(filename: string, _logger?: unknown): string {
  const dataDir = desktopDataDir();
  const target = path.join(dataDir, filename);
  fs.mkdirSync(dataDir, { recursive: true });
  return target;
}
