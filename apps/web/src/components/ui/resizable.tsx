import type * as React from "react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "./lib/cn";
import { resolveResizableHandleLabel } from "./resizable-handle-state";

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  className,
  withHandle,
  "aria-label": ariaLabel,
  title,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => {
  const label = resolveResizableHandleLabel(ariaLabel);

  return (
    <ResizablePrimitive.PanelResizeHandle
      aria-label={label}
      title={title ?? label}
      className={cn(
        "relative shrink-0 bg-transparent focus-visible:outline-none",
        "w-px cursor-col-resize data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:cursor-row-resize",
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border/25 before:transition-colors dark:before:bg-border/20",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[5px] after:-translate-x-1/2 after:content-[''] data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:top-1/2 data-[panel-group-direction=vertical]:after:h-[5px] data-[panel-group-direction=vertical]:after:w-auto data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0",
        "hover:before:bg-primary/45 data-[resize-handle-state=drag]:before:bg-primary/65",
        "focus-visible:before:bg-primary/50",
        withHandle && "group",
        className,
      )}
      {...props}
    />
  );
};

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
