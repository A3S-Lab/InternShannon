export const CONFIG_REPOSITORY = 'CONFIG_REPOSITORY';

export interface ConfigEntryRecord {
  key: string;
  value: string;
  version?: number;
  revision?: number;
  created?: boolean;
}

export interface IConfigRepository {
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<void>;
  deleteValue(key: string): Promise<void>;
  getAllValues(): Promise<Record<string, string>>;
  getEntries?(prefix?: string): Promise<ConfigEntryRecord[]>;
  getRawValue?(key: string): Promise<string | null>;
  setRawValue?(key: string, value: string): Promise<void>;
  deleteRawValue?(key: string): Promise<void>;
}
