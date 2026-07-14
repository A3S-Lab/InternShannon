interface UniverDisposable {
  dispose(): void;
}

export function disposeUniverAfterReactCommit(univer: UniverDisposable): void {
  globalThis.setTimeout(() => {
    try {
      univer.dispose();
    } catch (error) {
      console.warn("[office-editor] Failed to dispose Univer runtime", error);
    }
  }, 0);
}
