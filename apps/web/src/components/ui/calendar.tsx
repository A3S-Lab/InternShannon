import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import { Button } from "./button";
import { cn } from "./lib/cn";

export interface CalendarProps
	extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
	selected?: Date;
	onSelect?: (date: Date) => void;
	disabled?: (date: Date) => boolean;
}

const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

function startOfDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(left?: Date, right?: Date) {
	return Boolean(
		left &&
			right &&
			left.getFullYear() === right.getFullYear() &&
			left.getMonth() === right.getMonth() &&
			left.getDate() === right.getDate(),
	);
}

function getMonthDays(month: Date) {
	const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
	const daysInMonth = new Date(
		month.getFullYear(),
		month.getMonth() + 1,
		0,
	).getDate();
	const days: Array<Date | null> = Array.from(
		{ length: firstDay.getDay() },
		() => null,
	);

	for (let day = 1; day <= daysInMonth; day += 1) {
		days.push(new Date(month.getFullYear(), month.getMonth(), day));
	}

	while (days.length % 7 !== 0) {
		days.push(null);
	}

	return days;
}

const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>(
	({ className, selected, onSelect, disabled, ...props }, ref) => {
		const [month, setMonth] = React.useState(() => selected ?? new Date());
		const days = React.useMemo(() => getMonthDays(month), [month]);
		const today = React.useMemo(() => startOfDay(new Date()), []);

		React.useEffect(() => {
			if (selected) {
				setMonth(selected);
			}
		}, [selected]);

		return (
			<div
				ref={ref}
				className={cn(
					"w-72 rounded-[8px] bg-[var(--col-bg13,#ffffff)] p-3",
					className,
				)}
				{...props}
			>
				<div className="mb-3 flex items-center justify-between">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="上个月"
						onClick={() =>
							setMonth(
								(current) =>
									new Date(current.getFullYear(), current.getMonth() - 1, 1),
							)
						}
					>
						<ChevronLeft className="size-4" />
					</Button>
					<div className="text-sm font-semibold text-foreground">
						{month.getFullYear()} 年 {month.getMonth() + 1} 月
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="下个月"
						onClick={() =>
							setMonth(
								(current) =>
									new Date(current.getFullYear(), current.getMonth() + 1, 1),
							)
						}
					>
						<ChevronRight className="size-4" />
					</Button>
				</div>
				<div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
					{weekDays.map((day) => (
						<div key={day} className="py-1">
							{day}
						</div>
					))}
				</div>
				<div className="mt-1 grid grid-cols-7 gap-1">
					{days.map((date, index) => {
						if (!date) {
							return <div key={`empty-${index}`} className="h-8" />;
						}

						const isSelected = isSameDay(date, selected);
						const isToday = isSameDay(date, today);
						const isDisabled = disabled?.(date) ?? false;

						return (
							<button
								key={date.toISOString()}
								type="button"
								disabled={isDisabled}
								className={cn(
									"flex h-8 items-center justify-center rounded-[6px] text-sm text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent",
									isToday && "font-semibold text-primary",
									isSelected && "bg-primary text-primary-foreground hover:bg-primary",
								)}
								onClick={() => onSelect?.(date)}
							>
								{date.getDate()}
							</button>
						);
					})}
				</div>
			</div>
		);
	},
);
Calendar.displayName = "Calendar";

export { Calendar };
