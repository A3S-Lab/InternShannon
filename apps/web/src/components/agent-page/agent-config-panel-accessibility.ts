export function parameterHelpTriggerLabel(title: string | null | undefined): string {
  const normalizedTitle = title?.trim();
  return normalizedTitle ? `查看${normalizedTitle}说明` : "查看参数说明";
}
