import { Check, Copy } from "lucide-react";
import { useCallback } from "react";
import { useReactive, useTimeout } from "ahooks";
import { COPY_FEEDBACK_MS } from "@/constants";
import { writeClipboardText } from "@/lib/clipboard";

export default function CopyButton({ text }: { text: string }) {
	const state = useReactive({
		copied: false,
	});
	const timeoutRef = useTimeout(() => (state.copied = false), COPY_FEEDBACK_MS);

	const handleCopy = useCallback(async () => {
		await writeClipboardText(text);
		state.copied = true;
		timeoutRef();
	}, [text]);

	return (
		<button
			type="button"
			className="absolute right-2 top-2 hidden group-hover:flex items-center justify-center size-7 rounded-md border bg-background/80 backdrop-blur text-muted-foreground hover:text-foreground transition-colors"
			onClick={handleCopy}
			aria-label="Copy code"
		>
			{state.copied ? (
				<Check className="size-3.5" />
			) : (
				<Copy className="size-3.5" />
			)}
		</button>
	);
}
