import type { AppSettings } from './settings-schema';

export const DESKTOP_MODEL_CONFIG_SYNC = Symbol('DESKTOP_MODEL_CONFIG_SYNC');

export type DesktopModelConfigInvalidator = (reason?: string) => void | Promise<void>;

export interface IDesktopModelConfigSync {
    sync(settings: AppSettings): Promise<void>;
    registerInvalidator(callback: DesktopModelConfigInvalidator): void;
}
