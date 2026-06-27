import { AppSettings, AssistantSettings, StorageSettings } from './settings-schema';

export type DeepPartial<T> =
  T extends Array<infer Item>
    ? Array<DeepPartial<Item>>
    : T extends object
      ? { [Key in keyof T]?: DeepPartial<T[Key]> }
      : T;

export abstract class ConfigService {
  abstract getSettings(): Promise<AppSettings>;
  abstract setSettings(settings: AppSettings): Promise<void>;
  abstract patchSettings(patch: DeepPartial<AppSettings>): Promise<AppSettings>;
  abstract resetSettings(): Promise<AppSettings>;
  /** 清除缓存并从文件重新加载 */
  abstract reloadSettings(): Promise<AppSettings>;
  /** 读取本地存储配置子树;消费方经 CONFIG_SERVICE token 依赖本契约而非具体实现。 */
  abstract getStorageSettings(): Promise<StorageSettings>;
  /** 读取默认智能助手(默认内核助手)全局配置;内核运行时经 CONFIG_SERVICE token 依赖本契约。 */
  abstract getAssistantSettings(): Promise<AssistantSettings>;
}

export const CONFIG_SERVICE = 'CONFIG_SERVICE';
