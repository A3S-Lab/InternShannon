import { useTerminal, Terminal as WTermTerminal } from "@wterm/react";
import { Plus, Terminal, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { TERMINAL_THEME } from "@/components/terminal/theme";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TerminalSession {
  id: string;
  title: string;
  logs: string[];
}

interface IntegratedTerminalProps {
  className?: string;
  onClose?: () => void;
}

export function IntegratedTerminal({
  className,
  onClose,
}: IntegratedTerminalProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([
    { id: "1", title: "终端 1", logs: [] },
  ]);
  const [activeSessionId, setActiveSessionId] = useState("1");
  const { ref, write, focus } = useTerminal();
  const [ready, setReady] = useState(false);
  const writtenCountRef = useRef(0);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const handleAddSession = useCallback(() => {
    const newId = String(Date.now());
    setSessions((prev) => [
      ...prev,
      { id: newId, title: `终端 ${prev.length + 1}`, logs: [] },
    ]);
    setActiveSessionId(newId);
    writtenCountRef.current = 0;
  }, []);

  const handleCloseSession = useCallback(
    (id: string) => {
      if (sessions.length === 1) return;
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== id);
        if (activeSessionId === id && filtered.length > 0) {
          setActiveSessionId(filtered[0].id);
        }
        return filtered;
      });
      writtenCountRef.current = 0;
    },
    [activeSessionId, sessions.length]
  );

  useEffect(() => {
    if (!ready || !activeSession) return;
    if (activeSession.logs.length < writtenCountRef.current) {
      write("\x1b[2J\x1b[H");
      writtenCountRef.current = 0;
    }
    if (writtenCountRef.current === 0) {
      write("\x1b[2J\x1b[H");
    }
    const nextLogs = activeSession.logs.slice(writtenCountRef.current);
    nextLogs.forEach((line) => write(`${line}\r\n`));
    writtenCountRef.current = activeSession.logs.length;
  }, [activeSession, ready, write]);

  useEffect(() => {
    if (ready) focus();
  }, [focus, ready, activeSessionId]);

  return (
    <section
      className={cn(
        "dark flex h-full min-h-0 flex-col bg-background text-foreground",
        className
      )}
      aria-label="集成终端"
    >
      <div className="flex min-h-8 items-center gap-1 border-b border-border/50 bg-muted/30 px-2">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label="终端会话"
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group flex h-8 min-w-[84px] max-w-[180px] items-center rounded-t border-b-2 text-xs transition-colors",
                activeSessionId === session.id
                  ? "border-primary bg-background/50 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeSessionId === session.id}
                aria-label={`${session.title}${
                  activeSessionId === session.id ? "，当前终端" : ""
                }`}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-t px-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                onClick={() => {
                  setActiveSessionId(session.id);
                  writtenCountRef.current = 0;
                }}
              >
                <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
              </button>
              {sessions.length > 1 && (
                <button
                  type="button"
                  aria-label={`关闭 ${session.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseSession(session.id);
                  }}
                  className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] opacity-0 transition-colors transition-opacity hover:bg-muted hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 group-hover:opacity-100"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleAddSession}
                  aria-label="新建终端"
                  className="flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>新建终端</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (activeSession) {
                      setSessions((prev) =>
                        prev.map((s) =>
                          s.id === activeSession.id ? { ...s, logs: [] } : s
                        )
                      );
                      writtenCountRef.current = 0;
                    }
                  }}
                  aria-label="清空当前终端"
                  disabled={!activeSession}
                  className="flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>清空终端</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {onClose && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="关闭终端面板"
                    className="flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>关闭终端</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-hidden"
        role="tabpanel"
        aria-label={activeSession?.title ?? "终端"}
        aria-busy={!ready}
      >
        <WTermTerminal
          ref={ref as never}
          theme={TERMINAL_THEME}
          autoResize
          cursorBlink
          className="h-full w-full"
          onData={() => undefined}
          onReady={() => setReady(true)}
        />
      </div>
    </section>
  );
}
