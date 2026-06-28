import { useEffect } from "react";
import { useSnapshot } from "valtio";
import platformBrandModel from "@/models/platform-brand.model";

function ensureIconLink(rel: string) {
  const selector = `link[rel="${rel}"]`;
  const current = document.head.querySelector<HTMLLinkElement>(selector);
  if (current) return current;

  const link = document.createElement("link");
  link.rel = rel;
  document.head.appendChild(link);
  return link;
}

export function PlatformBrandEffect({
  titleSuffix,
  fallbackLogoUrl = platformBrandModel.fallbackLogoUrl,
}: {
  titleSuffix?: string;
  fallbackLogoUrl?: string;
}) {
  const brand = useSnapshot(platformBrandModel.state);

  useEffect(() => {
    const appName = platformBrandModel.effectiveName();
    const logoUrl = platformBrandModel.effectiveLogoUrl(fallbackLogoUrl);

    document.title = titleSuffix ? `${appName} ${titleSuffix}` : appName;
    for (const rel of ["icon", "shortcut icon"]) {
      const icon = ensureIconLink(rel);
      icon.href = logoUrl;
      icon.type = /\.svg(?:\?|#|$)/i.test(logoUrl) || logoUrl.startsWith("data:image/svg+xml")
        ? "image/svg+xml"
        : "image/png";
    }
  }, [brand.appName, brand.logoUrl, fallbackLogoUrl, titleSuffix]);

  return null;
}
