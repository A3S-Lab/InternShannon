import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "./lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-1 focus:ring-primary/35",
  {
    variants: {
      variant: {
        default: "bg-primary text-white",
        secondary: "bg-muted text-muted-foreground",
        destructive: "bg-destructive text-white",
        outline: "border border-border bg-background text-muted-foreground",
        success: "bg-emerald-500 text-white",
        warning: "bg-amber-500 text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
