/**
 * Telegram Channel Cloud Storage & Auto-Admin Synchronization
 * Uses Telegram Channel (@theoutliness) as a permanent, decentralized cloud database
 * to persist administrators, approved students, custom prompts, and bot configurations.
 */

import { BotPersistentState, BotPersistenceService, AuthorizedUser } from "./botPersistence";

export class ChannelStorageService {
  private static instance: ChannelStorageService;
  private channelUsername: string = process.env.STORAGE_CHANNEL || "@theoutliness";
  private lastBackupTime: number = 0;
  private backupTimer: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;

  private constructor() {}

  public static getInstance(): ChannelStorageService {
    if (!ChannelStorageService.instance) {
      ChannelStorageService.instance = new ChannelStorageService();
    }
    return ChannelStorageService.instance;
  }

  public getChannelTarget(): string {
    return this.channelUsername;
  }

  /**
   * Fetches all channel administrators from @theoutliness and automatically authorizes them as bot admins
   */
  public async syncAdminsFromChannel(botToken: string): Promise<{
    adminChatIds: Array<string | number>;
    adminUsernames: string[];
    approvedUsers: AuthorizedUser[];
  }> {
    const result = {
      adminChatIds: [] as Array<string | number>,
      adminUsernames: [] as string[],
      approvedUsers: [] as AuthorizedUser[],
    };

    if (!botToken) return result;

    try {
      const url = `https://api.telegram.org/bot${botToken}/getChatAdministrators`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.channelUsername }),
      });

      const data = await res.json() as any;
      if (data && data.ok && Array.isArray(data.result)) {
        for (const member of data.result) {
          if (member.user && !member.user.is_bot) {
            const uId = member.user.id;
            const uName = member.user.username;
            const fullName = `${member.user.first_name || ''} ${member.user.last_name || ''}`.trim() || "Channel Owner";

            result.adminChatIds.push(uId);
            if (uName) {
              const cleanUser = uName.replace(/^@/, '').toLowerCase().trim();
              result.adminUsernames.push(cleanUser);
            }

            result.approvedUsers.push({
              chatId: uId,
              username: uName ? `@${uName}` : undefined,
              name: fullName,
              approvedAt: new Date().toISOString(),
              approvedBy: `Channel Admin (${member.status})`,
            });
          }
        }
        console.log(`[ChannelStorage] Synced ${result.adminChatIds.length} admins from channel ${this.channelUsername}`);
      } else {
        console.log(`[ChannelStorage] Note: Could not getChatAdministrators for ${this.channelUsername} (${data?.description || 'bot not in channel or private'}). Disk persistence active.`);
      }
    } catch (err) {
      console.warn("[ChannelStorage] Failed to query channel administrators:", err);
    }

    return result;
  }

  /**
   * Backs up full bot persistent state to the Telegram channel @theoutliness
   */
  public async backupStateToChannel(botToken: string, state: BotPersistentState): Promise<boolean> {
    if (!botToken) return false;

    // Throttle backups to max once every 15 seconds to avoid rate limits
    const now = Date.now();
    if (now - this.lastBackupTime < 15000) {
      if (!this.backupTimer) {
        this.backupTimer = setTimeout(() => {
          this.backupTimer = null;
          this.backupStateToChannel(botToken, BotPersistenceService.getInstance().getState());
        }, 16000);
      }
      return true;
    }

    this.lastBackupTime = now;

    try {
      const payload = {
        version: state.version || 1,
        savedAt: new Date().toISOString(),
        adminChatIds: state.adminChatIds,
        adminUsernames: state.adminUsernames,
        approvedUsers: state.approvedUsers,
        approvedUsernames: state.approvedUsernames,
        accessControlEnabled: state.accessControlEnabled,
        config: {
          model: state.config.model,
          botActive: state.config.botActive,
          temperature: state.config.temperature,
          medicalSpecialty: state.config.medicalSpecialty,
          examLevel: state.config.examLevel,
        },
        customSystemPrompts: state.customSystemPrompts,
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      const backupCaption = `📦 *MEDCHAT CLOUD STORAGE BACKUP*\n\n` +
        `📅 *Timestamp:* \`${new Date().toISOString()}\`\n` +
        `👑 *Admins:* \`${state.adminChatIds.length}\`\n` +
        `👥 *Approved Students:* \`${state.approvedUsers.length}\`\n` +
        `🔒 *Access Control:* \`${state.accessControlEnabled ? 'Private (Whitelist)' : 'Public'}\`\n\n` +
        `\`#MEDCHAT_STATE_BACKUP\`\n\`\`\`json\n${jsonStr}\n\`\`\``;

      // If text exceeds Telegram 4096 character limit, truncate cleanly or send summary + essential state
      let messageText = backupCaption;
      if (messageText.length > 4000) {
        messageText = `📦 *MEDCHAT CLOUD STORAGE BACKUP*\n\n` +
          `📅 *Timestamp:* \`${new Date().toISOString()}\`\n` +
          `👑 *Admins:* \`${state.adminChatIds.join(', ')}\`\n` +
          `👥 *Approved Users Count:* \`${state.approvedUsers.length}\`\n\n` +
          `\`#MEDCHAT_STATE_BACKUP\`\n\`\`\`json\n${JSON.stringify({
            adminChatIds: state.adminChatIds,
            adminUsernames: state.adminUsernames,
            approvedUsernames: state.approvedUsernames,
            approvedUsers: state.approvedUsers.slice(0, 100),
            accessControlEnabled: state.accessControlEnabled,
            savedAt: new Date().toISOString()
          })}\n\`\`\``;
      }

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.channelUsername,
          text: messageText,
          parse_mode: "Markdown",
        }),
      });

      const resData = await res.json() as any;
      if (resData && resData.ok) {
        console.log(`[ChannelStorage] State successfully backed up to channel ${this.channelUsername}`);
        return true;
      } else {
        console.log(`[ChannelStorage] Channel backup note: ${resData?.description || 'Could not post to channel'}. Local disk storage maintained.`);
      }
    } catch (err) {
      console.warn("[ChannelStorage] Backup to channel error:", err);
    }

    return false;
  }
}
