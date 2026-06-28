import type { RichMessage } from "../types/message";
import MessageItem, { type MessageItemProps } from "./message-item";

type MessageListProps = Omit<MessageItemProps, "msg"> & {
	messages: RichMessage[];
};

export function MessageList({ messages, ...itemProps }: MessageListProps) {
	if (messages.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center px-4">
				<div className="text-muted-foreground mb-2">
					<svg
						className="w-16 h-16 mx-auto mb-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={1.5}
							d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
						/>
					</svg>
				</div>
				<h3 className="text-lg font-semibold mb-2">开始对话</h3>
				<p className="text-sm text-muted-foreground max-w-md">
					通过自然语言对话生产各类资产
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4 p-4">
			{messages.map((message) => (
				<MessageItem key={message.id} msg={message} {...itemProps} />
			))}
		</div>
	);
}
