import type * as React from "react";
import {
	Toaster as Sonner,
	toast as sonnerToast,
	type ExternalToast,
} from "sonner";
import "sonner/dist/styles.css";

import { cn } from "./lib/cn";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const GLOBAL_TOASTER_ID = "internshannon-global";

function scopedOptions(options?: ExternalToast): ExternalToast {
	return { ...options, toasterId: GLOBAL_TOASTER_ID };
}

const scopedToast = ((message, options) =>
	sonnerToast(message, scopedOptions(options))) as typeof sonnerToast;
scopedToast.success = (message, options) =>
	sonnerToast.success(message, scopedOptions(options));
scopedToast.info = (message, options) =>
	sonnerToast.info(message, scopedOptions(options));
scopedToast.warning = (message, options) =>
	sonnerToast.warning(message, scopedOptions(options));
scopedToast.error = (message, options) =>
	sonnerToast.error(message, scopedOptions(options));
scopedToast.message = (message, options) =>
	sonnerToast.message(message, scopedOptions(options));
scopedToast.loading = (message, options) =>
	sonnerToast.loading(message, scopedOptions(options));
scopedToast.custom = (render, options) =>
	sonnerToast.custom(render, scopedOptions(options));
scopedToast.promise = ((promise, options) =>
	sonnerToast.promise(promise, {
		...options,
		toasterId: GLOBAL_TOASTER_ID,
	})) as typeof sonnerToast.promise;
scopedToast.dismiss = sonnerToast.dismiss;
scopedToast.getHistory = sonnerToast.getHistory;
scopedToast.getToasts = sonnerToast.getToasts;

const DEFAULT_TOAST_CLASS_NAMES: NonNullable<
	NonNullable<ToasterProps["toastOptions"]>["classNames"]
> = {
	toast:
		"group toast group-[.toaster]:bg-[var(--col-bg13,#ffffff)] group-[.toaster]:text-[var(--col-text01,#18181b)] group-[.toaster]:border-[var(--col-border,#e5e7eb)] group-[.toaster]:shadow-[var(--shadow-standard,0_12px_32px_rgba(15,23,42,0.12))]",
	description: "group-[.toast]:text-[var(--col-text04,#71717a)]",
	actionButton:
		"group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
	cancelButton:
		"group-[.toast]:bg-[var(--col-bg14,#f5f5f5)] group-[.toast]:text-[var(--col-text04,#71717a)]",
	closeButton:
		"group-[.toaster]:border-[var(--col-border,#e5e7eb)] group-[.toaster]:bg-[var(--col-bg13,#ffffff)] group-[.toaster]:text-[var(--col-text04,#71717a)] hover:group-[.toaster]:text-[var(--col-text01,#18181b)]",
};

const Toaster = ({
	className,
	closeButton = true,
	style,
	toastOptions,
	theme = "system",
	...props
}: ToasterProps) => {
	return (
		<Sonner
			id={GLOBAL_TOASTER_ID}
			theme={theme}
			closeButton={closeButton}
			className={cn("toaster group", className)}
			style={{
				position: "fixed",
				top: "max(16px, env(safe-area-inset-top))",
				right: 16,
				bottom: "auto",
				left: "auto",
				width: 356,
				zIndex: 999999999,
				...style,
			}}
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

export { scopedToast as toast, Toaster, type ToasterProps };
