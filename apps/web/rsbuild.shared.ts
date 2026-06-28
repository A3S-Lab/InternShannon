const criticalDependencyMessage = "Critical dependency: the request of a dependency is an expression";

const knownEditorWorkerCriticalDependencyModules = [
  /node_modules[\\/]\.pnpm[\\/]@typescript\+vfs@[^\\/]+[\\/]node_modules[\\/]@typescript[\\/]vfs[\\/]dist[\\/]vfs\.esm\.js/,
  /node_modules[\\/]\.pnpm[\\/]typescript@[^\\/]+[\\/]node_modules[\\/]typescript[\\/]lib[\\/]typescript\.js/,
  /node_modules[\\/]@typescript[\\/]vfs[\\/]dist[\\/]vfs\.esm\.js/,
  /node_modules[\\/]typescript[\\/]lib[\\/]typescript\.js/,
];

type RspackWarning = Error & {
  file?: string;
  moduleDescriptor?: {
    identifier?: string;
    name?: string;
  };
  module?: {
    resource?: string;
    identifier?: () => string;
    nameForCondition?: () => string;
  };
};

export function ignoreKnownEditorWorkerWarnings(warning: Error): boolean {
  const rspackWarning = warning as RspackWarning;
  const modulePath = [
    rspackWarning.file,
    rspackWarning.moduleDescriptor?.identifier,
    rspackWarning.moduleDescriptor?.name,
    rspackWarning.module?.resource,
    rspackWarning.module?.nameForCondition?.(),
    rspackWarning.module?.identifier?.(),
    rspackWarning.message,
    rspackWarning.stack,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    rspackWarning.message.includes(criticalDependencyMessage) &&
    knownEditorWorkerCriticalDependencyModules.some((pattern) => pattern.test(modulePath))
  );
}
