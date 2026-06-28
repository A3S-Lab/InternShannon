export const SETTINGS_SECTION_IDS = [
  "workspace",
  "appearance",
  "ai",
  "mcp",
  "editor",
  "search",
  "update",
  "about",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "workspace";
export const SETTINGS_SECTION_SEARCH_PARAM = "section";

const settingsSectionIdSet = new Set<string>(SETTINGS_SECTION_IDS);

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && settingsSectionIdSet.has(value);
}

export function resolveSettingsSection(value: unknown): SettingsSectionId {
  return isSettingsSectionId(value) ? value : DEFAULT_SETTINGS_SECTION;
}

export function getSettingsSectionFromSearch(search: string): SettingsSectionId | null {
  const section = new URLSearchParams(search).get(SETTINGS_SECTION_SEARCH_PARAM);
  return isSettingsSectionId(section) ? section : null;
}

export function resolveSettingsSectionPreference(input: {
  routeSection: unknown;
  storedSection: unknown;
}): SettingsSectionId {
  return isSettingsSectionId(input.routeSection) ? input.routeSection : resolveSettingsSection(input.storedSection);
}
