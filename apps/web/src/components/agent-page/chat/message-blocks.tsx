import type { ToolCallBlock } from "./types";
import { ToolCallDisplay } from "./tool-call-display";

export function ToolCallBlockViewCompact({
	block,
}: {
	block: ToolCallBlock;
}) {
	return (
		<div>
			<ToolCallDisplay
				compact
				data={{
					toolName: block.tool,
					input: block.input,
					output: block.output,
					isError: block.isError,
					before: block.before,
					after: block.after,
					filePath: block.filePath,
					durationMs: block.durationMs,
				}}
			/>
		</div>
	);
}
