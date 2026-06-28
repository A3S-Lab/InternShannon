export const SCROLL_AREA_VIEWPORT_STYLE_ID = "a3s-radix-scroll-area-viewport-style";

export const SCROLL_AREA_INLINE_STYLE_SILENCED_ATTRIBUTE = "data-a3s-scroll-area-style-silenced";

export const RADIX_SCROLL_AREA_VIEWPORT_CSS =
  "[data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}";

export function containsRadixScrollAreaViewportCss(text: string | null | undefined): boolean {
  return (
    typeof text === "string" &&
    text.includes("[data-radix-scroll-area-viewport]") &&
    text.includes("scrollbar-width:none") &&
    text.includes("::-webkit-scrollbar")
  );
}

export function ensureScrollAreaViewportStyle(documentRef: Document): void {
  const existingStyle = documentRef.getElementById(SCROLL_AREA_VIEWPORT_STYLE_ID);

  if (existingStyle) {
    if (existingStyle.textContent !== RADIX_SCROLL_AREA_VIEWPORT_CSS) {
      existingStyle.textContent = RADIX_SCROLL_AREA_VIEWPORT_CSS;
    }
    return;
  }

  const style = documentRef.createElement("style");
  style.id = SCROLL_AREA_VIEWPORT_STYLE_ID;
  style.textContent = RADIX_SCROLL_AREA_VIEWPORT_CSS;
  documentRef.head.appendChild(style);
}

export function silenceInlineRadixScrollAreaStyle(root: HTMLElement | null): void {
  const style = root?.querySelector("style");

  if (!style || style.tagName.toLowerCase() !== "style" || !containsRadixScrollAreaViewportCss(style.textContent)) {
    return;
  }

  style.textContent = "";
  style.setAttribute(SCROLL_AREA_INLINE_STYLE_SILENCED_ATTRIBUTE, "true");
}
