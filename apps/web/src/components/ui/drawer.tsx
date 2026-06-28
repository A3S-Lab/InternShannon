import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

import { cn } from "./lib/cn";

type DrawerProps = React.ComponentProps<typeof DialogPrimitive.Root> & {
	shouldScaleBackground?: boolean;
};

const Drawer = ({ shouldScaleBackground: _shouldScaleBackground, ...props }: DrawerProps) => (
	<DialogPrimitive.Root {...props} />
);
Drawer.displayName = "Drawer";

const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerPortal = DialogPrimitive.Portal;
const DrawerClose = DialogPrimitive.Close;

function hasDrawerTitleChild(children: React.ReactNode): boolean {
	return React.Children.toArray(children).some((child) => {
		if (!React.isValidElement(child)) return false;
		if (child.type === DialogPrimitive.Title) return true;
		return hasDrawerTitleChild(
			(child.props as { children?: React.ReactNode }).children,
		);
	});
}

const DrawerOverlay = React.forwardRef<
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
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DrawerContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
	<DrawerPortal>
		<DrawerOverlay />
		<DialogPrimitive.Content
			ref={ref}
			className={cn(
				"fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[85vh] flex-col rounded-t-[8px] border border-[var(--col-border,#e5e7eb)] bg-[var(--col-bg13,#ffffff)] text-[var(--col-text01,#18181b)] shadow-[0_-12px_32px_rgba(15,23,42,0.12)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
				className,
			)}
			{...props}
		>
			{hasDrawerTitleChild(children) ? null : (
				<DialogPrimitive.Title className="sr-only">抽屉面板</DialogPrimitive.Title>
			)}
			<div className="mx-auto mt-3 h-1.5 w-16 rounded-full bg-[var(--col-border,#e5e7eb)]" />
			{children}
		</DialogPrimitive.Content>
	</DrawerPortal>
));
DrawerContent.displayName = "DrawerContent";

const DrawerHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)} {...props} />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn(
			"text-base font-semibold leading-none text-[var(--col-text01,#18181b)]",
			className,
		)}
		{...props}
	/>
));
DrawerTitle.displayName = DialogPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn("text-sm text-[var(--col-text04,#71717a)]", className)}
		{...props}
	/>
));
DrawerDescription.displayName = DialogPrimitive.Description.displayName;

export {
	Drawer,
	DrawerPortal,
	DrawerOverlay,
	DrawerTrigger,
	DrawerClose,
	DrawerContent,
	DrawerHeader,
	DrawerFooter,
	DrawerTitle,
	DrawerDescription,
};
