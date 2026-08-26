import "@wterm/react/css";
import "./terminal-theme.css";

export type TerminalThemeName = "a3s-dark" | "a3s-light";

/**
 * InternShannon 终端固定使用暗色主题，跟 VS Code/JetBrains 等编辑器的惯例一致 ——
 * 当前产品固定使用浅色主题，终端与应用、编辑器和预览保持一致。
 */
export const TERMINAL_THEME: TerminalThemeName = "a3s-light";
