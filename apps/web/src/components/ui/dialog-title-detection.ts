import * as React from "react";

function getElementDisplayName(type: React.ElementType | string): string | undefined {
  if (typeof type === "function" || typeof type === "object") {
    return (type as { displayName?: string }).displayName;
  }
  return undefined;
}

export function hasElementWithDisplayName(children: React.ReactNode, displayName: string): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (getElementDisplayName(child.type) === displayName) return true;
    return hasElementWithDisplayName((child.props as { children?: React.ReactNode }).children, displayName);
  });
}
