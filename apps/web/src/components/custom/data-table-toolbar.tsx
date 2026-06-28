import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL_VALUE_SENTINEL = "__all__";

export interface DataTableFacetOption<TValue extends string> {
  value: TValue;
  label: string;
}

/**
 * 配合 DataTable.toolbar 插槽使用的标准下拉筛选。
 * 默认：value="" 表示未筛选（"全部"），组件内部用 sentinel 兼容 Radix 不允许空字符串值的限制。
 * 当 includeAllOption={false} 时：不渲染"全部"项，value 必须是某个选项值，没有清除态。
 */
export function DataTableFacetFilter<TValue extends string>({
  label,
  value,
  onChange,
  options,
  allLabel = "全部",
  includeAllOption = true,
  width = "w-36",
  className,
}: {
  label: string;
  value: TValue | "";
  onChange: (next: TValue | "") => void;
  options: ReadonlyArray<DataTableFacetOption<TValue>>;
  allLabel?: string;
  includeAllOption?: boolean;
  width?: string;
  className?: string;
}) {
  const selectValue = value === "" ? ALL_VALUE_SENTINEL : value;
  return (
    <Select
      value={selectValue}
      onValueChange={(next) => onChange(next === ALL_VALUE_SENTINEL ? "" : (next as TValue))}
    >
      <SelectTrigger className={cn("h-9", width, className)} aria-label={label}>
        <span className="mr-1 text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeAllOption ? <SelectItem value={ALL_VALUE_SENTINEL}>{allLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface DataTableSegmentedOption<TValue extends string> {
  value: TValue;
  label: string;
  /** 显示在标签右侧的次级数字（例如条目计数）；undefined 不显示。 */
  count?: number;
}

/**
 * 分段（Tab 风格）筛选器，适合状态/范畴等少量互斥选项 + 每项需要计数的场景。
 * 与 FacetFilter 的下拉风格互补；选中时高亮一格，常用于状态、订单等列表。
 */
export function DataTableSegmentedFilter<TValue extends string>({
  value,
  onChange,
  options,
  loading = false,
  ariaLabel,
  className,
}: {
  value: TValue;
  onChange: (next: TValue) => void;
  options: ReadonlyArray<DataTableSegmentedOption<TValue>>;
  loading?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap gap-1 rounded-[4px] border border-border-light bg-muted/40 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            className={cn(
              "h-8 rounded-[4px] px-3 text-xs font-medium transition-colors",
              active
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="ml-1 text-[11px] text-muted-foreground">
                {loading ? "-" : option.count.toLocaleString("zh-CN")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 圆角胶囊（Pill）风格的预设筛选条，通常作为"快捷预设"渲染在 DataTable 上方而非 toolbar 内。
 * 与 SegmentedFilter 的区别：
 * - SegmentedFilter 是表格 toolbar 内紧贴 search 的分段控件，强调"互斥分组"。
 * - PresetTabs 放在 DataTable 之上，强调"快速跳到几个常用视图"。
 * 视觉上对齐 kernel/processes 页的预设条样式，便于跨页一致。
 */
export function DataTablePresetTabs<TValue extends string>({
  value,
  onChange,
  options,
  loading = false,
  ariaLabel,
  className,
}: {
  value: TValue;
  onChange: (next: TValue) => void;
  options: ReadonlyArray<DataTableSegmentedOption<TValue>>;
  loading?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  // 与 ui/tabs 的 TabsList/TabsTrigger 同款分段框风格(全站 tab 栏统一);保留 count 徽章与换行能力。
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex min-h-8 flex-wrap items-center justify-start gap-0.5 rounded-[7px] border border-border-light bg-muted/45 p-0.5 text-muted-foreground",
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-[6px] px-2.5 py-0.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="rounded bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {loading ? "-" : option.count.toLocaleString("zh-CN")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 已激活的筛选 chip：显示 label + value，附带清除单个筛选的 X 按钮。
 * 通常在 DataTableFilterBar 内或独立 chip 行使用，用于补充 dropdown 反馈"当前生效的高级筛选条件"。
 */
export function DataTableFilterChip({
  label,
  value,
  onClear,
  className,
}: {
  label: string;
  value: ReactNode;
  onClear: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-foreground",
        className,
      )}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span className="max-w-[160px] truncate font-medium">{value}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`清除${label}筛选`}
        className="ml-0.5 inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * 一组筛选 + "清除筛选"按钮的容器。配合 DataTable.toolbar 插槽使用。
 * activeCount > 0 时显示清除按钮，按钮上带激活筛选项数。
 */
export function DataTableFilterBar({
  children,
  activeCount = 0,
  onClear,
  className,
}: {
  children: ReactNode;
  activeCount?: number;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
      {activeCount > 0 && onClear ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="size-3.5" />
          清除筛选
          <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
            {activeCount}
          </span>
        </Button>
      ) : null}
    </div>
  );
}
