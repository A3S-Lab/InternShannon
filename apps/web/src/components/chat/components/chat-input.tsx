import React, { useCallback, useState, useRef } from 'react';

interface ChatInputProps {
  onSend: (content: string) => void;
  onInterrupt?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  onInterrupt,
  disabled = false,
  isRunning = false,
  placeholder = '输入消息...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setValue('');
		if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [value, disabled, onSend]);

	const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
		setValue(event.target.value);
		event.target.style.height = 'auto';
		event.target.style.height = `${event.target.scrollHeight}px`;
	}, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="p-4">
      <div className="flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ minHeight: '44px' }}
          />
        </div>

        {isRunning ? (
          <button
            type="button"
            onClick={onInterrupt}
            className="flex items-center justify-center size-11 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex-shrink-0"
            title="���止生��"
          >
            <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <title>停止生成</title>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !value.trim()}
            className="flex items-center justify-center size-11 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            title="发送���息 (Enter)"
          >
            <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <title>发送消息</title>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        )}
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        按 Enter ��送，Shift + Enter 换行
      </div>
    </div>
  );
}
