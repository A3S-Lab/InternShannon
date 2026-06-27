import { Logger, LoggerService } from '@nestjs/common';
import { NotificationService } from '@/modules/notifications/application/notification.service';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationInput {
    title: string;
    description: string;
    level: NotificationLevel;
    link?: string;
    metadata?: Record<string, unknown>;
}

export class NotificationHelper {
    private readonly logger: LoggerService;

    constructor(private readonly notifications: NotificationService | undefined | null) {
        this.logger = new Logger(NotificationHelper.name);
    }

    async notify(userId: string | undefined | null, input: NotificationInput): Promise<void> {
        if (!userId || !this.notifications) return;
        try {
            await this.notifications.create({ userId, ...input });
        } catch (error) {
            this.logger.warn(`Failed to send notification to user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async notifyIf(
        condition: boolean,
        userId: string | undefined | null,
        input: NotificationInput,
    ): Promise<void> {
        if (condition) {
            await this.notify(userId, input);
        }
    }

    async ensureWelcomeNotification(userId: string | undefined | null): Promise<void> {
        if (!userId || !this.notifications) return;
        try {
            await this.notifications.ensureWelcomeNotification(userId);
        } catch (error) {
            this.logger.warn(`Failed to ensure welcome notification for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
