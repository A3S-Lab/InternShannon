import type { AppSettings } from './settings-schema';

export const DESKTOP_MODEL_CONFIG_SYNC = Symbol('DESKTOP_MODEL_CONFIG_SYNC');

export interface IDesktopModelConfigSync {
    sync(settings: AppSettings): Promise<void>;
}
