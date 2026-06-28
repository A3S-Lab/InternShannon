import { useDebounce, useMemoizedFn } from "ahooks";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ChevronUp,
  Search,
} from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

export interface DataTablePaginationState {
  page: number;
  pageSize: number;
  total: number;
  mode?: "offset" | "cursor";
  hasNext?: boolean;
  hasPrevious?: boolean;
}

export interface DataTableSortState {
  columnId: string;
  direction: SortDirection;
}

/**
 * 可选的行内分组。传入时表格不再分页，而是把 `processedRows`（已过滤+排序后的全量）
 * 按 `keyOf` 保序分到各组，每组先渲染一行可折叠的 group-header，再渲染该组数据行。
 * 仅 client 模式（未传 `pagination`）下生效。
 */
export interface DataTableGroupBy<TData> {
  /** 分组键：相同键的行归入同一组，按首次出现顺序保序排列。 */
  keyOf: (row: TData) => string;
  /** 组头渲染：拿到分组键与该组全部行，返回组头内容（折叠箭头由 DataTable 统一渲染）。 */
  header: (key: string, rows: TData[]) => ReactNode;
  /** 可选：返回 true 时该组默认折叠。 */
  defaultCollapsed?: (key: string, rows: TData[]) => boolean;
}

export interface DataTableColumn<TData> {
  id: string;
  header: ReactNode;
  accessor?: keyof TData | ((row: TData) => unknown);
  cell?: (row: TData) => ReactNode;
  sortValue?: (row: TData) => string | number | Date | null | undefined;
  searchValue?: (row: TData) => string | number | null | undefined;
  enableSorting?: boolean;
  enableSearch?: boolean;
  className?: string;
  headerClassName?: string;
  /** 设为 true 时，该列整列（含 TableCell 内边距）的点击都不会触发 onRowClick。 */
  ignoreRowClick?: boolean;
}

export interface DataTableProps<TData> {
  data: TData[];
  columns: Array<DataTableColumn<TData>>;
  getRowId: (row: TData, index: number) => string;
  loading?: boolean;
  searchPlaceholder?: string;
  initialSearch?: string;
  pageSize?: number;
  pageSizeOptions?: number[];
  initialSort?: DataTableSortState;
  pagination?: DataTablePaginationState;
  sort?: DataTableSortState | null;
  /** 受控搜索值；提供时由调用方驱动搜索状态，外部 reset 可清空搜索框。 */
  search?: string;
  /** 开启 "/" 键快捷聚焦搜索框（光标在 input/textarea/contentEditable 时不触发）。 */
  enableSlashShortcut?: boolean;
  onPaginationChange?: (pagination: { page: number; pageSize: number }) => void;
  onSortChange?: (sort: DataTableSortState | undefined) => void;
  onSearchChange?: (search: string) => void;
  toolbar?: ReactNode;
  actions?: ReactNode;
  empty?: ReactNode;
  /**
   * 卡片网格模式(opt-in)。传入时表体改为响应式卡片网格渲染每行(替代表格行),
   * 复用同一套搜索/筛选/分页/空态 chrome;未传时与原表格行为完全一致。
   * onRowClick / rowClassName / data-row-click-ignore 在卡片上同样生效。
   */
  renderCard?: (row: TData) => ReactNode;
  /** 卡片网格列阶 className,默认 grid-cols-1 sm:2 xl:3 2xl:4。 */
  cardGridClassName?: string;
  onRowClick?: (row: TData) => void;
  rowClassName?: string | ((row: TData) => string | undefined);
  className?: string;
  selectable?: boolean;
  selectedRowIds?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  isRowSelectable?: (row: TData) => boolean;
  /**
   * 行内分组（opt-in）。传入时按 `keyOf` 保序分组、隐藏分页控件、不做行分页；
   * 未传时表格行为与之前完全一致。仅 client 模式生效（server 分页下忽略）。
   */
  groupBy?: DataTableGroupBy<TData>;
}

function getAccessorValue<TData>(row: TData, column: DataTableColumn<TData>): unknown {
  if (!column.accessor) return undefined;
  if (typeof column.accessor === "function") return column.accessor(row);
  return row[column.accessor];
}

function normalizeSearchValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function compareValues(left: unknown, right: unknown): number {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  return normalizeSearchValue(leftValue).localeCompare(normalizeSearchValue(rightValue), "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function SelectAllCheckbox<TData>({
  pageRows,
  getRowId,
  isRowSelectable,
  selectedRowIds,
  onSelectionChange,
}: {
  pageRows: TData[];
  getRowId: (row: TData, index: number) => string;
  isRowSelectable?: (row: TData) => boolean;
  selectedRowIds?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
}) {
  const selectableIds = pageRows.flatMap((row, index) =>
    !isRowSelectable || isRowSelectable(row) ? [getRowId(row, index)] : [],
  );
  if (selectableIds.length === 0) return null;
  const selectedCount = selectableIds.filter((id) => selectedRowIds?.has(id)).length;
  const allChecked = selectedCount === selectableIds.length;
  const indeterminate = selectedCount > 0 && !allChecked;
  return (
    <Checkbox
      checked={allChecked ? true : indeterminate ? "indeterminate" : false}
      onCheckedChange={(next: boolean | "indeterminate") => {
        if (!onSelectionChange) return;
        const draft = new Set(selectedRowIds ?? []);
        if (next === true) {
          for (const id of selectableIds) draft.add(id);
        } else {
          for (const id of selectableIds) draft.delete(id);
        }
        onSelectionChange(draft);
      }}
      aria-label="全选当前页"
    />
  );
}

function SortIcon({ active, direction }: { active: boolean; direction?: SortDirection }) {
  if (!active) return <ChevronsUpDown className="size-3.5 text-muted-foreground/60" />;
  if (direction === "asc") return <ChevronUp className="size-3.5 text-primary" />;
  return <ChevronDown className="size-3.5 text-primary" />;
}

const DEFAULT_CARD_GRID = "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

export function DataTable<TData>({
  data,
  columns,
  getRowId,
  loading = false,
  searchPlaceholder = "搜索…",
  initialSearch = "",
  pageSize = 10,
  pageSizeOptions = [10, 20, 50, 100],
  initialSort,
  pagination,
  sort: controlledSort,
  search: controlledSearch,
  enableSlashShortcut = false,
  onPaginationChange,
  onSortChange,
  onSearchChange,
  toolbar,
  actions,
  empty,
  renderCard,
  cardGridClassName,
  onRowClick,
  rowClassName,
  className,
  selectable = false,
  selectedRowIds,
  onSelectionChange,
  isRowSelectable,
  groupBy,
}: DataTableProps<TData>) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [internalSearch, setInternalSearch] = useState(controlledSearch ?? initialSearch);
  // 外部 controlled search（例如 reset 按钮置空）需要同步回内部，保证 Input 显示正确。
  useEffect(() => {
    if (controlledSearch === undefined) return;
    setInternalSearch((current) => (current === controlledSearch ? current : controlledSearch));
  }, [controlledSearch]);
  const search = internalSearch;
  const debouncedSearch = useDebounce(search, { wait: 180 });
  const emitSearchChange = useMemoizedFn((nextSearch: string) => {
    onSearchChange?.(nextSearch);
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);
  const [internalSort, setInternalSort] = useState<DataTableSortState | undefined>(initialSort);
  const serverMode = Boolean(pagination);
  // 分组仅在 client 模式生效（server 分页拿不到全量、无法保证分组完整）。
  const grouped = Boolean(groupBy) && !serverMode;
  const sortControlled = controlledSort !== undefined;
  const sort = serverMode || sortControlled ? (controlledSort ?? undefined) : internalSort;
  const effectivePage = pagination?.page ?? currentPage;
  const effectivePageSize = pagination?.pageSize ?? rowsPerPage;
  const cursorMode = pagination?.mode === "cursor";

  useEffect(() => {
    if (serverMode) return;
    setRowsPerPage((current) => (current === pageSize ? current : pageSize));
    setCurrentPage(1);
  }, [pageSize, serverMode]);

  useEffect(() => {
    if (!enableSlashShortcut) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      const input = searchInputRef.current;
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enableSlashShortcut]);

  useEffect(() => {
    // server 模式：把搜索词回传给调用方驱动后端查询。
    // grouped / controlled 模式：也回传，让调用方的搜索框状态（如 reset / filtersDirty / 导出范围）
    // 与 DataTable 内部一致；过滤本身仍由 DataTable 客户端完成。
    if (serverMode || grouped || onSearchChange) {
      emitSearchChange(debouncedSearch.trim());
    }
  }, [debouncedSearch, emitSearchChange, serverMode, grouped, onSearchChange]);

  const searchableColumns = useMemo(
    () => columns.filter((column) => column.enableSearch !== false && (column.searchValue || column.accessor)),
    [columns],
  );

  const processedRows = useMemo(() => {
    if (serverMode) return data;

    const keyword = debouncedSearch.trim().toLowerCase();
    const filtered = keyword
      ? data.filter((row) =>
          searchableColumns.some((column) => {
            const value = column.searchValue ? column.searchValue(row) : getAccessorValue(row, column);
            return normalizeSearchValue(value).toLowerCase().includes(keyword);
          }),
        )
      : data;

    if (!sort) return filtered;

    const column = columns.find((item) => item.id === sort.columnId);
    if (!column) return filtered;

    return [...filtered].sort((left, right) => {
      const leftValue = column.sortValue ? column.sortValue(left) : getAccessorValue(left, column);
      const rightValue = column.sortValue ? column.sortValue(right) : getAccessorValue(right, column);
      const result = compareValues(leftValue, rightValue);
      return sort.direction === "asc" ? result : -result;
    });
  }, [columns, data, debouncedSearch, searchableColumns, serverMode, sort]);

  // 按 keyOf 保序分组（首次出现顺序），用于 group-header 渲染。仅 grouped 时计算。
  const groups = useMemo(() => {
    if (!grouped || !groupBy) return [];
    const order: string[] = [];
    const byKey = new Map<string, TData[]>();
    for (const row of processedRows) {
      const key = groupBy.keyOf(row);
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = [];
        byKey.set(key, bucket);
        order.push(key);
      }
      bucket.push(row);
    }
    return order.map((key) => ({ key, rows: byKey.get(key) ?? [] }));
  }, [grouped, groupBy, processedRows]);

  // 折叠状态：组件内自管。初值由 defaultCollapsed 决定（仅首次为该键建态时应用一次）。
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const seededKeysRef = useRef<Set<string>>(new Set());
  // collapsedKeys 故意不入依赖：seed 只在新出现的组 key 上跑一次，避免覆盖用户手动展开/折叠。
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed-once 语义，collapsedKeys 仅作初值读取不应触发重跑
  useEffect(() => {
    if (!grouped || !groupBy?.defaultCollapsed) return;
    let mutated = false;
    const nextSeeded = seededKeysRef.current;
    const nextCollapsed = new Set(collapsedKeys);
    for (const group of groups) {
      if (nextSeeded.has(group.key)) continue;
      nextSeeded.add(group.key);
      if (groupBy.defaultCollapsed(group.key, group.rows)) {
        nextCollapsed.add(group.key);
        mutated = true;
      }
    }
    if (mutated) setCollapsedKeys(nextCollapsed);
  }, [grouped, groupBy, groups]);

  const toggleGroup = useMemoizedFn((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  });

  const totalItems = pagination?.total ?? processedRows.length;
  const totalKnown = !cursorMode || totalItems >= 0;
  const totalPages = cursorMode
    ? Math.max(1, effectivePage + (pagination?.hasNext ? 1 : 0))
    : Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const safePage = Math.min(effectivePage, totalPages);
  // grouped 模式不分页，全量渲染（start=0）；否则按 client/server 模式分页。
  const start = grouped ? 0 : (safePage - 1) * effectivePageSize;
  const pageRows = serverMode || grouped ? processedRows : processedRows.slice(start, start + effectivePageSize);
  const visibleStart = pageRows.length === 0 ? 0 : start + 1;
  const visibleEnd = serverMode ? start + pageRows.length : Math.min(start + effectivePageSize, totalItems);
  const canGoPrevious = cursorMode ? (pagination?.hasPrevious ?? safePage > 1) : safePage > 1;
  const canGoNext = cursorMode ? Boolean(pagination?.hasNext) : safePage < totalPages;

  const changePage = useMemoizedFn((page: number) => {
    const nextPage = Math.min(Math.max(1, page), totalPages);
    if (serverMode) {
      onPaginationChange?.({ page: nextPage, pageSize: effectivePageSize });
      return;
    }
    setCurrentPage(nextPage);
    onPaginationChange?.({ page: nextPage, pageSize: effectivePageSize });
  });

  const changePageSize = useMemoizedFn((nextPageSize: number) => {
    if (serverMode) {
      onPaginationChange?.({ page: 1, pageSize: nextPageSize });
      return;
    }
    setRowsPerPage(nextPageSize);
    setCurrentPage(1);
    onPaginationChange?.({ page: 1, pageSize: nextPageSize });
  });

  const toggleSort = useMemoizedFn((column: DataTableColumn<TData>) => {
    if (!column.enableSorting) return;
    const nextSort =
      sort?.columnId !== column.id
        ? { columnId: column.id, direction: "asc" as const }
        : sort.direction === "asc"
          ? { columnId: column.id, direction: "desc" as const }
          : undefined;

    if (serverMode) {
      onSortChange?.(nextSort);
      onPaginationChange?.({ page: 1, pageSize: effectivePageSize });
      return;
    }

    setCurrentPage(1);
    setInternalSort(nextSort);
    onSortChange?.(nextSort);
  });

  // 数据行渲染统一走这里：分组与非分组完全复用 columns[].cell，确保两条路径行为一致。
  // `indented` 仅在分组模式下为 true，给行加一层左缩进体现层级。
  const renderDataRow = useMemoizedFn((row: TData, rowId: string, indented: boolean) => {
    const checked = selectedRowIds?.has(rowId) ?? false;
    const rowSelectable = !isRowSelectable || isRowSelectable(row);
    return (
      <TableRow
        key={rowId}
        className={cn(
          onRowClick && "cursor-pointer",
          typeof rowClassName === "function" ? rowClassName(row) : rowClassName,
        )}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("button,a,input,textarea,select,[role='button'],[data-row-click-ignore]")) {
            return;
          }
          onRowClick?.(row);
        }}
      >
        {selectable ? (
          <TableCell className={cn("w-10 pr-0", indented && "pl-6")} data-row-click-ignore>
            <Checkbox
              checked={checked}
              disabled={!rowSelectable}
              onCheckedChange={(next: boolean | "indeterminate") => {
                if (!onSelectionChange) return;
                const draft = new Set(selectedRowIds ?? []);
                if (next === true) draft.add(rowId);
                else draft.delete(rowId);
                onSelectionChange(draft);
              }}
              aria-label="选择该行"
            />
          </TableCell>
        ) : null}
        {columns.map((column, columnIndex) => (
          <TableCell
            key={column.id}
            className={cn(column.className, indented && !selectable && columnIndex === 0 && "pl-6")}
            {...(column.ignoreRowClick ? { "data-row-click-ignore": "true" } : {})}
          >
            {column.cell ? column.cell(row) : normalizeSearchValue(getAccessorValue(row, column))}
          </TableCell>
        ))}
      </TableRow>
    );
  });

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2.5 rounded-[8px] border border-border-light bg-background px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              className="h-9 pl-8"
              value={search}
              data-table-search="true"
              onChange={(event) => {
                setInternalSearch(event.target.value);
                if (serverMode) {
                  onPaginationChange?.({ page: 1, pageSize: effectivePageSize });
                } else {
                  setCurrentPage(1);
                }
              }}
              placeholder={searchPlaceholder}
            />
          </div>
          {toolbar}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
      </div>

      <div className="overflow-hidden rounded-[8px] border border-border-light bg-background shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {renderCard ? (
          <div className="p-3 md:p-3.5">
            {loading ? (
              <div className={cn("grid gap-3", cardGridClassName ?? DEFAULT_CARD_GRID)}>
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders
                    key={`card-skeleton-${index}`}
                    className="h-44 animate-pulse rounded-md border border-border-light bg-muted/40"
                  />
                ))}
              </div>
            ) : pageRows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{empty ?? "暂无数据"}</div>
            ) : (
              <div className={cn("grid gap-3", cardGridClassName ?? DEFAULT_CARD_GRID)}>
                {pageRows.map((row, index) => {
                  const cardRowId = getRowId(row, start + index);
                  const interactiveCardProps = onRowClick
                    ? {
                        role: "button",
                        tabIndex: 0,
                        onClick: (event: MouseEvent<HTMLDivElement>) => {
                          // 卡片外层本身带 role="button"(为键盘可达),所以匹配时必须排除外层自身,
                          // 否则任意点击都会命中外层这一 [role='button'] 而被误当成「行内交互元素」跳过。
                          const interactive = (event.target as HTMLElement).closest(
                            "button,a,input,textarea,select,[role='button'],[data-row-click-ignore]",
                          );
                          if (interactive && interactive !== event.currentTarget) {
                            return;
                          }
                          onRowClick(row);
                        },
                        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          const interactive = (event.target as HTMLElement).closest(
                            "button,a,input,textarea,select,[role='button'],[data-row-click-ignore]",
                          );
                          if (interactive && interactive !== event.currentTarget) {
                            return;
                          }
                          event.preventDefault();
                          onRowClick(row);
                        },
                      }
                    : {};
                  return (
                    <div
                      key={cardRowId}
                      className={cn(
                        "group h-full",
                        onRowClick && "cursor-pointer",
                        typeof rowClassName === "function" ? rowClassName(row) : rowClassName,
                      )}
                      {...interactiveCardProps}
                    >
                      {renderCard(row)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {selectable ? (
                  <TableHead className="w-10 pr-0">
                    <SelectAllCheckbox
                      pageRows={pageRows}
                      getRowId={(row, idx) => getRowId(row, start + idx)}
                      isRowSelectable={isRowSelectable}
                      selectedRowIds={selectedRowIds}
                      onSelectionChange={onSelectionChange}
                    />
                  </TableHead>
                ) : null}
                {columns.map((column) => {
                  const sortable = column.enableSorting === true;
                  const active = sort?.columnId === column.id;
                  return (
                    <TableHead key={column.id} className={column.headerClassName}>
                      {sortable ? (
                        <button
                          type="button"
                          className="inline-flex max-w-full items-center gap-1.5 truncate text-left"
                          onClick={() => toggleSort(column)}
                        >
                          <span className="truncate">{column.header}</span>
                          <SortIcon active={active} direction={sort?.direction} />
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + (selectable ? 1 : 0)}
                    className="h-36 text-center text-muted-foreground"
                  >
                    加载中…
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + (selectable ? 1 : 0)}
                    className="h-36 text-center text-muted-foreground"
                  >
                    {empty ?? "暂无数据"}
                  </TableCell>
                </TableRow>
              ) : grouped && groupBy ? (
                groups.map((group) => {
                  const collapsed = collapsedKeys.has(group.key);
                  return (
                    <Fragment key={`group:${group.key}`}>
                      <TableRow
                        className="cursor-pointer border-y border-border bg-muted/70 hover:bg-muted"
                        onClick={(event) => {
                          const target = event.target as HTMLElement;
                          if (
                            target.closest("button,a,input,textarea,select,[role='button'],[data-row-click-ignore]")
                          ) {
                            return;
                          }
                          toggleGroup(group.key);
                        }}
                      >
                        <TableCell colSpan={columns.length + (selectable ? 1 : 0)} className="py-2.5">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleGroup(group.key);
                              }}
                              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                              aria-label={collapsed ? "展开分组" : "折叠分组"}
                              aria-expanded={!collapsed}
                            >
                              {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                            </button>
                            <div className="min-w-0 flex-1">{groupBy.header(group.key, group.rows)}</div>
                          </div>
                        </TableCell>
                      </TableRow>
                      {collapsed
                        ? null
                        : group.rows.map((row) => {
                            const rowId = getRowId(row, processedRows.indexOf(row));
                            return renderDataRow(row, rowId, true);
                          })}
                    </Fragment>
                  );
                })
              ) : (
                pageRows.map((row, index) => {
                  const rowId = getRowId(row, start + index);
                  return renderDataRow(row, rowId, false);
                })
              )}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-2 border-t border-border-light bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div>
            {grouped
              ? `${groups.length} 个分组 · ${processedRows.length} 条`
              : totalKnown
                ? `显示 ${visibleStart}-${visibleEnd} 条，共 ${totalItems} 条`
                : `显示 ${visibleStart}-${visibleEnd} 条`}
          </div>
          {grouped ? null : (
            <div className="flex items-center gap-1.5">
              <Select
                value={String(effectivePageSize)}
                onValueChange={(value) => {
                  changePageSize(Number(value));
                }}
              >
                <SelectTrigger className="h-7 w-[5.5rem] rounded-md text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option} 条
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="w-20 text-center tabular-nums">
                {cursorMode && !totalKnown ? `第 ${safePage} 页` : `${safePage} / ${totalPages}`}
              </span>
              <Button variant="outline" size="icon-sm" onClick={() => changePage(1)} disabled={!canGoPrevious}>
                <ChevronsLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => changePage(safePage - 1)}
                disabled={!canGoPrevious}
              >
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => changePage(safePage + 1)} disabled={!canGoNext}>
                <ChevronRight />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => changePage(totalPages)}
                disabled={cursorMode || !canGoNext}
              >
                <ChevronsRight />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
