export type TiptapSubmitResult = boolean | undefined | PromiseLike<boolean | undefined>;

export interface TiptapSubmitEligibilityInput {
  text: string;
  allowEmptySubmit?: boolean;
}

export interface TiptapSubmitKeyInput {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export function shouldHandleTiptapSubmitKey(input: TiptapSubmitKeyInput): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.metaKey && !input.ctrlKey;
}

export function shouldSubmitTiptapContent(input: TiptapSubmitEligibilityInput): boolean {
  return input.text.trim().length > 0 || input.allowEmptySubmit === true;
}

export function shouldClearAfterTiptapSubmitResult(result: boolean | undefined): boolean {
  return result !== false;
}

export function isTiptapSubmitPromise(result: TiptapSubmitResult): result is PromiseLike<boolean | undefined> {
  return typeof result === "object" && result !== null && "then" in result && typeof result.then === "function";
}
