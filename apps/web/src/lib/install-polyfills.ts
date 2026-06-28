/**
 * crypto.randomUUID 只在 secure context(HTTPS / localhost)可用。生产经 HTTP
 * (http://<ip>:port)访问时它缺失,调用处(工作流会话 id、插件 id 等)会抛
 * "crypto.randomUUID is not a function",react-error-boundary 捕获后整页渲染崩溃。
 * 用 getRandomValues(非安全上下文同样可用)补一个 RFC4122 v4 实现。
 * 纯副作用模块,必须在任何业务模块前 import(入口 AdminApp / DesktopApp 第一行)。
 */
const c = globalThis.crypto as unknown as {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

if (c && typeof c.randomUUID !== "function" && typeof c.getRandomValues === "function") {
  c.randomUUID = (): string => {
    const bytes = c.getRandomValues!(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
