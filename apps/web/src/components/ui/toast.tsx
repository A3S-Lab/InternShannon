import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "./lib/cn";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport> &
		React.RefAttributes<React.ElementRef<typeof ToastPrimitives.Viewport>>
> = React.forwardRef<
	React.ElementRef<typeof ToastPrimitives.Viewport>,
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
	<ToastPrimitives.Viewport
		ref={ref}
		className={cn(
			"fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-3 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[380px]",
			className,
		)}
		{...props}
	/>
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
	"group pointer-events-auto relative flex w-full items-center justify-between space-x-3 overflow-hidden rounded-[7px] border border-[var(--col-border,#e5e7eb)] bg-[var(--col-bg13,#ffffff)] p-4 pr-7 shadow-[var(--shadow-standard,0_12px_32px_rgba(15,23,42,0.12))] transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
	{
		variants: {
			variant: {
				default:
					"border border-[var(--col-border,#e5e7eb)] bg-[var(--col-bg13,#ffffff)] text-[var(--col-text01,#18181b)]",
				destructive:
					"destructive group border-[var(--color-state-destructive-solid,#dc2626)] bg-[var(--color-state-destructive-solid,#dc2626)] text-white",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

type ToastProps = React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
	VariantProps<typeof toastVariants>;

const Toast: React.ForwardRefExoticComponent<
	ToastProps & React.RefAttributes<React.ElementRef<typeof ToastPrimitives.Root>>
> = React.forwardRef<
	React.ElementRef<typeof ToastPrimitives.Root>,
	ToastProps
>(({ className, variant, ...props }, ref) => {
	return (
		<ToastPrimitives.Root
			ref={ref}
			className={cn(toastVariants({ variant }), className)}
			{...props}
		/>
	);
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action> &
		React.RefAttributes<React.ElementRef<typeof ToastPrimitives.Action>>
> = React.forwardRef<
	React.ElementRef<typeof ToastPrimitives.Action>,
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
	<ToastPrimitives.Action
		ref={ref}
		className={cn(
			"inline-flex h-7 shrink-0 items-center justify-center rounded-[7px] border border-[var(--col-border,#e5e7eb)] bg-transparent px-2.5 text-xs font-medium transition-colors hover:bg-[var(--col-bg14,#f5f5f5)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-[var(--color-state-destructive-solid,#dc2626)]/40 group-[.destructive]:hover:border-[var(--color-state-destructive-solid,#dc2626)]/30 group-[.destructive]:hover:bg-[var(--color-state-destructive-solid,#dc2626)] group-[.destructive]:hover:text-white group-[.destructive]:focus:ring-[var(--color-state-destructive-solid,#dc2626)]",
			className,
		)}
		{...props}
	/>
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close> &
		React.RefAttributes<React.ElementRef<typeof ToastPrimitives.Close>>
> = React.forwardRef<
	React.ElementRef<typeof ToastPrimitives.Close>,
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
	<ToastPrimitives.Close
		ref={ref}
		className={cn(
			"absolute right-2 top-2 rounded-[6px] p-1 text-[var(--col-text04,#71717a)]/50 opacity-0 transition-opacity hover:text-[var(--col-text01,#18181b)] focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary/40 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
			className,
		)}
		toast-close=""
		{...props}
	>
		<X className="h-3.5 w-3.5" />
	</ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title> &
		React.RefAttributes<React.ElementRef<typeof ToastPrimitives.Title>>
> = React.forwardRef<
	React.ElementRef<typeof ToastPrimitives.Title>,
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
	<ToastPrimitives.Title
		ref={ref}
		className={cn(
			"text-[13px] font-semibold text-[var(--col-text01,#18181b)]",
			className,
		)}
		{...props}
	/>
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description> &
		React.RefAttributes<React.ElementRef<typeof ToastPrimitives.Description>>
> = React.forwardRef<
	React.ElementRef<typeof ToastPrimitives.Description>,
	React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
	<ToastPrimitives.Description
		ref={ref}
		className={cn("text-xs opacity-90", className)}
		{...props}
	/>
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
	type ToastProps,
	type ToastActionElement,
	ToastProvider,
	ToastViewport,
	Toast,
	ToastTitle,
	ToastDescription,
	ToastClose,
	ToastAction,
	toastVariants,
};
