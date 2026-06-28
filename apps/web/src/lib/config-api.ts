/**
 * Compatibility facade for ConfigModule callers.
 *
 * The transport and response handling live in `@/lib/api/config`; this module
 * only preserves the older method names used by the desktop settings model.
 */
import { configApi as gatewayConfigApi } from "@/lib/api/config";
import type {
  AiSettings,
  AppearanceSettings,
  EditorSettings,
  GeneralSettings,
  NetworkSettings,
  SearchSettings,
  StorageSettings,
} from "@/lib/api/config";
import type { AppSettings as LegacyAppSettings, SecuritySettings } from "@/types/config";

export interface SystemInfo {
  appName?: string;
  logoUrl?: string;
  version: string;
}

export const configApi = {
  getSystemInfo: () => gatewayConfigApi.systemInfo() as Promise<SystemInfo>,

  getSettings: () => gatewayConfigApi.get() as Promise<LegacyAppSettings>,
  setSettings: (settings: LegacyAppSettings) => gatewayConfigApi.save(settings as Parameters<typeof gatewayConfigApi.save>[0]),
  patchSettings: (patch: Partial<LegacyAppSettings>) =>
    gatewayConfigApi.patch(patch as Parameters<typeof gatewayConfigApi.patch>[0]),
  resetSettings: () => gatewayConfigApi.reset() as Promise<LegacyAppSettings>,

  getGeneralSettings: () => gatewayConfigApi.getGeneral() as Promise<GeneralSettings>,
  setGeneralSettings: (settings: GeneralSettings) => gatewayConfigApi.saveGeneral(settings),

  getAppearanceSettings: () => gatewayConfigApi.getAppearance() as Promise<AppearanceSettings>,
  setAppearanceSettings: (settings: AppearanceSettings) => gatewayConfigApi.saveAppearance(settings),

  getEditorSettings: () => gatewayConfigApi.getEditor() as Promise<EditorSettings>,
  setEditorSettings: (settings: EditorSettings) => gatewayConfigApi.saveEditor(settings),

  getAiSettings: () => gatewayConfigApi.getLlm() as Promise<AiSettings>,
  setAiSettings: (settings: AiSettings) => gatewayConfigApi.saveLlm(settings),

  getSecuritySettings: () => gatewayConfigApi.getSecurity(),
  setSecuritySettings: (settings: SecuritySettings) =>
    gatewayConfigApi.saveSecurity(settings as Parameters<typeof gatewayConfigApi.saveSecurity>[0]),

  getNetworkSettings: () => gatewayConfigApi.getNetwork() as Promise<NetworkSettings>,
  setNetworkSettings: (settings: NetworkSettings) => gatewayConfigApi.saveNetwork(settings),

  getSearchSettings: () => gatewayConfigApi.getSearch() as Promise<SearchSettings>,
  setSearchSettings: (settings: SearchSettings) => gatewayConfigApi.saveSearch(settings),

  getStorageSettings: () => gatewayConfigApi.getStorage() as Promise<StorageSettings>,
  setStorageSettings: (settings: StorageSettings) => gatewayConfigApi.saveStorage(settings),
};
