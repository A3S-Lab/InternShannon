import "@wterm/react/css";
import "./terminal-theme.css";

export type TerminalThemeName = "a3s-dark" | "a3s-light";

/**
 * InternShannon OS 终端固定使用暗色主题，跟 VS Code/JetBrains 等编辑器的惯例一致 ——
 * 终端属于"命令行"心智模型，即便 app 切到 light 也保持深色背景，避免亮底白字阅读疲劳。
 *
 * 如果未来需要让终端跟随 app 主题，把这里换成 hook 即可（CSS 里 a3s-light 仍然保留）。
 */
export const TERMINAL_THEME: TerminalThemeName = "a3s-dark";
