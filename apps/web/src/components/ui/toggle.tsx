import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "./lib/cn";

const toggleVariants = cva(
	"inline-flex items-center justify-center gap-1.5 rounded-[7px] text-sm font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary data-[state=on]:text-white [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-transparent",
				outline:
					"border border-border bg-transparent hover:bg-muted hover:text-foreground",
			},
			size: {
				default: "h-8 min-w-8 px-2.5",
				sm: "h-7 min-w-7 px-2",
				lg: "h-10 min-w-10 px-4",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

type ToggleProps = React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
	VariantProps<typeof toggleVariants>;

const Toggle: React.ForwardRefExoticComponent<
	ToggleProps & React.RefAttributes<React.ElementRef<typeof TogglePrimitive.Root>>
> = React.forwardRef<
	React.ElementRef<typeof TogglePrimitive.Root>,
	ToggleProps
>(({ className, variant, size, ...props }, ref) => (
	<TogglePrimitive.Root
		ref={ref}
		className={cn(toggleVariants({ variant, size, className }))}
		{...props}
	/>
));
Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
