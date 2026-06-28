import * as MenubarPrimitive from "@radix-ui/react-menubar";
import { Check, ChevronRight, Circle } from "lucide-react";
import * as React from "react";

import { cn } from "./lib/cn";

function MenubarMenu({
	...props
}: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
	return <MenubarPrimitive.Menu {...props} />;
}

function MenubarGroup({
	...props
}: React.ComponentProps<typeof MenubarPrimitive.Group>) {
	return <MenubarPrimitive.Group {...props} />;
}

function MenubarPortal({
	...props
}: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
	return <MenubarPrimitive.Portal {...props} />;
}

function MenubarRadioGroup({
	...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
	return <MenubarPrimitive.RadioGroup {...props} />;
}

function MenubarSub({
	...props
}: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
	return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

const Menubar: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root> &
		React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.Root>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
	<MenubarPrimitive.Root
		ref={ref}
		className={cn(
			"flex h-8 items-center space-x-0.5 rounded-[7px] border border-[var(--col-border,#e5e7eb)] bg-[var(--col-bg13,#ffffff)] p-0.5",
			className,
		)}
		{...props}
	/>
));
Menubar.displayName = MenubarPrimitive.Root.displayName;

const MenubarTrigger: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger> &
		React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.Trigger>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<MenubarPrimitive.Trigger
		ref={ref}
		className={cn(
			"flex cursor-default select-none items-center rounded-[6px] px-2.5 py-1 text-[13px] font-medium text-[var(--col-text01,#18181b)] outline-none focus:bg-[var(--col-bg14,#f5f5f5)] data-[state=open]:bg-[var(--col-bg14,#f5f5f5)]",
			className,
		)}
		{...props}
	/>
));
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName;

const MenubarSubTrigger: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger> & {
		inset?: boolean;
	} & React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.SubTrigger>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.SubTrigger>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger> & {
		inset?: boolean;
	}
>(({ className, inset, children, ...props }, ref) => (
	<MenubarPrimitive.SubTrigger
		ref={ref}
		className={cn(
			"flex cursor-default select-none items-center rounded-[6px] px-2 py-1 text-[13px] text-[var(--col-text01,#18181b)] outline-none focus:bg-[var(--col-bg14,#f5f5f5)] data-[state=open]:bg-[var(--col-bg14,#f5f5f5)]",
			inset && "pl-8",
			className,
		)}
		{...props}
	>
		{children}
		<ChevronRight className="ml-auto h-3.5 w-3.5" />
	</MenubarPrimitive.SubTrigger>
));
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName;

const MenubarSubContent: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent> &
		React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.SubContent>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.SubContent>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>
>(({ className, ...props }, ref) => (
	<MenubarPrimitive.SubContent
		ref={ref}
			className={cn(
				"z-50 min-w-[8rem] overflow-hidden rounded-[7px] border border-[var(--col-border,#e5e7eb)] bg-[var(--col-bg13,#ffffff)] p-1 text-[var(--col-text01,#18181b)] shadow-[var(--shadow-standard,0_12px_32px_rgba(15,23,42,0.12))] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-menubar-content-transform-origin]",
				className,
		)}
		{...props}
	/>
));
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName;

const MenubarContent: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content> &
		React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.Content>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(
	(
		{ className, align = "start", alignOffset = -4, sideOffset = 8, ...props },
		ref,
	) => (
		<MenubarPrimitive.Portal>
			<MenubarPrimitive.Content
				ref={ref}
				align={align}
				alignOffset={alignOffset}
				sideOffset={sideOffset}
				className={cn(
					"z-50 min-w-[12rem] overflow-hidden rounded-[7px] border border-[var(--col-border,#e5e7eb)] bg-[var(--col-bg13,#ffffff)] p-1 text-[var(--col-text01,#18181b)] shadow-[var(--shadow-standard,0_12px_32px_rgba(15,23,42,0.12))] data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-menubar-content-transform-origin]",
					className,
				)}
				{...props}
			/>
		</MenubarPrimitive.Portal>
	),
);
MenubarContent.displayName = MenubarPrimitive.Content.displayName;

const MenubarItem: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & {
		inset?: boolean;
	} & React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.Item>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & {
		inset?: boolean;
	}
>(({ className, inset, ...props }, ref) => (
	<MenubarPrimitive.Item
		ref={ref}
		className={cn(
			"relative flex cursor-default select-none items-center rounded-[6px] px-2 py-1 text-[13px] text-[var(--col-text01,#18181b)] outline-none focus:bg-[var(--col-bg14,#f5f5f5)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			inset && "pl-8",
			className,
		)}
		{...props}
	/>
));
MenubarItem.displayName = MenubarPrimitive.Item.displayName;

const MenubarCheckboxItem: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem> &
		React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.CheckboxItem>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.CheckboxItem>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
	<MenubarPrimitive.CheckboxItem
		ref={ref}
		className={cn(
			"relative flex cursor-default select-none items-center rounded-[6px] py-1 pl-7 pr-2 text-[13px] text-[var(--col-text01,#18181b)] outline-none focus:bg-[var(--col-bg14,#f5f5f5)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
		checked={checked}
		{...props}
	>
		<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
			<MenubarPrimitive.ItemIndicator>
				<Check className="h-3.5 w-3.5" />
			</MenubarPrimitive.ItemIndicator>
		</span>
		{children}
	</MenubarPrimitive.CheckboxItem>
));
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName;

const MenubarRadioItem: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem> &
		React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.RadioItem>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.RadioItem>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
	<MenubarPrimitive.RadioItem
		ref={ref}
		className={cn(
			"relative flex cursor-default select-none items-center rounded-[6px] py-1 pl-7 pr-2 text-[13px] text-[var(--col-text01,#18181b)] outline-none focus:bg-[var(--col-bg14,#f5f5f5)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
		{...props}
	>
		<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
			<MenubarPrimitive.ItemIndicator>
				<Circle className="h-2 w-2 fill-current" />
			</MenubarPrimitive.ItemIndicator>
		</span>
		{children}
	</MenubarPrimitive.RadioItem>
));
MenubarRadioItem.displayName = MenubarPrimitive.RadioItem.displayName;

const MenubarLabel: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label> & {
		inset?: boolean;
	} & React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.Label>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.Label>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label> & {
		inset?: boolean;
	}
>(({ className, inset, ...props }, ref) => (
	<MenubarPrimitive.Label
		ref={ref}
		className={cn(
			"px-2 py-1 text-xs font-semibold",
			inset && "pl-8",
			className,
		)}
		{...props}
	/>
));
MenubarLabel.displayName = MenubarPrimitive.Label.displayName;

const MenubarSeparator: React.ForwardRefExoticComponent<
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator> &
		React.RefAttributes<React.ElementRef<typeof MenubarPrimitive.Separator>>
> = React.forwardRef<
	React.ElementRef<typeof MenubarPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
	<MenubarPrimitive.Separator
		ref={ref}
		className={cn("-mx-1 my-1 h-px bg-[var(--col-border,#e5e7eb)]", className)}
		{...props}
	/>
));
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName;

const MenubarShortcut = ({
	className,
	...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
	return (
		<span
			className={cn(
				"ml-auto text-xs tracking-widest text-[var(--col-text05,#71717a)]",
				className,
			)}
			{...props}
		/>
	);
};
MenubarShortcut.displayName = "MenubarShortcut";

export {
	Menubar,
	MenubarMenu,
	MenubarTrigger,
	MenubarContent,
	MenubarItem,
	MenubarSeparator,
	MenubarLabel,
	MenubarCheckboxItem,
	MenubarRadioGroup,
	MenubarRadioItem,
	MenubarPortal,
	MenubarSubContent,
	MenubarSubTrigger,
	MenubarGroup,
	MenubarSub,
	MenubarShortcut,
};
