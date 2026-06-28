import { Loader2 } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface PendingButtonProps extends ButtonProps {
  /** true 时把前导图标换成 spinner 并自动禁用按钮。 */
  loading?: boolean;
  /** 非 loading 时显示的前导图标（loading 时被 spinner 取代）。 */
  icon?: ReactNode;
}

/**
 * 提交 / 保存按钮：loading 时前导图标变 spinner 且自动 disabled。统一各 settings 面板与对话框里
 * 手搓的 `disabled={pending} {pending ? <Loader2 animate-spin/> : <Save/>}文案` 模式。
 * 透传所有 Button 属性（variant/size/onClick/…）。图标尺寸沿用 Button 的 `[&_svg]:size-3.5`。
 */
export const PendingButton = forwardRef<HTMLButtonElement, PendingButtonProps>(function PendingButton(
  { loading = false, icon, disabled, children, ...props },
  ref,
) {
  return (
    <Button ref={ref} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </Button>
  );
});
