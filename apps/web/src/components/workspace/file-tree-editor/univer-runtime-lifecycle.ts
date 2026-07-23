interface UniverDisposable {
  dispose(): void;
}

// Univer Slides 0.24 schedules thumbnail work 300ms after transform/file-load
// events without cancelling those callbacks during disposal.
export const UNIVER_DISPOSE_GRACE_MS = 400;

export function disposeUniverAfterReactCommit(univer: UniverDisposable): void {
  globalThis.setTimeout(() => {
    try {
      univer.dispose();
    } catch (error) {
      console.warn("[office-editor] Failed to dispose Univer runtime", error);
    }
  }, UNIVER_DISPOSE_GRACE_MS);
}
