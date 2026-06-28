import { memo, useMemo } from "react";
import { useReactive } from "ahooks";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import { Maximize2 } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

// =============================================================================
// MermaidRenderer — renders mermaid code blocks as beautiful SVG diagrams
// =============================================================================

interface MermaidRendererProps {
	code: string;
}

function isDarkMode(): boolean {
	return document.documentElement.classList.contains("dark");
}

function MermaidRenderer({ code }: MermaidRendererProps) {
	const state = useReactive({
		fullscreen: false,
	});

	const svg = useMemo(() => {
		const trimmed = code.trim();
		if (!trimmed) return null;
		try {
			const theme = isDarkMode()
				? THEMES["github-dark"]
				: THEMES["github-light"];
			return renderMermaidSVG(trimmed, { ...theme, transparent: true });
		} catch {
			return null;
		}
	}, [code]);

	if (!svg) {
		// Still streaming or empty — render nothing
		return null;
	}

	const MermaidContent = () => (
		<div
			className="overflow-x-auto"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVG from beautiful-mermaid
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);

	return (
		<>
			<div className="shiki-block">
				<div className="shiki-header">
					<span className="language-label">mermaid</span>
					<div className="flex items-center gap-1">
						<div
							className="flex items-center space-x-1 cursor-pointer py-[4px] px-[8px] hover:text-primary"
							onClick={() => (state.fullscreen = true)}
						>
							<Maximize2 className="size-[14px] text-secondary-foreground/50" />
							<span className="text-[12px] text-secondary-foreground/50">
								全屏
							</span>
						</div>
					</div>
				</div>
				<div className="p-4">
					<MermaidContent />
				</div>
			</div>

			<Dialog
				open={state.fullscreen}
				onOpenChange={(open) => (state.fullscreen = open)}
			>
				<DialogContent className="max-w-[90vw] max-h-[90vh] overflow-auto">
					<DialogHeader>
						<DialogTitle>Mermaid 图表</DialogTitle>
					</DialogHeader>
					<div className="flex justify-center p-4">
						<MermaidContent />
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

export default memo(MermaidRenderer);
