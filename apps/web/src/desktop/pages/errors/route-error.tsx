import { Button } from "@/components/ui/button";
import {
	clientErrorToDetails,
	normalizeClientError,
	notifyClientError,
} from "@/lib/client-error";
import { readStorage, removeStorage, writeStorage } from "@/lib/browser-storage";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, Home, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	isRouteErrorResponse,
	useNavigate,
	useRouteError,
} from "react-router-dom";

function getRouteErrorMessage(error: unknown): string {
	if (isRouteErrorResponse(error)) {
		return error.statusText || String(error.status);
	}
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (typeof error === "object" && error && "message" in error) {
		return String((error as { message?: unknown }).message ?? "未知错误");
	}
	return "页面加载或渲染失败";
}

function isChunkLoadError(error: unknown): boolean {
	return /Loading chunk|ChunkLoadError|failed to fetch dynamically imported module/i.test(
		getRouteErrorMessage(error),
	);
}

const CHUNK_RELOAD_KEY = "internshannon-route-chunk-reload";

export default function RouteErrorPage({
	className,
}: {
	className?: string;
}) {
	const routeError = useRouteError();
	const navigate = useNavigate();
	const [detailsOpen, setDetailsOpen] = useState(false);
	const chunkLoadError = isChunkLoadError(routeError);
	const clientError = useMemo(() => {
		if (isRouteErrorResponse(routeError)) {
			return normalizeClientError(routeError, {
				kind: "render",
				title: routeError.status === 404 ? "页面不存在" : "页面打开失败",
				message: routeError.statusText || "路由响应异常",
				source: "react-router",
				status: routeError.status,
			});
		}
		return normalizeClientError(routeError, {
			kind: chunkLoadError ? "network" : "render",
			title: chunkLoadError ? "界面资源加载失败" : "页面打开失败",
			message: chunkLoadError
				? "界面资源可能已更新，请刷新后继续。"
				: getRouteErrorMessage(routeError),
			source: "react-router",
		});
	}, [chunkLoadError, routeError]);
	const details = clientErrorToDetails(clientError);

	useEffect(() => {
		if (chunkLoadError) {
			try {
				if (readStorage(CHUNK_RELOAD_KEY, null, "session") !== "1") {
					writeStorage(CHUNK_RELOAD_KEY, "1", "session");
					window.location.reload();
					return;
				}
				removeStorage(CHUNK_RELOAD_KEY, "session");
			} catch {
				// sessionStorage unavailable — fall through to manual reload
			}
		}
	}, [chunkLoadError]);

	useEffect(() => {
		notifyClientError(routeError, {
			kind: clientError.kind,
			title: clientError.title,
			message: clientError.message,
			source: "react-router",
			details: details,
			code: clientError.code,
			status: clientError.status,
		});
	}, [
		clientError.code,
		clientError.kind,
		clientError.message,
		clientError.status,
		clientError.title,
		details,
		routeError,
	]);

	return (
		<div
			className={cn(
				"flex h-full min-h-[360px] w-full items-center justify-center bg-background p-4",
				className,
			)}
		>
			<div className="w-full max-w-xl rounded-[10px] border bg-card p-4 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.45)]">
				<div className="flex items-start gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-destructive/8 text-destructive">
						<AlertTriangle className="size-5" />
					</div>
					<div className="min-w-0 flex-1">
						<h1 className="text-base font-semibold text-foreground">
							{clientError.title}
						</h1>
						<p className="mt-1 text-sm leading-6 text-muted-foreground">
							{clientError.message}
						</p>
					</div>
				</div>

				<div className="mt-5 flex flex-wrap gap-2">
					<Button
						type="button"
						size="sm"
						className="h-8 gap-1.5 rounded-md"
						onClick={() => window.location.reload()}
					>
						<RefreshCw className="size-3.5" />
						刷新页面
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-8 gap-1.5 rounded-md"
						onClick={() => navigate("/")}
					>
						<Home className="size-3.5" />
						回到对话
					</Button>
				</div>

				{details ? (
					<div className="mt-4">
						<button
							type="button"
							className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
							onClick={() => setDetailsOpen((value) => !value)}
						>
							<ChevronDown
								className={cn(
									"size-3 transition-transform",
									detailsOpen && "rotate-180",
								)}
							/>
							{detailsOpen ? "收起详情" : "查看详情"}
						</button>
						{detailsOpen ? (
							<pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-[8px] border bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
								{details}
							</pre>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
