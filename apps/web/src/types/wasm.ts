export interface AnsiWasmModule {
  default: () => Promise<void> | void;
  ansi_to_html(text: string): string;
}

export interface HashWasmModule {
  default: () => Promise<void> | void;
  sha1_hash(input: string): string;
  Sha1: new () => {
    update_str(input: string): void;
    digest(): string;
  };
}

export interface DiffWasmRecord {
  diff_type: number;
  content: string;
  orig_line_num: number;
  mod_line_num: number;
  free(): void;
}

export interface DiffWasmCollection {
  length(): number;
  get(index: number): DiffWasmRecord;
  free(): void;
}

export interface DiffWasmModule {
  default: () => Promise<void> | void;
  DiffEngine: new (
    originalLinesJson: string,
    modifiedLinesJson: string,
  ) => {
    compute_diff(): DiffWasmCollection;
  };
}

export interface MarkdownWasmModule {
  default: () => Promise<void> | void;
  MarkdownNormalizer: new () => {
    normalize(input: string): string;
  };
}

export interface UnifiedDiffWasmLine {
  line_type: number;
  text: string;
  free(): void;
}

export interface UnifiedDiffWasmLineCollection {
  length(): number;
  get(index: number): UnifiedDiffWasmLine;
  free(): void;
}

export interface UnifiedDiffWasmResult {
  lines(): UnifiedDiffWasmLineCollection;
  added: number;
  removed: number;
  original: string;
  modified: string;
  free(): void;
}

export interface UnifiedDiffWasmModule {
  default: () => Promise<void> | void;
  parse_unified_diff(output: string): UnifiedDiffWasmResult | null;
}
