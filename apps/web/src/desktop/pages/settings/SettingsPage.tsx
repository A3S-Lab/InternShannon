/**
 * Settings Page — unified settings dashboard.
 * Uses shared SidebarLayout for consistent navigation.
 */

import { Bot, Code2, FolderOpen, Globe, Info, Palette, PlugZap, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SidebarLayout, type SidebarSection } from "@/desktop/layouts/sidebar-layout";
import { readUserStorage, writeUserStorage } from "@/lib/browser-storage";

import { AboutSection } from "./components/about-section";
import { AiSection } from "./components/ai-section";
import { AppearanceSection } from "./components/appearance-section";
import { EditorSection } from "./components/editor-section";
import { McpSection } from "./components/mcp-section";
import { SearchSection } from "./components/search-section";
import { UpdateSection } from "./components/update-section";
import { WorkspaceSection } from "./components/workspace-section";
import { SETTINGS_CONTENT_MAX_WIDTH_CLASS } from "./settings-layout-state";
import {
  getSettingsSectionFromSearch,
  resolveSettingsSectionPreference,
  SETTINGS_SECTION_SEARCH_PARAM,
  type SettingsSectionId,
} from "./settings-section-state";

const STORAGE_KEY_SETTINGS_SECTION = "internshannon-settings-section";

const sections: SidebarSection<SettingsSectionId>[] = [
  {
    id: "workspace",
    label: "工作区",
    icon: FolderOpen,
    description: "目录与会话",
  },
  { id: "ai", label: "AI 服务", icon: Bot, description: "模型与认证" },
  { id: "mcp", label: "MCP 服务", icon: PlugZap, description: "工具服务" },
  {
    id: "search",
    label: "搜索引擎",
    icon: Globe,
    description: "默认引擎与无头浏览器",
  },
  { id: "editor", label: "编辑器", icon: Code2, description: "字体与快捷键" },
  {
    id: "appearance",
    label: "外观",
    icon: Palette,
    description: "主题与配色",
  },
  {
    id: "update",
    label: "更新",
    icon: RefreshCw,
    description: "版本检查与更新安装",
  },
  {
    id: "about",
    label: "关于",
    icon: Info,
    description: "产品信息与项目链接",
  },
];

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const routeSection = getSettingsSectionFromSearch(`?${searchParams.toString()}`);
  const [section, setSection] = useState<SettingsSectionId>(() =>
    resolveSettingsSectionPreference({
      routeSection,
      storedSection: readUserStorage(STORAGE_KEY_SETTINGS_SECTION),
    }),
  );

  useEffect(() => {
    const nextSection = resolveSettingsSectionPreference({
      routeSection,
      storedSection: readUserStorage(STORAGE_KEY_SETTINGS_SECTION),
    });
    setSection(nextSection);
    if (routeSection) {
      writeUserStorage(STORAGE_KEY_SETTINGS_SECTION, routeSection);
    }
  }, [routeSection]);

  return (
    <SidebarLayout
      title="设置"
      subtitle="管理应用配置"
      sections={sections}
      current={section}
      onChange={(s) => {
        setSection(s);
        writeUserStorage(STORAGE_KEY_SETTINGS_SECTION, s);
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set(SETTINGS_SECTION_SEARCH_PARAM, s);
            return next;
          },
          { replace: true },
        );
      }}
      hideFooter
      contentMaxWidth={SETTINGS_CONTENT_MAX_WIDTH_CLASS}
    >
      {section === "workspace" && <WorkspaceSection />}
      {section === "appearance" && <AppearanceSection />}
      {section === "ai" && <AiSection />}
      {section === "mcp" && <McpSection />}
      {section === "search" && <SearchSection />}
      {section === "update" && <UpdateSection />}
      {section === "about" && <AboutSection />}
      {section === "editor" && <EditorSection />}
    </SidebarLayout>
  );
}
