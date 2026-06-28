import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { tv, VariantProps } from "tailwind-variants";

const pageLoadingVariants = tv({
	slots: {
		base: "flex flex-col justify-center items-center gap-4",
		spinner: "relative",
		text: "text-center font-medium",
	},
	variants: {
		size: {
			default: {
				spinner: "size-12",
				text: "text-sm",
			},
			sm: {
				spinner: "size-10",
				text: "text-xs",
			},
			lg: {
				spinner: "size-16",
				text: "text-base",
			},
		},
	},
	defaultVariants: {
		size: "default",
	},
});

export interface PageLoadingProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof pageLoadingVariants> {
	tip?: string;
}

const PageLoading = ({
	className,
	size,
	tip = "正在加载中...",
}: PageLoadingProps) => {
	const { base, spinner, text } = pageLoadingVariants({ className, size });
	return (
		<div className={base()}>
			<div className={cn(spinner(), "relative")}>
				<div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/20 to-primary/5 animate-pulse" />
				<Loader2 className="relative size-full animate-spin text-primary" strokeWidth={2.5} />
			</div>
			<div className={cn(text(), "text-muted-foreground animate-pulse")}>
				{tip}
			</div>
		</div>
	);
};

PageLoading.displayName = "PageLoading";

export { PageLoading, pageLoadingVariants };
