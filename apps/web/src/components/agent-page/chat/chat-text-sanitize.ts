const INTERNAL_REASONING_MARKERS = [
  "根据我的指令",
  "系统指令",
  "用户用中文说",
  "用户问我",
  "我应该",
  "我需要",
  "让我回顾",
  "让我检查",
  "当前会话可见",
  "Runtime Tools",
  "Runtime Skills",
  "Configured Skills",
  "Built-in agents",
  "## Tools",
  "<context source=",
];

const USER_FACING_START_MARKERS = [
  "你好！",
  "您好！",
  "可以。",
  "当然。",
  "有问题",
  "我可以",
  "我有",
  "以下是",
  "这些回复",
];

function stripThinkTagLeaks(content: string): string {
  let text = content
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/i, "");

  const orphanCloseIndex = text.search(/<\/think>/i);
  if (orphanCloseIndex >= 0) {
    text = text.slice(orphanCloseIndex).replace(/^<\/think>\s*/i, "");
  }

  return text.replace(/<\/?think\b[^>]*>/gi, "");
}

export function stripLeakedInternalReasoning(content: string): string {
  const text = stripThinkTagLeaks(content ?? "");
  if (!INTERNAL_REASONING_MARKERS.some((marker) => text.includes(marker))) {
    return text;
  }

  const firstAnswerIndex = USER_FACING_START_MARKERS.map((marker) => text.indexOf(marker))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  if (typeof firstAnswerIndex === "number") {
    return text.slice(firstAnswerIndex).trimStart();
  }

  return text
    .split(/\n{2,}/)
    .filter((paragraph) => !INTERNAL_REASONING_MARKERS.some((marker) => paragraph.includes(marker)))
    .join("\n\n")
    .trimStart();
}
