import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/components/ui/lib/cn";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** "destructive" 渲染红色 Confirm 按钮（删除/卸载这类破坏性操作专用）。 */
  tone?: "default" | "destructive";
}

type ConfirmState = ConfirmOptions & { open: boolean };

/**
 * 替代 `window.confirm` 的 shadcn AlertDialog 包装。Promise 解析的
 * boolean 表示用户是否确认。
 *
 * ```tsx
 * const { confirm, ConfirmDialog } = useConfirm();
 * const onDelete = async () => {
 *   const ok = await confirm({ title: '卸载应用', description: '不可撤销', tone: 'destructive' });
 *   if (ok) doDelete();
 * };
 * return (<><Button onClick={onDelete}>...</Button><ConfirmDialog /></>);
 * ```
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({ open: false, title: "" });
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      resolverRef.current?.(false); // any prior dialog gets dismissed
      resolverRef.current = resolve;
      setState({ ...options, open: true });
    });
  }, []);

  const resolve = useCallback((value: boolean) => {
    setState(prev => ({ ...prev, open: false }));
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  const ConfirmDialog = useCallback(() => {
    const destructive = state.tone === "destructive";
    return (
      <AlertDialog open={state.open} onOpenChange={open => !open && resolve(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state.title}</AlertDialogTitle>
            {state.description && (
              <AlertDialogDescription>{state.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolve(false)}>
              {state.cancelText ?? "取消"}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
              onClick={() => resolve(true)}
            >
              {state.confirmText ?? "确定"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }, [state, resolve]);

  return { confirm, ConfirmDialog };
}
