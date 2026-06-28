import * as Icons from "lucide-react";
import { type LucideIcon, MessageCircle, Settings, SlidersHorizontal } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSnapshot } from "valtio";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import pluginModel from "@/desktop/models/plugin.model";
import { readUserStorage, removeUserStorage, writeUserStorage } from "@/lib/browser-storage";
import { cn } from "@/lib/utils";
import { pathToActivityKey, resolveStoredActivityRoute, shouldPersistActivityKey } from "../activity-route-state";
import { User } from "./user";

const STORAGE_KEY = "internshannon-active-route";

const NAV_ITEMS = [
  { key: "chat", label: "对话", icon: MessageCircle, path: "/" },
  { key: "skills", label: "配置", icon: SlidersHorizontal, path: "/skills" },
] as const;

const BOTTOM_ITEMS = [
  { key: "settings", label: "设置", icon: Settings, path: "/settings" },
] as const;

const STATIC_KEYS: string[] = [...NAV_ITEMS.map((i) => i.key), ...BOTTOM_ITEMS.map((i) => i.key)];

const STATIC_ROUTE_MAP: Record<string, string> = {
  ...Object.fromEntries(NAV_ITEMS.map((i) => [i.key, i.path])),
  ...Object.fromEntries(BOTTOM_ITEMS.map((i) => [i.key, i.path])),
};

function resolvePluginIcon(iconName: string): LucideIcon {
  const icon = (Icons as Record<string, unknown>)[iconName];
  return typeof icon === "function" ? (icon as LucideIcon) : Icons.Puzzle;
}

interface ActivityItemProps {
  isActive: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  tabIndex: number;
  itemRef: (el: HTMLButtonElement | null) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onUninstall?: () => void;
}

const ActivityItem = ({
  icon,
  isActive,
  label,
  onClick,
  onKeyDown,
  tabIndex,
  itemRef,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onUninstall,
}: ActivityItemProps) => {
  const button = (
    <button
      ref={itemRef}
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-label={label}
      tabIndex={tabIndex}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "relative flex flex-col justify-center items-center w-full h-10 cursor-pointer transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/35 focus-visible:ring-inset",
        isActive ? "text-white" : "text-white/40 hover:text-white/80",
      )}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {/* Active indicator — left edge accent */}
      <span
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-white transition-all duration-200",
          isActive ? "h-4 opacity-100" : "h-0 opacity-0",
        )}
      />
      {/* Icon container with glow background */}
      <div
        className={cn(
          "flex items-center justify-center size-7 rounded-md transition-all duration-200",
          isActive ? "bg-white/15 shadow-[0_0_8px_rgba(255,255,255,0.15)]" : "hover:bg-white/8",
        )}
      >
        <div className="size-4">{icon}</div>
      </div>
    </button>
  );

  if (onUninstall) {
    return (
      <Tooltip>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
          </ContextMenuTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
          <ContextMenuContent>
            <ContextMenuItem onClick={onUninstall}>卸载</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
};

export default function ActivityBar() {
  const location = useLocation();
  const nav = useNavigate();
  const { plugins } = useSnapshot(pluginModel.state);
  const installedPlugins = useMemo(() => plugins.filter((p) => p.installed), [plugins]);
  const pluginPathMap: Record<string, string> = useMemo(
    () => Object.fromEntries(installedPlugins.map((p) => [p.id, p.path])),
    [installedPlugins],
  );

  const [draggedId, setDraggedId] = useState<string | null>(null);

  const activeKey = pathToActivityKey(location.pathname, pluginPathMap, STATIC_KEYS, STATIC_ROUTE_MAP);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const itemRefCallbacks = useRef<Map<string, (el: HTMLButtonElement | null) => void>>(new Map());

  const allKeys = useMemo(() => [...STATIC_KEYS, ...installedPlugins.map((p) => p.id)], [installedPlugins]);
  const routeMap: Record<string, string> = useMemo(
    () => ({
      ...STATIC_ROUTE_MAP,
      ...pluginPathMap,
    }),
    [pluginPathMap],
  );

  const handleNavigate = useCallback(
    (key: string) => {
      const path = routeMap[key] ?? "/";
      nav(path);
      writeUserStorage(STORAGE_KEY, key);
    },
    [nav, routeMap],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent, currentKey: string) => {
      const idx = allKeys.indexOf(currentKey);
      let nextIdx = -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        nextIdx = (idx + 1) % allKeys.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nextIdx = (idx - 1 + allKeys.length) % allKeys.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIdx = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIdx = allKeys.length - 1;
      }

      if (nextIdx >= 0) {
        const nextKey = allKeys[nextIdx];
        itemRefs.current.get(nextKey)?.focus();
      }
    },
    [allKeys],
  );

  useEffect(() => {
    try {
      const stored = readUserStorage(STORAGE_KEY);
      const decision = resolveStoredActivityRoute({
        storedKey: stored,
        pathname: location.pathname,
        routeMap,
        staticKeys: STATIC_KEYS,
      });

      if (decision.kind === "clear") {
        removeUserStorage(STORAGE_KEY);
        return;
      }

      if (decision.kind === "navigate") {
        nav(decision.path, { replace: true });
      }
    } catch {
      // Storage unavailable
    }
  }, [location.pathname, nav, routeMap]);

  useEffect(() => {
    if (!shouldPersistActivityKey(location.pathname, activeKey, routeMap)) return;
    writeUserStorage(STORAGE_KEY, activeKey);
  }, [activeKey, location.pathname, routeMap]);

  const getItemRef = useCallback((key: string) => {
    const cached = itemRefCallbacks.current.get(key);
    if (cached) return cached;

    const callback = (el: HTMLButtonElement | null) => {
      if (el) itemRefs.current.set(key, el);
      else itemRefs.current.delete(key);
    };
    itemRefCallbacks.current.set(key, callback);
    return callback;
  }, []);

  const handleDragStart = (pluginId: string) => (e: React.DragEvent) => {
    setDraggedId(pluginId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedId && draggedId !== targetId) {
      pluginModel.reorder(draggedId, targetId);
    }
    setDraggedId(null);
  };

  const handleUninstall = (pluginId: string) => () => {
    pluginModel.uninstall(pluginId);
    if (activeKey === pluginId) {
      nav("/");
    }
  };

  return (
    <nav
      aria-label="Main navigation"
      className="flex flex-col h-full w-[var(--activity-bar-width)] bg-primary text-white/60 shadow-[0_4px_6px_rgba(0,0,0,0.08)]"
    >
      <div className="flex justify-center pt-3">
        <User />
      </div>
      <div className="flex-1 flex flex-col overflow-y-auto" role="tablist" aria-orientation="vertical">
        <div className="flex-1 pt-4">
          {/* Built-in nav items */}
          {NAV_ITEMS.map((item) => (
            <ActivityItem
              key={item.key}
              icon={<item.icon className="size-4" strokeWidth={activeKey === item.key ? 2.2 : 1.8} />}
              isActive={activeKey === item.key}
              label={item.label}
              tabIndex={activeKey === item.key ? 0 : -1}
              onClick={() => handleNavigate(item.key)}
              onKeyDown={(e) => handleKeyDown(e, item.key)}
              itemRef={getItemRef(item.key)}
            />
          ))}

          {/* Plugin separator + plugin items */}
          {installedPlugins.length > 0 && (
            <>
              <div className="mx-3 my-2 border-t border-primary-foreground/15" />
              {installedPlugins.map((plugin) => {
                const IconComp = resolvePluginIcon(plugin.icon);
                return (
                  <ActivityItem
                    key={plugin.id}
                    icon={<IconComp className="size-4" strokeWidth={activeKey === plugin.id ? 2.2 : 1.8} />}
                    isActive={activeKey === plugin.id}
                    label={plugin.name}
                    tabIndex={activeKey === plugin.id ? 0 : -1}
                    onClick={() => handleNavigate(plugin.id)}
                    onKeyDown={(e) => handleKeyDown(e, plugin.id)}
                    itemRef={getItemRef(plugin.id)}
                    draggable={true}
                    onDragStart={handleDragStart(plugin.id)}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop(plugin.id)}
                    onUninstall={handleUninstall(plugin.id)}
                  />
                );
              })}
            </>
          )}
        </div>
        <div className="pb-2">
          {/* Dev-only Box nav item */}
          {BOTTOM_ITEMS.map((item) => (
            <ActivityItem
              key={item.key}
              icon={<item.icon className="size-4" strokeWidth={activeKey === item.key ? 2.2 : 1.8} />}
              isActive={activeKey === item.key}
              label={item.label}
              tabIndex={activeKey === item.key ? 0 : -1}
              onClick={() => handleNavigate(item.key)}
              onKeyDown={(e) => handleKeyDown(e, item.key)}
              itemRef={getItemRef(item.key)}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}
