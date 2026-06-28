import { useSnapshot } from "valtio";

import { cn } from "@/lib/utils";
import platformBrandModel from "@/models/platform-brand.model";

interface LogoProps {
  collapsed?: boolean;
  className?: string;
}

export function Logo({ collapsed, className }: LogoProps) {
  const brand = useSnapshot(platformBrandModel.state);
  const appName = platformBrandModel.effectiveName();
  const logoUrl = platformBrandModel.effectiveLogoUrl();

  if (collapsed) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <img src={logoUrl} alt={appName} className="h-8 w-8 shrink-0 object-contain" />
      </div>
    );
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <img src={logoUrl} alt={appName} className="h-8 w-8 shrink-0 object-contain" />
      <span className="truncate whitespace-nowrap text-[16px] font-semibold text-foreground">{brand.appName || appName}</span>
    </div>
  );
}
