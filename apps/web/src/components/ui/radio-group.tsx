import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Circle } from "lucide-react";
import * as React from "react";

import { cn } from "./lib/cn";

type RadioGroupProps = React.ComponentPropsWithoutRef<
	typeof RadioGroupPrimitive.Root
>;
type RadioGroupItemProps = React.ComponentPropsWithoutRef<
	typeof RadioGroupPrimitive.Item
>;

const RadioGroup: React.ForwardRefExoticComponent<
	RadioGroupProps &
		React.RefAttributes<React.ElementRef<typeof RadioGroupPrimitive.Root>>
> = React.forwardRef<
	React.ElementRef<typeof RadioGroupPrimitive.Root>,
	RadioGroupProps
>(({ className, ...props }, ref) => (
	<RadioGroupPrimitive.Root
		ref={ref}
		className={cn("grid gap-2", className)}
		{...props}
	/>
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem: React.ForwardRefExoticComponent<
	RadioGroupItemProps &
		React.RefAttributes<React.ElementRef<typeof RadioGroupPrimitive.Item>>
> = React.forwardRef<
	React.ElementRef<typeof RadioGroupPrimitive.Item>,
	RadioGroupItemProps
>(({ className, ...props }, ref) => (
	<RadioGroupPrimitive.Item
		ref={ref}
		className={cn(
			"aspect-square h-4 w-4 rounded-full border border-primary text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
			className,
		)}
		{...props}
	>
		<RadioGroupPrimitive.Indicator className="flex items-center justify-center">
			<Circle className="h-2.5 w-2.5 fill-current text-current" />
		</RadioGroupPrimitive.Indicator>
	</RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
