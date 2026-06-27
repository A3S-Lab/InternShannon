// Univer 文档流控制字符（对齐 @univerjs/core 的 DataStreamTreeTokenType）。
// 用 String.fromCharCode 构造，避免在源码里嵌入裸控制字符（防止编辑器/格式化器损坏）。
export const TOKEN = {
    PARAGRAPH: "\r", // \r paragraph
    SECTION_BREAK: "\n", // \n section break
    TABLE_START: String.fromCharCode(0x1a),
    TABLE_ROW_START: String.fromCharCode(0x1b),
    TABLE_CELL_START: String.fromCharCode(0x1c),
    TABLE_CELL_END: String.fromCharCode(0x1d),
    TABLE_ROW_END: String.fromCharCode(0x0e),
    TABLE_END: String.fromCharCode(0x0f),
    CUSTOM_BLOCK: String.fromCharCode(0x08), // \b images/mentions placeholder
} as const;

export const TABLE_TOKENS = new Set<string>([
    TOKEN.TABLE_START,
    TOKEN.TABLE_ROW_START,
    TOKEN.TABLE_CELL_START,
    TOKEN.TABLE_CELL_END,
    TOKEN.TABLE_ROW_END,
    TOKEN.TABLE_END,
]);
