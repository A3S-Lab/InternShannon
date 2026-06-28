export function sidebarSectionListClassName(): string {
  return [
    "flex min-w-0 flex-none flex-wrap gap-1 overflow-visible px-2 py-2",
    "md:flex-1 md:flex-nowrap md:flex-col md:gap-0 md:space-y-0.5 md:overflow-visible",
  ].join(" ");
}
