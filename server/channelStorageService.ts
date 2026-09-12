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

    // Throttle backups to max once every 10 seconds to avoid rate limits
    const now = Date.now();
    if (now - this.lastBackupTime < 10000) {
      if (!this.backupTimer) {
        this.backupTimer = setTimeout(() => {
          this.backupTimer = null;
          this.backupStateToChannel(botToken, BotPersistenceService.getInstance().getState());
        }, 11000);
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
        pendingRequests: state.pendingRequests || [],
        accessControlEnabled: state.accessControlEnabled,
        config: {
          model: state.config?.model || "gemini-3.8-flash",
          botActive: state.config?.botActive !== false,
          temperature: state.config?.temperature ?? 0.4,
          medicalSpecialty: state.config?.medicalSpecialty || "All Medical Sciences",
          examLevel: state.config?.examLevel || "USMLE Step 1 / 2 CK & Board Prep",
        },
        customSystemPrompts: state.customSystemPrompts || {},
      };

      const jsonStr = JSON.stringify(payload);
      let pinnedMessageId: number | null = null;

      // If minified JSON fits comfortably in Telegram message limit (< 3500 chars)
      if (jsonStr.length < 3500) {
        const messageText = `📦 *MEDCHAT CLOUD STORAGE BACKUP*\n\n` +
          `📅 *Timestamp:* \`${new Date().toISOString()}\`\n` +
          `👑 *Admins:* \`${state.adminChatIds.length}\`\n` +
          `👥 *Approved Students:* \`${state.approvedUsers.length}\`\n` +
          `🏷️ *Whitelisted Usernames:* \`${state.approvedUsernames.length}\`\n` +
          `🔒 *Access Control:* \`${state.accessControlEnabled ? 'Private (Whitelist)' : 'Public'}\`\n\n` +
          `#MEDCHAT_STATE_BACKUP\n\`\`\`json\n${jsonStr}\n\`\`\``;

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
          pinnedMessageId = resData.result.message_id;
        } else {
          console.warn(`[ChannelStorage] sendMessage failed: ${resData?.description}`);
        }
      }

      // If jsonStr is large (or sendMessage failed), upload as a backup document file
      if (!pinnedMessageId) {
        const form = new FormData();
        form.append("chat_id", this.channelUsername);
        form.append("caption", `📦 *MEDCHAT CLOUD STORAGE BACKUP*\n\n` +
          `📅 *Timestamp:* \`${new Date().toISOString()}\`\n` +
          `👑 *Admins:* \`${state.adminChatIds.length}\`\n` +
          `👥 *Approved Students:* \`${state.approvedUsers.length}\`\n` +
          `#MEDCHAT_STATE_BACKUP`);
        form.append("parse_mode", "Markdown");
        form.append("document", new Blob([jsonStr], { type: "application/json" }), "medchat_state_backup.json");

        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
          method: "POST",
          body: form,
        });

        const resData = await res.json() as any;
        if (resData && resData.ok) {
          pinnedMessageId = resData.result.message_id;
        } else {
          console.warn(`[ChannelStorage] sendDocument failed: ${resData?.description}`);
        }
      }

      if (pinnedMessageId) {
        // Pin the backup message so we can easily retrieve it on cold starts
        await fetch(`https://api.telegram.org/bot${botToken}/pinChatMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.channelUsername,
            message_id: pinnedMessageId,
            disable_notification: true
          }),
        }).catch(e => console.warn("[ChannelStorage] Failed to pin backup message:", e));

        console.log(`[ChannelStorage] State successfully backed up & pinned to channel ${this.channelUsername} (${state.approvedUsers.length} users, ${state.approvedUsernames.length} usernames)`);
        return true;
      }
    } catch (err) {
      console.warn("[ChannelStorage] Backup to channel error:", err);
    }

    return false;
  }

  /**
   * Attempts to restore the persistent state from the pinned backup message in the channel.
   * This is critical for stateless environments (like Cloud Run) to survive restarts.
   */
  public async restoreStateFromChannel(botToken: string): Promise<Partial<BotPersistentState> | null> {
    if (!botToken) return null;

    try {
      const url = `https://api.telegram.org/bot${botToken}/getChat`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.channelUsername }),
      });

      const data = await res.json() as any;
      if (data && data.ok && data.result?.pinned_message) {
        const pinned = data.result.pinned_message;
        const text = pinned.text || pinned.caption || "";

        // 1. Check if pinned message is a document backup
        if (pinned.document && pinned.document.file_id) {
          try {
            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ file_id: pinned.document.file_id }),
            });
            const fileData = await fileRes.json() as any;
            if (fileData.ok && fileData.result?.file_path) {
              const dlRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`);
              const jsonText = await dlRes.text();
              const parsed = JSON.parse(jsonText);
              console.log(`[ChannelStorage] Successfully restored state from pinned document in ${this.channelUsername}:`, {
                admins: parsed.adminChatIds?.length,
                approvedUsers: parsed.approvedUsers?.length,
                approvedUsernames: parsed.approvedUsernames?.length,
              });
              return parsed;
            }
          } catch (docErr) {
            console.warn("[ChannelStorage] Error downloading pinned document:", docErr);
          }
        }

        // 2. Check entities for pre or code block containing JSON
        const entities = pinned.entities || pinned.caption_entities || [];
        if (Array.isArray(entities)) {
          for (const ent of entities) {
            if (ent.type === "pre" || ent.type === "code") {
              const snippet = text.substring(ent.offset, ent.offset + ent.length).trim();
              if (snippet.startsWith("{") && snippet.endsWith("}")) {
                try {
                  const parsed = JSON.parse(snippet);
                  if (parsed && (parsed.approvedUsers !== undefined || parsed.adminChatIds !== undefined)) {
                    console.log(`[ChannelStorage] Successfully restored state from pinned entity in ${this.channelUsername}:`, {
                      admins: parsed.adminChatIds?.length,
                      approvedUsers: parsed.approvedUsers?.length,
                      approvedUsernames: parsed.approvedUsernames?.length,
                    });
                    return parsed;
                  }
                } catch {}
              }
            }
          }
        }

        // 3. Fallback: Parse braces { ... } from text or caption
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          try {
            const jsonStr = text.substring(start, end + 1);
            const parsed = JSON.parse(jsonStr);
            if (parsed && (parsed.approvedUsers !== undefined || parsed.adminChatIds !== undefined)) {
              console.log(`[ChannelStorage] Successfully restored state from pinned text braces in ${this.channelUsername}:`, {
                admins: parsed.adminChatIds?.length,
                approvedUsers: parsed.approvedUsers?.length,
                approvedUsernames: parsed.approvedUsernames?.length,
              });
              return parsed;
            }
          } catch (jsonErr) {
            console.warn("[ChannelStorage] Failed to parse JSON from braces:", jsonErr);
          }
        }
      }
    } catch (err) {
      console.warn("[ChannelStorage] Failed to restore state from channel:", err);
    }

    return null;
  }
}
