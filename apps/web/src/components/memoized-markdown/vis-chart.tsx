import { render, type Spec } from "@antv/gpt-vis";
import { memo, useEffect, useId, useMemo, useRef } from "react";
import { useReactive } from "ahooks";

interface VisChartRendererProps {
	code: string;
}

const VisChartRenderer = memo(({ code }: VisChartRendererProps) => {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const state = useReactive({
		renderError: null as string | null,
	});
	const uniqueId = useId();

	const chartConfig = useMemo(() => {
		try {
			return JSON.parse(code.trim()) as Spec;
		} catch {
			return null;
		}
	}, [code]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !chartConfig) return;

		try {
			container.innerHTML = "";
			render(uniqueId, chartConfig);
			state.renderError = null;
		} catch (error) {
			state.renderError =
				error instanceof Error ? error.message : "图表渲染失败";
		}
	}, [chartConfig, uniqueId]);

	if (!chartConfig) {
		if (!code.trim().endsWith("}") && !code.trim().endsWith("]")) return null;
		return (
			<div className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
				<div className="font-semibold">Invalid vis-chart JSON</div>
				<pre className="mt-2 overflow-x-auto text-xs">{code}</pre>
			</div>
		);
	}

	return (
		<div className="vis-chart-container my-3 overflow-hidden rounded-[12px] border border-border/50 bg-background/80 p-3 shadow-sm shadow-black/5">
			<div id={uniqueId} ref={containerRef} className="min-h-[320px] w-full" />
			{state.renderError ? (
				<div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
					<div className="font-semibold">vis-chart 渲染失败</div>
					<div className="mt-1 text-xs">{state.renderError}</div>
				</div>
			) : null}
		</div>
	);
});

VisChartRenderer.displayName = "VisChartRenderer";

export default VisChartRenderer;
