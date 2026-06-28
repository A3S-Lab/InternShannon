/**
 * Unified Error Display Component
 *
 * A single, consistent error display component that can be used:
 * 1. Inline (for ErrorBoundary fallback, small spaces)
 * 2. As a notification toast (temporary, auto-dismiss)
 * 3. In the ErrorPanel (persistent, actionable)
 *
 * Features:
 * - Consistent styling with the app's design system
 * - Severity levels: error, warning, info
 * - Collapsible details
 * - Retry action
 * - Auto-dismiss option
 */
import React from "react";
import { useReactive } from "ahooks";
import {
	AlertCircle,
	AlertTriangle,
	Info,
	ChevronDown,
	ChevronUp,
	RefreshCw,
	X,
	Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export type ErrorSeverity = "error" | "warning" | "info";

export interface UnifiedErrorItem {
	id: string;
	severity: ErrorSeverity;
	title: string;
	message: string;
	details?: string;
	timestamp: Date;
	errorCode?: string;
	retryable?: boolean;
	onRetry?: () => void;
	stage?: string;
}

interface UnifiedErrorProps {
	error: UnifiedErrorItem;
	variant?: "inline" | "toast" | "panel";
	isExpanded?: boolean;
	onDismiss?: (id: string) => void;
	onRetry?: (id: string) => void;
	onToggleExpand?: (id: string) => void;
}

// ============================================================================
// Icon Mapping
// ============================================================================

const ICONS = {
	error: AlertCircle,
	warning: AlertTriangle,
	info: Info,
};

// ============================================================================
// Inline Error Display
// ============================================================================

export function InlineErrorDisplay({
	error,
	className,
}: {
	error: { message: string; title?: string; details?: string };
	className?: string;
}) {
	const state = useReactive({ expanded: false });
	const hasDetails = Boolean(error.details);

	return (
		<div
			className={cn(
				"flex items-start gap-2 rounded-md border p-3 text-sm",
				"bg-destructive/5 border-destructive/20",
				className,
			)}
		>
			<AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
			<div className="flex-1 min-w-0">
				{error.title && (
					<p className="font-medium text-destructive">{error.title}</p>
				)}
				<p className="text-muted-foreground">{error.message}</p>
				{hasDetails ? (
					<>
						<button
							type="button"
							onClick={() => (state.expanded = !state.expanded)}
							className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							{state.expanded ? "收起详情" : "查看详情"}
						</button>
						{state.expanded ? (
							<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/80 p-2 font-mono text-xs text-muted-foreground">
								{error.details}
							</pre>
						) : null}
					</>
				) : null}
			</div>
		</div>
	);
}

// ============================================================================
// Main Unified Error Component
// ============================================================================

export const UnifiedError: React.FC<UnifiedErrorProps> = ({
	error,
	variant = "panel",
	isExpanded: controlledExpanded,
	onDismiss,
	onRetry,
	onToggleExpand,
}) => {
	const state = useReactive({
		internalExpanded: false,
		isExiting: false,
	});

	const isExpanded = controlledExpanded ?? state.internalExpanded;
	const setExpanded = onToggleExpand
		? () => onToggleExpand(error.id)
		: () => (state.internalExpanded = !state.internalExpanded);

	const Icon = ICONS[error.severity];
	const hasDetails = error.details || error.errorCode;

	const timeStr = error.timestamp.toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

	// Inline variant - simple, compact display
	if (variant === "inline") {
		return (
			<div
				className={cn(
					"flex items-start gap-2 rounded-md border p-3 text-sm",
					"bg-destructive/5 border-destructive/20",
				)}
			>
				<Icon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
				<div className="flex-1 min-w-0">
					<p className="font-medium text-destructive">{error.title}</p>
					<p className="text-muted-foreground mt-0.5">{error.message}</p>
				</div>
				{onDismiss && (
					<button
						onClick={() => onDismiss(error.id)}
						className="shrink-0 rounded-md p-1 hover:bg-destructive/10 transition-colors"
					>
						<X className="h-4 w-4 text-muted-foreground" />
					</button>
				)}
			</div>
		);
	}

	// Toast variant - notification style with auto-dismiss
	if (variant === "toast") {
		return (
			<div
				className={cn(
					"flex items-start gap-3 rounded-md border bg-background p-4 shadow-[0_4px_6px_rgba(0,0,0,0.08)]",
					"min-w-[320px] max-w-[420px]",
					"transition-all duration-300 ease-out",
					state.isExiting
						? "opacity-0 translate-x-full"
						: "opacity-100 translate-x-0",
					// Border color by severity
					error.severity === "error" && "border-destructive/30",
					error.severity === "warning" && "border-yellow-300",
					error.severity === "info" && "border-primary/30",
				)}
			>
				<div className="mt-0.5 shrink-0">
					<Icon
						className={cn(
							"h-5 w-5",
							error.severity === "error" && "text-destructive",
							error.severity === "warning" && "text-yellow-600",
							error.severity === "info" && "text-primary",
						)}
					/>
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-start justify-between gap-2">
						<p
							className={cn(
								"font-medium text-sm",
								error.severity === "error" && "text-destructive",
								error.severity === "warning" && "text-yellow-700",
								error.severity === "info" && "text-primary",
							)}
						>
							{error.title}
						</p>
						{onDismiss && (
							<button
								onClick={() => {
									state.isExiting = true;
									setTimeout(() => onDismiss(error.id), 300);
								}}
								className="shrink-0 rounded-md p-1 hover:bg-muted transition-colors"
							>
								<X className="h-4 w-4 text-muted-foreground" />
							</button>
						)}
					</div>
					<p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
					{hasDetails && (
						<button
							onClick={setExpanded}
							className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							{isExpanded ? (
								<ChevronUp className="h-3 w-3" />
							) : (
								<ChevronDown className="h-3 w-3" />
							)}
							{isExpanded ? "收起详情" : "查看详情"}
						</button>
					)}
					{isExpanded && hasDetails && (
						<div className="mt-3 rounded-md bg-muted/50 p-3">
							<div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
								<Clock className="h-3 w-3" />
								{timeStr}
							</div>
							{error.errorCode && (
								<p className="text-xs font-mono text-muted-foreground mb-1">
									错误码: {error.errorCode}
								</p>
							)}
							{error.details && (
								<pre className="text-xs font-mono text-destructive/80 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
									{error.details}
								</pre>
							)}
						</div>
					)}
				</div>
			</div>
		);
	}

	// Panel variant - full display for error panel
	return (
		<div
			className={cn(
				"flex items-start gap-3 rounded-md border bg-background p-4",
				"shadow-sm hover:shadow-md transition-shadow",
				error.severity === "error" && "border-destructive/20",
				error.severity === "warning" && "border-yellow-200",
				error.severity === "info" && "border-primary/20",
			)}
		>
			<div className="mt-0.5 shrink-0">
				<Icon
					className={cn(
						"h-5 w-5",
						error.severity === "error" && "text-destructive",
						error.severity === "warning" && "text-yellow-600",
						error.severity === "info" && "text-primary",
					)}
				/>
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-start justify-between gap-2">
					<p
						className={cn(
							"font-medium text-sm",
							error.severity === "error" && "text-destructive",
							error.severity === "warning" && "text-yellow-700",
							error.severity === "info" && "text-primary",
						)}
					>
						{error.title}
					</p>
					<div className="flex items-center gap-1 shrink-0">
						{error.retryable && onRetry && (
							<button
								onClick={() => onRetry(error.id)}
								className="rounded-md p-1.5 hover:bg-muted transition-colors"
								title="重试"
							>
								<RefreshCw className="h-4 w-4 text-muted-foreground hover:text-foreground" />
							</button>
						)}
						{hasDetails && (
							<button
								onClick={setExpanded}
								className="rounded-md p-1.5 hover:bg-muted transition-colors"
								title={isExpanded ? "收起详情" : "查看详情"}
							>
								{isExpanded ? (
									<ChevronUp className="h-4 w-4 text-muted-foreground" />
								) : (
									<ChevronDown className="h-4 w-4 text-muted-foreground" />
								)}
							</button>
						)}
						{onDismiss && (
							<button
								onClick={() => onDismiss(error.id)}
								className="rounded-md p-1.5 hover:bg-muted transition-colors"
								title="关闭"
							>
								<X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
							</button>
						)}
					</div>
				</div>
				<p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
				{isExpanded && hasDetails && (
					<div className="mt-3 rounded-md bg-muted/50 p-3">
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
							<Clock className="h-3 w-3" />
							{timeStr}
						</div>
						{error.stage && (
							<p className="text-xs font-mono text-muted-foreground mb-1">
								阶段: {error.stage}
							</p>
						)}
						{error.details && (
							<pre className="text-xs font-mono text-destructive/80 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
								{error.details}
							</pre>
						)}
					</div>
				)}
			</div>
		</div>
	);
};

// ============================================================================
// Error Display Group
// ============================================================================

export function UnifiedErrorGroup({
	errors,
	variant = "panel",
	maxVisible = 3,
	onDismiss,
	onRetry,
}: {
	errors: UnifiedErrorItem[];
	variant?: "inline" | "toast" | "panel";
	maxVisible?: number;
	onDismiss?: (id: string) => void;
	onRetry?: (id: string) => void;
}) {
	const visibleErrors = errors.slice(0, maxVisible);
	const hiddenCount = Math.max(0, errors.length - maxVisible);

	if (errors.length === 0) return null;

	return (
		<div className="flex flex-col gap-2">
			{visibleErrors.map((error) => (
				<UnifiedError
					key={error.id}
					error={error}
					variant={variant}
					onDismiss={onDismiss}
					onRetry={onRetry}
				/>
			))}
			{hiddenCount > 0 && (
				<p className="py-2 text-sm text-center text-muted-foreground">
					还有 {hiddenCount} 个错误
				</p>
			)}
		</div>
	);
}

export default UnifiedError;
