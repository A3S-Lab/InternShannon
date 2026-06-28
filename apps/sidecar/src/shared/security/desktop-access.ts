import { applyDecorators, SetMetadata } from '@nestjs/common';

export type DesktopCapability = string;

export const DESKTOP_CAPABILITY = {
    MENU_OBSERVABILITY_LIFECYCLE: 'menu:observability:lifecycle',
    MENU_SYSTEM_SETTINGS: 'menu:system:settings',
} as const;

export const REQUIRED_DESKTOP_CAPABILITIES_KEY = 'desktop:required_capabilities';
export const DESKTOP_CONFIG_CAPABILITIES_KEY = 'desktop:config_capabilities';
export const DESKTOP_CONFIG_MUTATION_KEY = 'desktop:config_mutation';
export const DESKTOP_RESOURCE_MUTATION_KEY = 'desktop:resource_mutation';

export const MANAGEMENT_ACTION = {
    CREATE: 'create',
    UPSERT: 'upsert',
    UPDATE: 'update',
    DELETE: 'delete',
    RESTART: 'restart',
    RESET: 'reset',
    ENABLE: 'enable',
    DISABLE: 'disable',
} as const;

export const MANAGEMENT_RESOURCE = {
    CONFIG: 'config',
    CONFIG_ASSISTANT: 'config.assistant',
    CONFIG_CATEGORY: 'config.category',
    CONFIG_EMAIL: 'config.email',
    CONFIG_ENTRY: 'config.entry',
    CONFIG_NETWORK: 'config.network',
    CONFIG_NOTIFICATIONS: 'config.notifications',
    CONFIG_OAUTH: 'config.oauth',
    CONFIG_SECURITY: 'config.security',
    CONFIG_STORAGE: 'config.storage',
    RESOURCE: 'resource',
    RUNTIME: 'runtime',
    ASSET: 'asset',
    INTEGRATION: 'integration',
} as const;

export type ManagementAction = (typeof MANAGEMENT_ACTION)[keyof typeof MANAGEMENT_ACTION];
export type ManagementResource = (typeof MANAGEMENT_RESOURCE)[keyof typeof MANAGEMENT_RESOURCE];

interface ConfigMutationOptions {
    description: string;
    action?: ManagementAction;
    resource?: ManagementResource;
    requireReauth?: boolean;
    operation?: string;
}

interface ResourceMutationOptions {
    capability: DesktopCapability;
    action: ManagementAction;
    description?: string;
    requireReauth?: boolean;
    resource?: ManagementResource | string;
    operation?: string;
}

const DEFAULT_REAUTH_ACTIONS = new Set<ManagementAction>([
    MANAGEMENT_ACTION.DELETE,
    MANAGEMENT_ACTION.RESTART,
    MANAGEMENT_ACTION.RESET,
]);

export function DesktopApi(): ClassDecorator & MethodDecorator {
    return applyDecorators();
}

export function DesktopCapabilityApi(...capabilities: DesktopCapability[]): ClassDecorator & MethodDecorator {
    return applyDecorators(RequireDesktopCapabilities(...capabilities));
}

export const RequireDesktopCapabilities = (...capabilities: DesktopCapability[]) =>
    SetMetadata(REQUIRED_DESKTOP_CAPABILITIES_KEY, capabilities);

export function ConfigManagementApi(): ClassDecorator & MethodDecorator {
    return applyDecorators(SetMetadata(DESKTOP_CONFIG_CAPABILITIES_KEY, [DESKTOP_CAPABILITY.MENU_SYSTEM_SETTINGS]));
}

export function ConfigMutation(options: ConfigMutationOptions): MethodDecorator {
    return SetMetadata(DESKTOP_CONFIG_MUTATION_KEY, {
        action: options.action ?? MANAGEMENT_ACTION.UPDATE,
        resource: options.resource ?? MANAGEMENT_RESOURCE.CONFIG,
        capabilities: [DESKTOP_CAPABILITY.MENU_SYSTEM_SETTINGS],
        sensitive: {
            operation: options.operation,
            requireReauth: options.requireReauth ?? false,
            description: options.description,
        },
    });
}

export function DesktopResourceApi(capability: DesktopCapability): ClassDecorator & MethodDecorator {
    return DesktopCapabilityApi(capability);
}

export function ResourceMutation(options: ResourceMutationOptions): MethodDecorator {
    return SetMetadata(DESKTOP_RESOURCE_MUTATION_KEY, {
        action: options.action,
        resource: options.resource ?? MANAGEMENT_RESOURCE.RESOURCE,
        capabilities: [options.capability],
        sensitive: {
            operation: options.operation,
            requireReauth: options.requireReauth ?? DEFAULT_REAUTH_ACTIONS.has(options.action),
            description: options.description ?? '管理操作',
        },
    });
}
