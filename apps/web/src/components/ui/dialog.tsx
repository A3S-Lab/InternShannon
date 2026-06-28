import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { hasElementWithDisplayName } from "./dialog-title-detection";
import { cn } from "./lib/cn";

const Dialog: typeof DialogPrimitive.Root = DialogPrimitive.Root;
const DialogTrigger: typeof DialogPrimitive.Trigger = DialogPrimitive.Trigger;
const DialogPortal: typeof DialogPrimitive.Portal = DialogPrimitive.Portal;
const DialogClose: typeof DialogPrimitive.Close = DialogPrimitive.Close;

function hasDialogTitleChild(children: React.ReactNode): boolean {
  return hasElementWithDisplayName(children, DialogPrimitive.Title.displayName ?? "DialogTitle");
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  wrapperClassName?: string;
  /** 隐藏右上角关闭按钮(如诊断进行期间禁止关闭)。默认显示。 */
  hideClose?: boolean;
};

const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, wrapperClassName, hideClose = false, children, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <div className={cn("fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4", wrapperClassName)}>
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "relative grid w-full max-w-lg gap-3 rounded-[8px] border border-border bg-background p-4 text-foreground shadow-[0_12px_16px_-4px_rgba(36,36,36,0.08)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:p-5",
            className,
          )}
          {...props}
        >
          {hasDialogTitleChild(children) ? null : (
            <DialogPrimitive.Title className="sr-only">对话框</DialogPrimitive.Title>
          )}
          {children}
          {hideClose ? null : (
            <DialogPrimitive.Close
              aria-label="关闭"
              className="absolute right-3 top-3 rounded-[6px] p-1 text-muted-foreground opacity-70 transition-colors hover:bg-muted hover:text-foreground hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:pointer-events-none"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">关闭</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-display text-base font-semibold leading-tight text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[13px] leading-5 text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
