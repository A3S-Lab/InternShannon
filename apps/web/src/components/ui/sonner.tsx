import type * as React from "react";
import { Toaster as Sonner } from "sonner";

import { cn } from "./lib/cn";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const DEFAULT_TOAST_CLASS_NAMES: NonNullable<NonNullable<ToasterProps["toastOptions"]>["classNames"]> = {
  toast:
    "group toast group-[.toaster]:bg-[var(--col-bg13,#ffffff)] group-[.toaster]:text-[var(--col-text01,#18181b)] group-[.toaster]:border-[var(--col-border,#e5e7eb)] group-[.toaster]:shadow-[var(--shadow-standard,0_12px_32px_rgba(15,23,42,0.12))]",
  description: "group-[.toast]:text-[var(--col-text04,#71717a)]",
  actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
  cancelButton: "group-[.toast]:bg-[var(--col-bg14,#f5f5f5)] group-[.toast]:text-[var(--col-text04,#71717a)]",
  closeButton:
    "group-[.toaster]:border-[var(--col-border,#e5e7eb)] group-[.toaster]:bg-[var(--col-bg13,#ffffff)] group-[.toaster]:text-[var(--col-text04,#71717a)] hover:group-[.toaster]:text-[var(--col-text01,#18181b)]",
};

const Toaster = ({ className, closeButton = true, toastOptions, theme = "system", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      closeButton={closeButton}
      className={cn("toaster group", className)}
      toastOptions={{
        closeButtonAriaLabel: "关闭通知",
        ...toastOptions,
        classNames: {
          ...DEFAULT_TOAST_CLASS_NAMES,
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
};

export { Toaster, type ToasterProps };
