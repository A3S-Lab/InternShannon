import Editor from "@monaco-editor/react";
import { cn } from "@/lib/utils";

interface YamlMonacoEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  minHeight?: number;
  height?: string;
  className?: string;
}

export function YamlMonacoEditor({
  value,
  onChange,
  readOnly = false,
  minHeight = 220,
  height,
  className,
}: YamlMonacoEditorProps) {
  const editorHeight = height ?? `${minHeight}px`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border-light bg-background",
        className
      )}
      style={{ height: editorHeight, minHeight }}
    >
      <Editor
        height={editorHeight}
        language="yaml"
        theme="vs"
        value={value}
        onChange={(nextValue) => onChange?.(nextValue ?? "")}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          tabSize: 2,
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "line",
        }}
      />
    </div>
  );
}
