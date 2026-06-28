import { Folder, FolderOpen } from "lucide-react";
/**
 * Shared suggestion popup for both @mention and /slash-command.
 * Rendered via TipTap's suggestion utility with tippy.js.
 */
import { FileIcon, FolderIcon } from "@/components/workspace/file-tree-editor/file-icons";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import {
	forwardRef,
	lazy,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
} from "react";
import { useReactive } from "ahooks";

// FsNode type for workspace file tree
interface FsNode {
	name: string;
	path: string;
	is_dir: boolean;
	children?: FsNode[];
}

// Lazy load shared workspace tree component.
const ReadonlyFileTree = lazy(() =>
	import("../workspace/file-tree-editor/readonly-file-tree").then(
		(m) => ({ default: m.ReadonlyFileTree }),
	),
);

export interface SuggestionItem {
	id: string;
	label: string;
	description?: string;
	icon?: React.ReactNode;
	group?: string;
	isDirectory?: boolean;
	expanded?: boolean;
	path?: string;
	level?: number;
}

export interface MentionListRef {
	onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionListProps {
	items: SuggestionItem[];
	command: (item: SuggestionItem) => void;
	onFolderClick?: (item: SuggestionItem) => void;
	executeOnMouseDown?: boolean;
	/** Enable search input (for @mention panel) */
	enableSearch?: boolean;
	/** Close the popup (called on Esc) */
	onClose?: () => void;
	/** When set, render a read-only file tree instead of flat list */
	workspaceDir?: string;
}

const SEARCH_DEBOUNCE_MS = 160;
const WORKSPACE_SEARCH_LIMIT = 80;

function normalizeQuery(query: string) {
	return query.trim().toLowerCase();
}

function getPathLabel(path?: string) {
	if (!path) return "";
	const segments = path.split("/").filter(Boolean);
	return segments.join("/");
}

function getRelativePath(rootPath: string, targetPath?: string) {
	if (!targetPath) return "";
	if (targetPath === rootPath) return "";
	if (targetPath.startsWith(`${rootPath}/`)) {
		return targetPath.slice(rootPath.length + 1);
	}
	return targetPath;
}

async function buildWorkspaceSearchIndex(
	rootPath: string,
): Promise<SuggestionItem[]> {
	const flattened: SuggestionItem[] = [];
	// Dynamic import keeps the workspace tree/editor out of the initial editor bundle.
	const { fetchTree } = await import(
		"../workspace/file-tree-editor/FileTreeEditor"
	);
	const tree = await fetchTree(rootPath, 12);

	const walk = (nodes: FsNode[]) => {
		for (const node of nodes) {
			if (!node.name) continue;

			flattened.push({
				id: `file:${node.path}`,
				label: node.name,
				path: node.path,
				isDirectory: node.is_dir,
				description: node.is_dir ? "文件夹" : "文件",
				icon: node.is_dir ? <FolderIcon /> : <FileIcon name={node.name} />,
			});

			if (Array.isArray(node.children) && node.children.length > 0) {
				walk(node.children);
			}
		}
	};

	walk(tree.children ?? []);
	return flattened;
}

function highlightMatch(text: string, query: string) {
	if (!text) return text;
	const normalizedQuery = normalizeQuery(query);
	if (!normalizedQuery) return text;
	const normalizedText = text.toLowerCase();
	const matchIndex = normalizedText.indexOf(normalizedQuery);
	if (matchIndex < 0) return text;

	const before = text.slice(0, matchIndex);
	const matched = text.slice(matchIndex, matchIndex + normalizedQuery.length);
	const after = text.slice(matchIndex + normalizedQuery.length);

	return (
		<>
			{before}
			<mark className="rounded-sm bg-amber-300/60 px-0.5 text-foreground">
				{matched}
			</mark>
			{after}
		</>
	);
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(
	(
		{
			items,
			command,
			onFolderClick,
			executeOnMouseDown,
			enableSearch,
			onClose,
			workspaceDir,
		},
		ref,
	) => {
		const state = useReactive({
			selectedIndex: 0,
			searchQuery: "",
			workspaceSearchResults: null as SuggestionItem[] | null,
			workspaceSearchLoading: false,
		});
		const searchInputRef = useRef<HTMLInputElement>(null);
		const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const clickCountRef = useRef<{ index: number; count: number }>({
			index: -1,
			count: 0,
		});

		// Filter items by search query
		const filteredItems = state.searchQuery
			? items.filter(
					(item) =>
						item.label
							.toLowerCase()
							.includes(state.searchQuery.toLowerCase()) ||
						item.path?.toLowerCase().includes(state.searchQuery.toLowerCase()),
				)
			: items;
		const normalizedSearchQuery = useMemo(
			() => normalizeQuery(state.searchQuery),
			[state.searchQuery],
		);

		// Clamp selectedIndex when items array changes length
		useEffect(() => {
			if (filteredItems.length === 0) {
				state.selectedIndex = 0;
			} else {
				state.selectedIndex = Math.min(
					state.selectedIndex,
					filteredItems.length - 1,
				);
			}
		}, [filteredItems]);

		// Focus search input when component mounts and after re-renders
		useEffect(() => {
			if (enableSearch && searchInputRef.current) {
				// Use requestAnimationFrame to ensure DOM is ready
				requestAnimationFrame(() => {
					searchInputRef.current?.focus();
				});
			}
		});

		useEffect(() => {
			if (!workspaceDir) {
				state.workspaceSearchResults = null;
				state.workspaceSearchLoading = false;
				return;
			}

			if (!normalizedSearchQuery) {
				state.workspaceSearchResults = null;
				state.workspaceSearchLoading = false;
				return;
			}

			let cancelled = false;
			const timer = window.setTimeout(async () => {
				state.workspaceSearchLoading = true;
				try {
					const workspaceItems = await buildWorkspaceSearchIndex(workspaceDir);
					const results = workspaceItems
						.filter((item) => {
							const relativePath = getRelativePath(workspaceDir, item.path);
							const target = `${item.label} ${relativePath}`.toLowerCase();
							return target.includes(normalizedSearchQuery);
						})
						.sort((a, b) => {
							const aName = a.label.toLowerCase();
							const bName = b.label.toLowerCase();
							const aStarts = aName.startsWith(normalizedSearchQuery) ? 0 : 1;
							const bStarts = bName.startsWith(normalizedSearchQuery) ? 0 : 1;
							if (aStarts !== bStarts) return aStarts - bStarts;
							return (a.path || "").length - (b.path || "").length;
						})
						.slice(0, WORKSPACE_SEARCH_LIMIT);

					if (!cancelled) {
						state.workspaceSearchResults = results;
						state.selectedIndex = 0;
					}
				} catch {
					if (!cancelled) state.workspaceSearchResults = [];
				} finally {
					if (!cancelled) state.workspaceSearchLoading = false;
				}
			}, SEARCH_DEBOUNCE_MS);

			return () => {
				cancelled = true;
				window.clearTimeout(timer);
			};
		}, [normalizedSearchQuery, workspaceDir]);

		useEffect(() => {
			state.workspaceSearchResults = null;
			state.workspaceSearchLoading = false;
		}, [workspaceDir]);

		const selectItem = useCallback(
			(index: number) => {
				const item = filteredItems[index];
				if (item) command(item);
			},
			[filteredItems, command],
		);

		// Single click = expand/collapse folder, double click = select folder
		const handleItemClick = useCallback(
			(index: number) => {
				const item = filteredItems[index];
				if (!item) return;

				if (!item.isDirectory) {
					command(item);
					return;
				}

				if (clickCountRef.current.index === index) {
					clickCountRef.current.count++;
					if (clickCountRef.current.count === 2) {
						// Double click — select folder
						if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
						clickCountRef.current = { index: -1, count: 0 };
						command(item);
					}
				} else {
					clickCountRef.current = { index, count: 1 };
					if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
					clickTimerRef.current = setTimeout(() => {
						if (onFolderClick) onFolderClick(item);
						clickCountRef.current = { index: -1, count: 0 };
						clickTimerRef.current = null;
					}, 250);
				}
			},
			[filteredItems, command, onFolderClick],
		);

		useImperativeHandle(ref, () => ({
			onKeyDown: ({ event }: { event: KeyboardEvent }) => {
				if (event.key === "ArrowUp") {
					event.preventDefault();
					state.selectedIndex =
						state.selectedIndex <= 0
							? filteredItems.length - 1
							: state.selectedIndex - 1;
					return true;
				}
				if (event.key === "ArrowDown") {
					event.preventDefault();
					state.selectedIndex =
						state.selectedIndex >= filteredItems.length - 1
							? 0
							: state.selectedIndex + 1;
					return true;
				}
				if (event.key === "Enter" || event.key === "Tab") {
					event.preventDefault();
					const item = filteredItems[state.selectedIndex];
					if (item?.isDirectory) {
						if (onFolderClick) onFolderClick(item);
					} else {
						selectItem(state.selectedIndex);
					}
					return true;
				}
				if (event.key === "Escape") {
					onClose?.();
					return true;
				}
				return false;
			},
		}));

		// When workspaceDir is provided, show a file tree with a search input.
		// Searching switches to a flat filtered list for quick access.
		if (workspaceDir) {
			const searchFiltered = normalizedSearchQuery
				? state.workspaceSearchResults
				: null;

			return (
				<div className="rounded-md border bg-popover text-popover-foreground shadow-[0_4px_6px_rgba(0,0,0,0.08)] py-1 w-72 max-h-96 flex flex-col">
					<div className="px-2 pt-2 pb-1 shrink-0">
						<div className="relative">
							<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
							<input
								ref={searchInputRef}
								type="text"
								value={state.searchQuery}
								onChange={(e) => (state.searchQuery = e.target.value)}
								placeholder="搜索文件..."
								className="w-full h-7 pl-7 pr-2 text-xs border rounded bg-background outline-none focus:ring-1 focus:ring-ring"
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										if (state.searchQuery) {
											state.searchQuery = "";
										} else {
											e.preventDefault();
											onClose?.();
										}
									}
								}}
							/>
						</div>
					</div>
					<div className="overflow-y-auto flex-1 px-1">
						{normalizedSearchQuery ? (
							state.workspaceSearchLoading ? (
								<p className="text-xs text-muted-foreground px-2 py-3 text-center">
									搜索中...
								</p>
							) : searchFiltered && searchFiltered.length === 0 ? (
								<p className="text-xs text-muted-foreground px-2 py-3 text-center">
									无匹配结果
								</p>
							) : (
								searchFiltered?.map((item) => (
									<button
										key={item.id}
										type="button"
										className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-xs rounded hover:bg-foreground/[0.04] transition-colors"
										onClick={() => command(item)}
									>
										{item.icon || (item.isDirectory ? <FolderIcon /> : <FileIcon name={item.label} />)}
										<div className="min-w-0 flex-1">
											<div className="truncate font-medium">
												{highlightMatch(item.label, normalizedSearchQuery)}
											</div>
											<div className="truncate text-[10px] text-muted-foreground mt-0.5">
												{highlightMatch(
													getPathLabel(
														getRelativePath(workspaceDir, item.path),
													),
													normalizedSearchQuery,
												)}
											</div>
										</div>
									</button>
								))
							)
						) : (
							<ReadonlyFileTree
								rootPath={workspaceDir}
								onSelect={(path) => {
									const name = path.split("/").pop() || path;
									command({ id: `file:${path}`, label: name, path });
								}}
							/>
						)}
					</div>
				</div>
			);
		}

		if (filteredItems.length === 0) {
			return (
				<div className="rounded-md border bg-popover text-popover-foreground shadow-[0_4px_6px_rgba(0,0,0,0.08)] p-2 w-72">
					{enableSearch && (
						<div className="relative mb-2">
							<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
							<input
								ref={searchInputRef}
								type="text"
								value={state.searchQuery}
								onChange={(e) => (state.searchQuery = e.target.value)}
								placeholder="搜索文件..."
								className="w-full h-7 pl-7 pr-2 text-xs border rounded bg-background outline-none focus:ring-1 focus:ring-ring"
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										e.preventDefault();
										onClose?.();
									}
								}}
							/>
						</div>
					)}
					<p className="text-xs text-muted-foreground px-2 py-1.5">
						无匹配结果
					</p>
				</div>
			);
		}

		// Group items
		const groups: {
			key: string;
			items: (SuggestionItem & { globalIdx: number })[];
		}[] = [];
		let currentGroup = "";
		filteredItems.forEach((item, idx) => {
			const g = item.group || "";
			if (g !== currentGroup) {
				currentGroup = g;
				groups.push({ key: g, items: [] });
			}
			groups[groups.length - 1].items.push({ ...item, globalIdx: idx });
		});

		return (
			<div className="rounded-md border bg-popover text-popover-foreground shadow-[0_4px_6px_rgba(0,0,0,0.08)] py-1 w-72 max-h-80 flex flex-col">
				{enableSearch && (
					<div className="px-2 pt-2 pb-1 shrink-0">
						<div className="relative">
							<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
							<input
								ref={searchInputRef}
								type="text"
								value={state.searchQuery}
								onChange={(e) => (state.searchQuery = e.target.value)}
								placeholder="搜索文件..."
								className="w-full h-7 pl-7 pr-2 text-xs border rounded bg-background outline-none focus:ring-1 focus:ring-ring"
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										e.preventDefault();
										onClose?.();
										return;
									}
									// Delegate navigation keys to the ref handler
									if (
										e.key === "ArrowUp" ||
										e.key === "ArrowDown" ||
										e.key === "Enter" ||
										e.key === "Tab"
									) {
										e.preventDefault();
										ref &&
											"current" in ref &&
											ref.current?.onKeyDown({ event: e.nativeEvent });
									}
								}}
							/>
						</div>
					</div>
				)}
				<div className="overflow-y-auto flex-1">
					{groups.map((group) => (
						<div key={group.key || "__default"}>
							{group.key && (
								<div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
									{group.key}
								</div>
							)}
							{group.items.map((item) => (
								<button
									key={item.id}
									type="button"
									className={cn(
										"flex items-center gap-2.5 w-full text-left px-3 py-1.5 text-xs transition-colors",
										item.globalIdx === state.selectedIndex
											? "bg-primary/10 text-primary"
											: "text-foreground hover:bg-foreground/[0.04]",
									)}
									style={
										item.level
											? { paddingLeft: `${12 + item.level * 12}px` }
											: undefined
									}
									onMouseDown={(event) => {
										if (!executeOnMouseDown) return;
										event.preventDefault();
										handleItemClick(item.globalIdx);
									}}
									onClick={() => handleItemClick(item.globalIdx)}
									onMouseEnter={() => (state.selectedIndex = item.globalIdx)}
								>
									{(item.icon || item.isDirectory) && (
										<span
											className={`inline-flex size-[18px] items-center justify-center rounded-[3px] shrink-0 ${item.isDirectory ? "bg-amber-400/15" : "bg-muted"}`}
										>
											{item.isDirectory ? (
												item.expanded ? (
													<FolderOpen className="size-[13px] text-amber-600" />
												) : (
													<Folder className="size-[13px] text-amber-500" />
												)
											) : (
												item.icon
											)}
										</span>
									)}
									<div className="flex-1 min-w-0">
										<div className="font-medium truncate">{item.label}</div>
										{item.description && (
											<div className="text-[10px] text-muted-foreground truncate mt-0.5">
												{item.description}
											</div>
										)}
									</div>
								</button>
							))}
						</div>
					))}
				</div>
			</div>
		);
	},
);

MentionList.displayName = "MentionList";

export default MentionList;
