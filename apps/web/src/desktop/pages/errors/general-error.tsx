import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GeneralErrorProps extends React.HTMLAttributes<HTMLDivElement> {
	minimal?: boolean;
}

export default function GeneralError({
	className,
	minimal = false,
}: GeneralErrorProps) {
	const navigate = useNavigate();
	return (
		<div className={cn("h-svh w-full", className)}>
			<div className="m-auto flex h-full w-full flex-col items-center justify-center gap-2">
				{!minimal && (
					<h1 className="text-[7rem] font-bold leading-tight font-['Outfit',sans-serif]">
						500
					</h1>
				)}
				<span className="font-medium font-['DM_Sans',sans-serif]">
					出错了 {`:')`}
				</span>
				<p className="text-center text-[var(--col-text03)] font-['DM_Sans',sans-serif]">
					非常抱歉给您带来不便，
					<br />
					请稍后再试。
				</p>
				{!minimal && (
					<div className="mt-6 flex gap-4">
						<Button variant="outline" onClick={() => navigate(-1)}>
							返回
						</Button>
						<Button onClick={() => navigate("/")}>回到首页</Button>
					</div>
				)}
			</div>
		</div>
	);
}
