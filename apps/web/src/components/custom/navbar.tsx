import { ArrowLeftToLine, ArrowRightToLine, CircleDashed, PanelLeftClose, RefreshCw, X } from "lucide-react";
import React, { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { onUserStorageScopeChange, readUserJsonStorage, writeUserJsonStorage } from "@/lib/browser-storage";
import { cn } from "@/lib/utils";

export interface NavLink {
  name: string;
  url: string;
  icon?: React.ReactNode;
  permission?: string;
  superAdminOnly?: boolean;
  /**
   * 任一权限即可见（OR）。设置后优先于 `permission`：用于合并了多类内容、各 tab 各自分权的页面
   * （如「内核 → 资产」聚合内置智能体/模型/工具，或兼容旧权限入口）。
   */
  permissionsAny?: readonly string[];
  openInNewTab?: boolean;
  items?: NavLink[];
  /** 预取该菜单页的懒加载 chunk（hover/focus 时调用），点开时即时显示、消除卡顿。 */
  prefetch?: () => void;
}

interface KeepAliveRef {
  refresh?: (url?: string) => void;
}

type NavbarContext = {
  aliveRef: MutableRefObject<KeepAliveRef | undefined>;
  defaultLink: NavLink;
  current: string;
  links: NavLink[];
  getLinkIcon: (link: NavLink) => React.ReactNode;
  navigate: (link: NavLink) => void;
  refresh: (link: NavLink) => void;
  refreshCurrent: () => void;
  close: (link: NavLink) => void;
  closeCurrent: () => void;
  closeLeft: (link: NavLink) => void;
  closeRight: (link: NavLink) => void;
  closeOther: (link: NavLink) => void;
  closeAll: () => void;
};

const NavbarContext = React.createContext<NavbarContext | null>(null);

function useNavbar() {
  const context = React.useContext(NavbarContext);
  if (!context) {
    throw new Error("useNavbar must be used within a NavbarProvider.");
  }
  return context;
}

function navUrlMatchesCurrent(linkUrl: string, current: string) {
  if (current === linkUrl) return true;
  const [linkPath] = linkUrl.split("#");
  const [currentPathAndSearch] = current.split("#");
  const [currentPath] = currentPathAndSearch.split("?");
  if (!linkUrl.includes("#")) {
    const [linkPathOnly] = linkPath.split("?");
    return linkPathOnly === currentPath;
  }
  return Boolean(linkUrl.includes("#") && linkPath === currentPath);
}

const STORAGE_KEY = "a3s-navbar-links";

function filterTabbedLinks(
  links: NavLink[],
  tabExcludedUrls: ReadonlySet<string>,
  defaultLink: NavLink,
  allowedUrls?: ReadonlySet<string>,
) {
  const filtered = links.filter(
    (link) => !tabExcludedUrls.has(link.url) && (!allowedUrls || allowedUrls.has(link.url)),
  );
  return filtered.length > 0 ? filtered : [defaultLink];
}

const loadLinksFromLocalStorage = (
  defaultLink: NavLink,
  tabExcludedUrls: ReadonlySet<string>,
  allowedUrls?: ReadonlySet<string>,
): NavLink[] => {
  try {
    const links = readUserJsonStorage<NavLink[]>(STORAGE_KEY, []);
    if (Array.isArray(links) && links.length > 0) {
      return filterTabbedLinks(links, tabExcludedUrls, defaultLink, allowedUrls);
    }
  } catch {
    // ignore
  }
  return [defaultLink];
};

const saveLinksToLocalStorage = (
  links: NavLink[],
  tabExcludedUrls: ReadonlySet<string>,
  allowedUrls?: ReadonlySet<string>,
) => {
  // Only save url, name, and items - icon is restored via getLinkIcon
  const toSave = links
    .filter((link) => !tabExcludedUrls.has(link.url) && (!allowedUrls || allowedUrls.has(link.url)))
    .map((link) => ({ url: link.url, name: link.name, items: link.items }));
  writeUserJsonStorage(STORAGE_KEY, toSave);
};

const NavbarProvider = ({
  aliveRef,
  current,
  defaultLink,
  getLinkIcon,
  tabExcludedUrls = [],
  allowedUrls,
  children,
}: React.ComponentProps<"div"> & {
  aliveRef: MutableRefObject<KeepAliveRef | undefined>;
  current: string;
  defaultLink: NavLink;
  getLinkIcon: (link: NavLink) => React.ReactNode;
  tabExcludedUrls?: string[];
  allowedUrls?: string[];
}) => {
  const tabExcludedUrlSet = useMemo(() => new Set(tabExcludedUrls), [tabExcludedUrls]);
  const allowedUrlSet = useMemo(() => (allowedUrls ? new Set(allowedUrls) : undefined), [allowedUrls]);
  const [links, setLinks] = useState<NavLink[]>(() =>
    loadLinksFromLocalStorage(defaultLink, tabExcludedUrlSet, allowedUrlSet),
  );
  const nav = useNavigate();

  useEffect(() => {
    return onUserStorageScopeChange(() => {
      setLinks(loadLinksFromLocalStorage(defaultLink, tabExcludedUrlSet, allowedUrlSet));
    });
  }, [allowedUrlSet, defaultLink, tabExcludedUrlSet]);

  useEffect(() => {
    const nextLinks = filterTabbedLinks(links, tabExcludedUrlSet, defaultLink, allowedUrlSet);
    const linksChanged =
      nextLinks.length !== links.length || nextLinks.some((link, index) => link.url !== links[index]?.url);
    if (linksChanged) {
      setLinks(nextLinks);
      return;
    }
    saveLinksToLocalStorage(nextLinks, tabExcludedUrlSet, allowedUrlSet);
  }, [allowedUrlSet, defaultLink, links, tabExcludedUrlSet]);

  const navigate = useCallback(
    (link: NavLink) => {
      if (link.openInNewTab) {
        window.open(link.url, "_blank", "noopener,noreferrer");
        return;
      }
      nav(link.url);
      setLinks((prev) => (prev.some((l) => l.url === link.url) ? prev : [...prev, link]));
    },
    [nav],
  );

  const refresh = useCallback((_link: NavLink) => {
    window.location.reload();
  }, []);

  const refreshCurrent = useCallback(() => {
    window.location.reload();
  }, []);

  const close = useCallback(
    (link: NavLink) => {
      const index = links.findIndex((l) => l.url === link.url);
      const newLinks = links.filter((l) => l.url !== link.url);
      if (newLinks.length === 0) {
        newLinks.push(defaultLink);
      }
      setLinks(newLinks);
      const nextLink = newLinks[index >= 0 ? Math.min(index, newLinks.length - 1) : 0] ?? defaultLink;
      // 关掉标签后，如果当前正在看的页面已不再被任何剩余标签代表，就跳到相邻标签。
      // 覆盖两种情况：
      //   (a) 关的就是当前激活的标签；
      //   (b) 在某个列表标签的「子详情路由」上关掉它——资产详情 /admin/assets/:id 不会创建自己的
      //       标签，URL 也不等于、更不前缀于列表标签 /admin/assets/agents，旧的严格相等 / 单标签匹配
      //       都判不出来，于是关了标签却停在详情页（本次 bug）。
      // current 是 pathname+search+hash；navUrlMatchesCurrent 忽略 query/hash 按路径匹配，和 isActive 同源。
      const stillRepresented = newLinks.some((l) => navUrlMatchesCurrent(l.url, current));
      if (!stillRepresented) {
        nav(nextLink.url);
      }
    },
    [current, defaultLink, links, nav],
  );

  const closeCurrent = useCallback(() => {
    if (current !== defaultLink.url) {
      close({ url: current } as NavLink);
    }
  }, [close, current, defaultLink.url]);

  const closeLeft = useCallback(
    (link: NavLink) => {
      const index = links.findIndex((l) => l.url === link.url);
      setLinks((prev) => {
        const filtered = prev.filter((_, i) => i >= index || i === 0);
        return filtered.length > 0 ? filtered : [defaultLink];
      });
      if (links.findIndex((l) => l.url === current) < index) {
        nav(link.url);
      }
    },
    [current, defaultLink, links, nav],
  );

  const closeRight = useCallback(
    (link: NavLink) => {
      const index = links.findIndex((l) => l.url === link.url);
      setLinks((prev) => {
        const filtered = prev.filter((_, i) => i <= index || i === 0);
        return filtered.length > 0 ? filtered : [defaultLink];
      });
      if (links.findIndex((l) => l.url === current) > index) {
        nav(link.url);
      }
    },
    [current, defaultLink, links, nav],
  );

  const closeOther = useCallback(
    (link: NavLink) => {
      if (link.url === defaultLink.url) {
        // If closing others on default tab, just keep it
        setLinks([defaultLink]);
      } else {
        setLinks([defaultLink, link]);
      }
      nav(link.url);
    },
    [defaultLink, nav],
  );

  const closeAll = useCallback(() => {
    setLinks([defaultLink]);
    nav(defaultLink.url);
  }, [defaultLink, nav]);

  const contextValue = useMemo<NavbarContext>(
    () => ({
      aliveRef,
      defaultLink,
      current,
      links,
      getLinkIcon,
      navigate,
      refresh,
      refreshCurrent,
      close,
      closeCurrent,
      closeLeft,
      closeRight,
      closeOther,
      closeAll,
    }),
    [
      aliveRef,
      defaultLink,
      current,
      links,
      getLinkIcon,
      close,
      closeAll,
      closeCurrent,
      closeLeft,
      closeOther,
      closeRight,
      navigate,
      refresh,
      refreshCurrent,
    ],
  );

  return <NavbarContext.Provider value={contextValue}>{children}</NavbarContext.Provider>;
};

NavbarProvider.displayName = "NavbarProvider";

function Navbar() {
  const { defaultLink, current, links, getLinkIcon, navigate, close } = useNavbar();
  const navRef = useRef<HTMLElement | null>(null);
  const activeUrl = useMemo(() => links.find((link) => navUrlMatchesCurrent(link.url, current))?.url, [current, links]);

  useEffect(() => {
    if (!activeUrl) return;
    const activeItem = navRef.current?.querySelector<HTMLElement>("[data-active='true']");
    activeItem?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeUrl]);

  return (
    <div className="min-w-0 overflow-hidden">
      <nav
        ref={navRef}
        className="flex h-9 min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          event.preventDefault();
          event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        {links.map((link) => (
          <NavbarItem
            key={link.url}
            icon={getLinkIcon(link)}
            name={link.name}
            url={link.url}
            isActive={link.url === activeUrl}
            closeable={link.url !== defaultLink.url}
            onClick={() => navigate(link)}
            onClose={() => close(link)}
          />
        ))}
      </nav>
    </div>
  );
}

Navbar.displayName = "Navbar";

function NavbarItem({
  isActive = false,
  closeable = true,
  onClick,
  onClose,
  ...link
}: NavLink & {
  isActive?: boolean;
  closeable?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onClose?: () => void;
}) {
  const { defaultLink, close, closeLeft, closeRight, closeOther, closeAll, getLinkIcon } = useNavbar();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-active={isActive}
          className={cn(
            "group flex h-8 shrink-0 items-center overflow-hidden rounded-lg text-sm font-medium transition-all duration-200",
            isActive
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-[rgba(0,0,0,0.04)] text-muted-foreground hover:bg-[rgba(0,0,0,0.08)] hover:text-foreground",
          )}
        >
          <button
            type="button"
            className={cn(
              "flex h-full min-w-0 items-center gap-2 px-4 outline-none",
              closeable && "pr-2",
              "focus-visible:ring-2 focus-visible:ring-primary/30",
            )}
            onClick={onClick}
          >
            {getLinkIcon(link)}
            <span className="max-w-[120px] truncate">{link.name}</span>
          </button>
          {closeable && (
            <button
              type="button"
              aria-label={`关闭${link.name}标签页`}
              className={cn(
                "mr-1 flex size-5 items-center justify-center rounded-lg transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                isActive ? "text-primary-foreground hover:bg-background/10" : "hover:bg-border text-muted-foreground",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onClose?.();
              }}
            >
              <X className="size-2.5" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => window.location.reload()}>
          <RefreshCw className="size-4 mr-2" />
          刷新当前标签页
        </ContextMenuItem>
        {link.url !== defaultLink.url && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => closeLeft(link)}>
              <ArrowLeftToLine className="size-4 mr-2" />
              关闭左侧标签页
            </ContextMenuItem>
            <ContextMenuItem onClick={() => closeRight(link)}>
              <ArrowRightToLine className="size-4 mr-2" />
              关闭右侧标签页
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => closeOther(link)}>
          <CircleDashed className="size-4 mr-2" />
          关闭其他标签页
        </ContextMenuItem>
        <ContextMenuItem onClick={() => closeAll()}>
          <PanelLeftClose className="size-4 mr-2" />
          关闭全部标签页
        </ContextMenuItem>
        {link.url !== defaultLink.url && (
          <ContextMenuItem onClick={() => close(link)}>
            <X className="size-4 mr-2" />
            关闭当前标签页
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

NavbarItem.displayName = "NavbarItem";

export { Navbar, NavbarItem, NavbarProvider, useNavbar };
