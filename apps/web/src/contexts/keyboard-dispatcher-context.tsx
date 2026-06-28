/**
 * Keyboard dispatcher React context.
 * Provides dispatchKeyDown to all editors and the app shell.
 *
 * Editors call dispatchKeyDown(event) from their handleKeyDown callbacks.
 * Returns true if a command was dispatched (event should be prevented).
 */
import { createContext, useCallback, useContext, useRef } from "react";
import type { Context } from "@/lib/keybinding-registry";

export interface KeyboardDispatchOptions {
  editorId?: string;
}

export interface KeyboardDispatcherValue {
  dispatchKeyDown: (event: KeyboardEvent, options?: KeyboardDispatchOptions) => boolean;
  registerFocusChangeHandler: (handler: (focused: boolean) => void) => () => void;
  notifyFocusChange: (focused: boolean) => void;
  getContext: () => Context;
}

export const KeyboardDispatcherContext = createContext<KeyboardDispatcherValue | null>(null);

/**
 * Hook for components to access the keyboard dispatcher.
 * Returns the dispatch function — editors call this from their handleKeyDown.
 */
export function useKeyboardDispatcher(): KeyboardDispatcherValue {
  const ctx = useContext(KeyboardDispatcherContext);
  if (!ctx) {
    throw new Error("useKeyboardDispatcher must be used within KeyboardDispatcherProvider");
  }
  return ctx;
}

/**
 * Hook for the dispatcher provider itself — tracks focus state
 * so that context keys like "textInputFocus" stay accurate.
 */
export function useFocusTracker() {
  const focusRef = useRef(false);
  const handlersRef = useRef<Set<(focused: boolean) => void>>(new Set());

  const registerFocusChangeHandler = useCallback((handler: (focused: boolean) => void) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);

  const getContext = useCallback((): Context => {
    return {
      textInputFocus: focusRef.current,
      editorFocus: focusRef.current,
    };
  }, []);

  const notifyFocusChange = useCallback((focused: boolean) => {
    focusRef.current = focused;
    handlersRef.current.forEach((h) => h(focused));
  }, []);

  return { registerFocusChangeHandler, getContext, notifyFocusChange };
}
