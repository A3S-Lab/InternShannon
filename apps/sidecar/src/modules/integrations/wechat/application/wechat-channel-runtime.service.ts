import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BootProfiler } from '@/shared/infrastructure/boot/boot-profiler';
import {
    WECHAT_CHANNEL_FACTORY,
    WECHAT_ILINK_DEFAULT_ENDPOINT,
    WECHAT_INTEGRATION_CONFIG_REPOSITORY,
    type WechatChannelFactory,
    type WechatChannelMessage,
    type WechatChannelPort,
    type WechatChannelStatus,
    type WechatIntegrationConfigRepository,
} from '../domain';
import { WechatAgentBridgeService } from './wechat-agent-bridge.service';

interface UserChannel {
    userId: string;
    channel: WechatChannelPort;
    receivedMessageCount: number;
    handledMessageCount: number;
    lastMessageAt?: string;
    lastReplyAt?: string;
    lastError?: string;
    lastMessageError?: string;
}

@Injectable()
export class WechatChannelRuntimeService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WechatChannelRuntimeService.name);
    private readonly channels = new Map<string, UserChannel>();
    private globalEnabled = false;
    private configPollTimer?: NodeJS.Timeout;

    constructor(
        @Inject(WECHAT_INTEGRATION_CONFIG_REPOSITORY)
        private readonly configRepository: WechatIntegrationConfigRepository,
        @Inject(WECHAT_CHANNEL_FACTORY) private readonly channelFactory: WechatChannelFactory,
        private readonly bridge: WechatAgentBridgeService,
    ) {}

    async onModuleInit(): Promise<void> {
        // Don't block boot on WeChat login — each user channel does a real
        // network handshake. Read the global flag synchronously, schedule
        // user-channel hydration off the critical path, and start the
        // 30s config poller. Inbound WeChat messages will be rejected for
        // a few seconds after boot until the channels come up; that's
        // strictly better than holding the HTTP server hostage.
        const config = await this.configRepository.getConfig();
        this.globalEnabled = config.enabled;
        if (this.globalEnabled) {
            BootProfiler.background('WechatChannelRuntime.loadAllUserChannels', () => this.loadAllUserChannels());
        }
        this.configPollTimer = setInterval(() => this.pollGlobalConfig(), 30_000);
    }

    async onModuleDestroy(): Promise<void> {
        if (this.configPollTimer) {
            clearInterval(this.configPollTimer);
        }
        await this.stopAllChannels();
    }

    isGlobalEnabled(): boolean {
        return this.globalEnabled;
    }

    async setGlobalEnabled(enabled: boolean): Promise<void> {
        const config = await this.configRepository.getConfig();
        config.enabled = enabled;
        await this.configRepository.setConfig(config);
        this.globalEnabled = enabled;
        if (enabled) {
            await this.loadAllUserChannels();
        } else {
            await this.stopAllChannels();
        }
    }

    getUserStatus(userId: string): WechatChannelStatus {
        const uc = this.channels.get(userId);
        if (!uc) {
            return {
                enabled: this.globalEnabled,
                connected: false,
                configReady: this.globalEnabled,
                state: 'idle',
            };
        }
        return {
            enabled: this.globalEnabled,
            connected: uc.channel.identity !== undefined,
            configReady: true,
            boundAccount: uc.channel.identity?.nickname,
            state: uc.channel.identity ? 'connected' : 'disconnected',
            lastError: uc.lastError || undefined,
            receivedMessageCount: uc.receivedMessageCount,
            handledMessageCount: uc.handledMessageCount,
            lastMessageAt: uc.lastMessageAt,
            lastReplyAt: uc.lastReplyAt,
            lastMessageError: uc.lastMessageError || undefined,
        };
    }

    getChannelForUser(userId: string): WechatChannelPort | null {
        return this.channels.get(userId)?.channel ?? null;
    }

    createTempChannel(): WechatChannelPort {
        return this.channelFactory.create({ token: '', endpoint: WECHAT_ILINK_DEFAULT_ENDPOINT });
    }

    async startUserChannel(userId: string, token: string): Promise<void> {
        await this.stopUserChannel(userId);
        if (!this.globalEnabled) return;

        const channel = this.channelFactory.create({ token, endpoint: WECHAT_ILINK_DEFAULT_ENDPOINT });
        const uc: UserChannel = {
            userId,
            channel,
            receivedMessageCount: 0,
            handledMessageCount: 0,
        };
        this.channels.set(userId, uc);

        channel.on('message', (message) => {
            uc.receivedMessageCount++;
            uc.lastMessageAt = new Date().toISOString();
            this.handleMessage(userId, uc, message);
        });
        channel.on('error', (error) => {
            uc.lastError = error.message;
            uc.lastMessageError = error.message;
        });
        channel.on('login', (identity) => {
            this.logger.log(`WeChat user ${userId} logged in as: ${identity.nickname}`);
            uc.lastError = '';
        });
        channel.on('logout', () => {
            this.logger.log(`WeChat user ${userId} logged out`);
        });

        try {
            await channel.connect();
            uc.lastError = '';
        } catch (error) {
            uc.lastError = error instanceof Error ? error.message : String(error);
            this.logger.warn(`WeChat channel start failed for user ${userId}: ${uc.lastError}`);
        }
    }

    async stopUserChannel(userId: string): Promise<void> {
        const uc = this.channels.get(userId);
        if (!uc) return;
        try {
            await uc.channel.disconnect();
        } catch (error) {
            this.logger.debug(`Channel disconnect error for user ${userId}: ${error instanceof Error ? error.message : error}`);
        }
        this.channels.delete(userId);
    }

    async saveUserToken(userId: string, token: string): Promise<void> {
        await this.startUserChannel(userId, token);
    }

    async unbindUser(userId: string): Promise<void> {
        await this.stopUserChannel(userId);
    }

    private handleMessage(userId: string, uc: UserChannel, message: WechatChannelMessage): void {
        this.bridge.runDefaultAgent(message).then(reply => {
            if (!reply || !uc.channel) return;
            uc.channel.send(message.fromUser, reply, message.contextToken).then(() => {
                uc.handledMessageCount++;
                uc.lastReplyAt = new Date().toISOString();
            }).catch(error => {
                uc.lastMessageError = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Failed to send WeChat reply for user ${userId}: ${uc.lastMessageError}`);
            });
        }).catch(error => {
            uc.lastMessageError = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to run agent for user ${userId}: ${uc.lastMessageError}`);
        });
    }

    private async loadAllUserChannels(): Promise<void> {
        return;
    }

    private async stopAllChannels(): Promise<void> {
        const userIds = [...this.channels.keys()];
        for (const userId of userIds) {
            await this.stopUserChannel(userId);
        }
    }

    private async pollGlobalConfig(): Promise<void> {
        try {
            const config = await this.configRepository.getConfig();
            if (config.enabled !== this.globalEnabled) {
                this.globalEnabled = config.enabled;
                if (this.globalEnabled) {
                    await this.loadAllUserChannels();
                } else {
                    await this.stopAllChannels();
                }
            }
        } catch (error) {
            this.logger.debug(`Config poll error: ${error instanceof Error ? error.message : error}`);
        }
    }
}
