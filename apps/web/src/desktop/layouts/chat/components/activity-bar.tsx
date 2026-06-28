import { BookOpenText, MessageCircle, Settings, Sparkles } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { readUserStorage, removeUserStorage, writeUserStorage } from "@/lib/browser-storage";
import { cn } from "@/lib/utils";
import { pathToActivityKey, resolveStoredActivityRoute, shouldPersistActivityKey } from "../activity-route-state";
import { User } from "./user";

const STORAGE_KEY = "internshannon-active-route";

const NAV_ITEMS = [
  { key: "chat", label: "对话", icon: MessageCircle, path: "/" },
  { key: "knowledge", label: "知识库", icon: BookOpenText, path: "/knowledge" },
  { key: "skills", label: "技能", icon: Sparkles, path: "/skills" },
] as const;

const BOTTOM_ITEMS = [
  { key: "settings", label: "设置", icon: Settings, path: "/settings" },
] as const;

const STATIC_KEYS: string[] = [...NAV_ITEMS.map((i) => i.key), ...BOTTOM_ITEMS.map((i) => i.key)];

const STATIC_ROUTE_MAP: Record<string, string> = {
  ...Object.fromEntries(NAV_ITEMS.map((i) => [i.key, i.path])),
  ...Object.fromEntries(BOTTOM_ITEMS.map((i) => [i.key, i.path])),
};

interface ActivityItemProps {
  isActive: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  tabIndex: number;
  itemRef: (el: HTMLButtonElement | null) => void;
}

const ActivityItem = ({
  icon,
  isActive,
  label,
  onClick,
  onKeyDown,
  tabIndex,
  itemRef,
}: ActivityItemProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
    <button
      ref={itemRef}
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-label={label}
      tabIndex={tabIndex}
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
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
};

export default function ActivityBar() {
  const location = useLocation();
  const nav = useNavigate();

  const activeKey = pathToActivityKey(location.pathname, {}, STATIC_KEYS, STATIC_ROUTE_MAP);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const itemRefCallbacks = useRef<Map<string, (el: HTMLButtonElement | null) => void>>(new Map());

  const allKeys = useMemo(() => [...STATIC_KEYS], []);
  const routeMap: Record<string, string> = useMemo(() => ({ ...STATIC_ROUTE_MAP }), []);

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
