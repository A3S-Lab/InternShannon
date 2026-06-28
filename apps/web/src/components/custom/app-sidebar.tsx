import { useEffect, useMemo, useState } from "react";
import { type NavLink, useNavbar } from "./navbar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLocation } from "react-router-dom";
import { Logo } from "./logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

function flattenMenuLinks(links: NavLink[]): NavLink[] {
  return links.flatMap((item) => item.items?.length ? flattenMenuLinks(item.items) : [item]).filter((item) => item.url.startsWith("/"));
}

function collectActiveGroupUrls(links: NavLink[], activeUrl?: string): string[] {
  if (!activeUrl) return [];

  const groupUrls: string[] = [];
  for (const link of links) {
    if (!link.items?.length) continue;
    const childLinks = flattenMenuLinks(link.items);
    if (childLinks.some((child) => child.url === activeUrl)) {
      groupUrls.push(link.url, ...collectActiveGroupUrls(link.items, activeUrl));
    }
  }
  return groupUrls;
}

export function AppSidebar({ menus }: { menus: NavLink[] }) {
  const [open, setOpen] = useState(true);
  const location = useLocation();
  const pathnameWithHash = `${location.pathname}${location.hash}`;
  const { pathname } = location;
  const { navigate } = useNavbar();
  const defaultExpandedUrls = useMemo(() => menus.filter((item) => item.items?.length).map((item) => item.url), [menus]);
  const allMenuLinks = useMemo(() => flattenMenuLinks(menus), [menus]);
  const activeUrl = allMenuLinks
    .filter((link) => {
      if (link.url.includes("#")) return pathnameWithHash === link.url;
      return pathname === link.url || (link.url !== "/admin" && pathname.startsWith(`${link.url}/`));
    })
    .sort((left, right) => right.url.length - left.url.length)[0]?.url;
  const activeGroupUrls = useMemo(() => collectActiveGroupUrls(menus, activeUrl), [menus, activeUrl]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set([...defaultExpandedUrls, ...activeGroupUrls]));
  const isLinkActive = (url: string) => activeUrl === url;

  useEffect(() => {
    const requiredExpandedUrls = [...defaultExpandedUrls, ...activeGroupUrls];
    if (requiredExpandedUrls.length === 0) return;
    setExpandedGroups((current) => {
      const next = new Set(current);
      requiredExpandedUrls.forEach((url) => next.add(url));
      return next;
    });
  }, [activeGroupUrls, defaultExpandedUrls]);

  const toggleGroup = (url: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const renderNavButton = (link: NavLink, isActive: boolean, level = 0) => {
    const button = (
      <button
        key={link.url}
        type="button"
        aria-label={link.name}
        onClick={() => navigate(link)}
        onMouseEnter={link.prefetch}
        onFocus={link.prefetch}
        className={cn(
          "flex items-center rounded-md text-sm transition-colors",
          open ? "h-7 w-full gap-2 px-2.5" : "mx-auto size-9 justify-center p-0",
          open && level > 0 && "text-[13px]",
          isActive
            ? "bg-primary/10 font-semibold text-primary"
            : "text-muted-foreground hover:bg-[rgba(0,0,0,0.04)] hover:text-foreground",
        )}
      >
        {link.icon && <span className="shrink-0 [&>svg]:size-3.5">{link.icon}</span>}
        {open && <span className="truncate">{link.name}</span>}
      </button>
    );

    if (open) return button;

    return (
      <Tooltip key={link.url}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          {link.name}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderExpandedChildren = (links: NavLink[], level = 0) => (
    <div className="space-y-0.5">
      {links.map((link, index) => {
        if (link.items?.length) {
          return (
            <div key={link.url} className={cn(index > 0 && "pt-2")}>
              <div className="my-1 rounded bg-muted/50 px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                {link.name}
              </div>
              <div className="space-y-0.5">
                {renderExpandedChildren(link.items, level + 1)}
              </div>
            </div>
          );
        }

        return renderNavButton(link, isLinkActive(link.url), level + 1);
      })}
    </div>
  );

  const renderExpandedGroup = (item: NavLink) => {
    if (!item.items?.length) {
      return (
        <div key={item.url} className="px-3">
          {renderNavButton(item, isLinkActive(item.url))}
        </div>
      );
    }

    const expanded = expandedGroups.has(item.url);
    const isActiveGroup = activeGroupUrls.includes(item.url) || flattenMenuLinks(item.items).some((link) => link.url === activeUrl);

    return (
      <Collapsible key={item.url} open={expanded} onOpenChange={() => toggleGroup(item.url)} className="px-3">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={item.name}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors",
              isActiveGroup
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {item.icon && <span className="shrink-0 [&>svg]:size-4">{item.icon}</span>}
            <span className="min-w-0 flex-1 truncate text-left">{item.name}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-2 pt-1">
          <div className="ml-[19px] border-l border-border-light pl-2">
            {renderExpandedChildren(item.items)}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const renderCollapsedDropdownItems = (links: NavLink[], depth = 0) => (
    <>
      {links.map((link, index) => {
        if (link.items?.length) {
          return (
            <div key={link.url}>
              {(depth > 0 || index > 0) && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="my-1 rounded bg-muted/50 px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                {link.name}
              </DropdownMenuLabel>
              {renderCollapsedDropdownItems(link.items, depth + 1)}
            </div>
          );
        }

        return (
          <DropdownMenuItem
            key={link.url}
            onClick={() => navigate(link)}
            onMouseEnter={link.prefetch}
            onFocus={link.prefetch}
            className={cn("h-8 gap-2 rounded-md text-[13px]", isLinkActive(link.url) && "bg-primary/10 text-primary")}
          >
            {link.icon && <span className="[&>svg]:size-3.5">{link.icon}</span>}
            <span>{link.name}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );

  const renderCollapsedGroup = (item: NavLink) => {
    const isActiveGroup = activeGroupUrls.includes(item.url) || isLinkActive(item.url);

    if (!item.items?.length) {
      return (
        <div key={item.url} className="mb-1 px-3">
          {renderNavButton(item, isActiveGroup)}
        </div>
      );
    }

    return (
      <div key={item.url} className="mb-1 px-3">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={item.name}
                  className={cn(
                    "mx-auto flex size-9 items-center justify-center rounded-md transition-colors",
                    isActiveGroup ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {item.icon && <span className="[&>svg]:size-4">{item.icon}</span>}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              {item.name}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-56 p-1.5">
            <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-foreground">
              {item.name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {renderCollapsedDropdownItems(item.items)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <aside
      className={cn(
        "relative h-full shrink-0 border-r border-border-light bg-background transition-all duration-300 ease-in-out",
        open ? "w-48" : "w-16",
      )}
    >
      <Button
        className="absolute top-1/2 -right-3 z-30 h-6 w-6 rounded-md border-border-light bg-background text-muted-foreground shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all hover:bg-muted/50 dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
        size="icon"
        variant="outline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronLeft className="size-3" /> : <ChevronRight className="size-3" />}
      </Button>

      <div className="flex h-full flex-col py-3">
        <div className={cn("mb-3", open ? "px-3" : "px-2")}>
          <div className={cn("flex h-9 items-center", open ? "gap-2 px-2" : "justify-center")}>
            <Logo collapsed={!open} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {menus.map((item) => {
            if (!open) return renderCollapsedGroup(item);
            return <div key={item.url} className="mb-1">{renderExpandedGroup(item)}</div>;
          })}
        </div>
      </div>
    </aside>
  );
}
