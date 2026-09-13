import { generateGeminiReply, ConversationTurn, MediaAttachment } from "./geminiService";
import { detectImageRequest, searchMedicalImages, searchMedicalImage, ImageSearchResult } from "./imageSearchService";
import { generateMedicalPdf } from "./pdfService";
import { generateMedicalPpt } from "./pptService";
import { extractMarkdownTables, renderTableToPngBuffer } from "./tableImageService";
import { DEFAULT_MEDICAL_PROMPT } from "../src/constants";
import { BotPersistenceService } from "./botPersistence";
import { cleanAndFormatMedicalText, formatMedicalSymbols } from "./medicalFormatter";
import { ChannelStorageService } from "./channelStorageService";
import { YoutubeTranscript } from "youtube-transcript";
import cron from "node-cron";

export interface QuizData {
  scenario?: string;
  question: string;
  options: string[];
  correctOptionId: number;
  explanation: string;
  fullRationale?: string;
  topic?: string;
  countdownSeconds?: number;
  isRapidFire?: boolean;
  imageUrl?: string;
  wikipediaTitleForImage?: string;
}

export interface LongTextCaseQuestion {
  caseNumber: number;
  title: string;
  vignette: string;
  question: string;
  options: string[];
  correctAnswer: string;
  mechanism: string;
  distractorAnalysis: string;
  clinicalPearl: string;
}

export interface UserPromptIntent {
  count: number;
  topic: string;
  isHarder: boolean;
  isComplex: boolean;
  isLongCase: boolean;
  allowScenario: boolean;
  isPollRequested: boolean;
  isTextCaseRequested: boolean;
  isMcqRequested: boolean;
  isRapidFire: boolean;
  isWebQuizRequested: boolean;
  customTimerSeconds?: number;
  rawPrompt: string;
}

export interface PendingMediaBatchItem {
  fileId: string;
  mimeType: string;
  fileName?: string;
  caption?: string;
  messageId: number;
  timestamp: number;
}

export function parseUserPromptIntent(rawPrompt: string, defaultTopic: string = "General Clinical Medicine"): UserPromptIntent {
  const text = (rawPrompt || "").trim();

  // 1. Difficulty & Complexity flags
  const isHarder = /\b(hard|harder|hardest|difficult|very hard|challenging|board trap|step 3|expert|subspecialty|tough|trick|high yield trap)\b/i.test(text);
  const isComplex = /\b(complex|complicated|multimorbid|multidisciplinary|atypical|multi-step|second order|third order|diagnostic dilemma|atypical presentation)\b/i.test(text);

  // 2. Scenario & Length flags
  const isLongCase = /\b(long|long text|detailed|extended|in-depth|comprehensive|full vignette|long case|vignettes|vignette|case study|cases|case questions)\b/i.test(text);
  const allowScenario = isLongCase || /\b(clinical case|clinical scenario|vignette|patient|case study|clinical vignette|patient vignette|presentation|findings|hx|history)\b/i.test(text);

  // 3. Format flags & Rapid Fire detection
  const isRapidFire = /\b(rapidfire|rapid fire|rapid-fire|speed mcq|speed quiz|speed test|timed quiz|timed mcq|timed exam|rapid exam|rapid mcq|timed test|\/rapidfire|\/rapid|\/speed|\/timed|\/timedquiz)\b/i.test(text);
  const isWebQuizRequested = /\b(webquiz|web quiz|web-quiz|web quizzes|fetch.*web.*quiz|quiz.*from.*web)\b/i.test(text);
  const isPollRequested = isRapidFire || isWebQuizRequested || (/\b(poll|polls|telegram poll|quiz|quizzes|interactive quiz|\/quiz)\b/i.test(text) && !/\b(text case|written case|case document|pdf|no poll)\b/i.test(text));
  const isTextCaseRequested = !isRapidFire && !isWebQuizRequested && (/\b(text case|case questions|clinical questions|written questions|case studies|question bank|long text case)\b/i.test(text) || (isLongCase && !isPollRequested && (/\b(questions?|cases?|items?)\b/i.test(text))));
  const isMcqRequested = /\b(mcq|mcqs|\/mcq|multiple choice)\b/i.test(text);

  // Custom countdown timer detection (e.g. "15s", "20 sec", "45 seconds", "timer 30", "30s timer")
  let customTimerSeconds: number | undefined;
  const timerMatch = text.match(/\b(?:timer|countdown|time|duration)?\s*(\d{1,3})\s*(?:s|sec|secs|seconds|second)\b/i) ||
                     text.match(/\b(?:timer|countdown)\s*[:=]?\s*(\d{1,3})\b/i);
  if (timerMatch && timerMatch[1]) {
    const parsedSec = parseInt(timerMatch[1], 10);
    if (parsedSec >= 5 && parsedSec <= 600) {
      customTimerSeconds = parsedSec;
    }
  }

  // 4. Count extraction (supports up to 50!)
  let count = isRapidFire ? 5 : 1; // Default to 5 questions for rapid fire sprints
  const countRegexes = [
    /\b(\d+)\s*(?:long\s+)?(?:text\s+)?(?:case\s+)?(?:questions?|quizzes|quiz|mcqs?|items?|cases?|polls?|vignettes?)\b/i,
    /(?:generate|give me|create|send|make|produce|write|test me with)\s*(\d+)\s*(?:long\s+)?(?:text\s+)?(?:case\s+)?(?:questions?|quizzes|quiz|mcqs?|items?|cases?|polls?|vignettes?)?/i,
    /(?:\/quiz|\/mcq|\/rapidfire|\/rapid|\/timed|\/speed|quiz|mcq|rapidfire)\s*(\d+)\b/i,
    /\b(\d+)\s*(?:interactive\s*)?quiz(?:zes)?\b/i,
    /\b(\d+)\s*(?:rapid\s*fire|timed|speed)?\s*(?:questions?|mcqs?|polls?)\b/i
  ];

  for (const reg of countRegexes) {
    const match = text.match(reg);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (num > 0) {
        count = num;
        break;
      }
    }
  }

  // If text specifically says "50" anywhere in a question request, ensure count is 50
  if (/\b50\b/.test(text) && /\b(questions?|cases?|quizzes?|polls?|items?|mcqs?)\b/i.test(text)) {
    count = 50;
  }

  // Cap count between 1 and 50 to maintain performance and high quality
  count = Math.min(Math.max(1, count), 50);

  // 5. Clean Topic Extraction
  let topic = text
    .replace(/^\/(?:quiz|mcq|poll|cases?|rapidfire|rapid|timed|speed|timedquiz)\s*/i, "")
    .replace(/(?:generate|give me|create|send|make|produce|write|test me with|provide|ask me)\s*/i, "")
    .replace(/\b\d+\s*(?:long\s+)?(?:text\s+)?(?:case\s+)?(?:questions?|quizzes|quiz|mcqs?|items?|cases?|polls?|vignettes?)?\b/gi, "")
    .replace(/\b(quiz me on|quiz on|quizzes on|interactive quiz|quiz|quizzes|poll questions|polls?|mcqs?|mcq)\b/gi, "")
    .replace(/\b(rapidfire|rapid fire|rapid-fire|speed mcq|speed quiz|speed test|timed quiz|timed mcq|timed exam|rapid exam|timed test)\b/gi, "")
    .replace(/\b\d+\s*(?:s|sec|secs|seconds|second)\b/gi, "")
    .replace(/\b(?:timer|countdown)\s*[:=]?\s*\d+\b/gi, "")
    .replace(/\b(long text case questions|long text case|case questions|cases|case studies|vignettes?)\b/gi, "")
    .replace(/\b(harder|hard|difficult|very hard|complex|complicated|challenging)\b/gi, "")
    .replace(/\b(please|can you|i want|give|provide|about|on|for)\b/gi, "")
    .replace(/\b(clinical case|clinical scenario|vignette|case study|questions?)\b/gi, "")
    .trim();

  topic = topic.replace(/^[:\-\s,]+|[:\-\s,]+$/g, "").trim();
  if (!topic || topic.length < 2) {
    topic = defaultTopic;
  }

  return {
    count,
    topic,
    isHarder,
    isComplex,
    isLongCase,
    allowScenario,
    isPollRequested,
    isTextCaseRequested,
    isMcqRequested,
    isRapidFire,
    isWebQuizRequested,
    customTimerSeconds,
    rawPrompt: text,
  };
}

export interface ParsedQuizRequest {
  count: number;
  topic: string;
  allowScenario: boolean;
  userPrompt: string;
}

export function parseQuizPrompt(rawPrompt: string): ParsedQuizRequest {
  const intent = parseUserPromptIntent(rawPrompt, "General Medical Sciences");
  return {
    count: intent.count,
    topic: intent.topic,
    allowScenario: intent.allowScenario,
    userPrompt: rawPrompt,
  };
}

export interface BotState {
  token: string;
  botInfo: any | null;
  botError: string | null;
  mode: 'polling' | 'webhook' | 'idle';
  isPollingRunning: boolean;
  webhookInfo: any | null;
  config: {
    systemInstruction: string;
    temperature: number;
    botActive: boolean;
    pollingEnabled: boolean;
    model: string;
    medicalSpecialty?: string;
    examLevel?: string;
    activeSubjects?: string[];
    rapidFireCountdownSeconds?: number;
  };
  stats: {
    totalMessages: number;
    totalErrors: number;
    averageLatencyMs: number;
    activeChatsCount: number;
    mcqsGenerated: number;
    examTipsShared: number;
    imagesProcessed: number;
    documentsProcessed: number;
    startedAt: string;
    lastActiveAt?: string;
  };
}

export interface MessageLogEntry {
  id: string;
  chatId: number | string;
  userName: string;
  userHandle?: string;
  userMessage: string;
  aiResponse: string;
  latencyMs: number;
  timestamp: string;
  status: 'success' | 'error';
  errorMessage?: string;
  source: 'telegram' | 'web_test';
  mediaType?: 'image' | 'document';
  fileName?: string;
}

export interface AuthorizedUser {
  chatId: number | string;
  username?: string;
  name?: string;
  approvedAt: string;
  approvedBy?: string;
}

export interface PendingUserRequest {
  chatId: number | string;
  username?: string;
  name?: string;
  requestedAt: string;
  lastMessage?: string;
}

export { DEFAULT_MEDICAL_PROMPT };

function sanitizeTelegramMarkdown(text: string): string {
  if (!text) return "";
  // 1. Process LaTeX, math symbols, superscripts, subscripts, bolding, and spacing
  const formatted = cleanAndFormatMedicalText(text);
  // 2. In Telegram legacy Markdown, underscores between alphanumeric characters
  // (e.g. CYP3A4_substrate, H+_ATPase, Na_K_pump) cause syntax parse errors unless escaped.
  return formatted.replace(/([a-zA-Z0-9])_([a-zA-Z0-9])/g, "$1\\_$2");
}

class TelegramBotManager {
  private token: string;
  private botInfo: any | null = null;
  private botError: string | null = null;
  private webhookInfo: any | null = null;
  private mode: 'polling' | 'webhook' | 'idle' = 'polling';
  private isPollingActive: boolean = false;
  private pollingAbortController: AbortController | null = null;
  private nextUpdateOffset: number = 0;

  private chatHistories: Map<number | string, ConversationTurn[]> = new Map();
  // Stores the most recent bot response per chat for instant PDF compilation via /pdf
  private lastBotResponseByChat: Map<
    number | string,
    {
      text: string;
      topic: string;
      sourceType: 'general' | 'image' | 'document' | 'mcq' | 'quiz' | 'long_case' | 'exam_tips';
      timestamp: number;
    }
  > = new Map();
  private customSystemPrompts: Map<number | string, string> = new Map();
  private userStates: Map<number | string, string> = new Map();
  private logs: MessageLogEntry[] = [];
  private totalLatencySum: number = 0;
  private totalLatencyCount: number = 0;

  // Media Group & Batch Collection (buffers multi-image albums & bursts)
  private mediaBatchMap: Map<
    string,
    {
      items: PendingMediaBatchItem[];
      timer: NodeJS.Timeout;
      chatId: number | string;
      sender: any;
      userName: string;
      userHandle?: string;
      startTime: number;
    }
  > = new Map();

  // Access Control & Whitelist State (Option 3)
  private accessControlEnabled: boolean = true;
  private adminChatIds: Set<number | string> = new Set();
  private adminUsernames: Set<string> = new Set();
  private approvedUsers: Map<number | string, AuthorizedUser> = new Map();
  private approvedUsernames: Set<string> = new Set();
  private pendingRequests: Map<number | string, PendingUserRequest> = new Map();
  private adminSecret: string = process.env.ADMIN_SECRET || "medadmin2026";
  private autoPostTopics: string[] = [];

  private config = {
    systemInstruction: DEFAULT_MEDICAL_PROMPT,
    temperature: 0.4,
    botActive: true,
    pollingEnabled: true,
    model: "gemini-3.8-flash",
    medicalSpecialty: "All Medical Sciences",
    examLevel: "USMLE Step 1 / 2 CK & Board Prep",
    activeSubjects: ["Anatomy", "Physiology", "Biochemistry", "Microbiology", "Pathology", "Pharmacology"],
    rapidFireCountdownSeconds: 30,
  };

  private stats = {
    totalMessages: 0,
    totalErrors: 0,
    averageLatencyMs: 0,
    activeChatsCount: 0,
    mcqsGenerated: 0,
    examTipsShared: 0,
    imagesProcessed: 0,
    documentsProcessed: 0,
    startedAt: new Date().toISOString(),
    lastActiveAt: undefined as string | undefined,
  };

  private isChannelRestoreComplete: boolean = false;

  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || "8862664585:AAFVFulDGYrS_pPdfcFH-peILkbHZVi-84A";

    // 1. Hydrate state from durable disk persistence
    try {
      const savedState = BotPersistenceService.getInstance().getState();
      this.accessControlEnabled = savedState.accessControlEnabled;
      if (savedState.adminSecret) {
        this.adminSecret = savedState.adminSecret;
      }
      this.config = { ...this.config, ...savedState.config };

      // Load adminChatIds
      for (const id of savedState.adminChatIds || []) {
        const num = Number(id);
        this.adminChatIds.add(!isNaN(num) ? num : String(id).trim());
      }

      // Load adminUsernames
      for (const u of savedState.adminUsernames || []) {
        this.adminUsernames.add(u.replace(/^@/, '').toLowerCase().trim());
      }

      // Load approvedUsers
      for (const user of savedState.approvedUsers || []) {
        const key = String(user.chatId).trim();
        this.approvedUsers.set(key, user);
        if (user.username) {
          this.approvedUsernames.add(user.username.replace(/^@/, '').toLowerCase().trim());
        }
      }

      // Load approvedUsernames
      for (const u of savedState.approvedUsernames || []) {
        this.approvedUsernames.add(u.replace(/^@/, '').toLowerCase().trim());
      }

      // Load pendingRequests
      for (const req of savedState.pendingRequests || []) {
        this.pendingRequests.set(String(req.chatId).trim(), req);
      }

      // Load custom prompts
      if (savedState.customSystemPrompts) {
        for (const [cId, prompt] of Object.entries(savedState.customSystemPrompts)) {
          this.customSystemPrompts.set(cId, prompt);
        }
      }

      this.autoPostTopics = savedState.autoPostTopics || [];
    } catch (err) {
      console.error("[Telegram] Error loading persistent bot state:", err);
    }

    // 2. Supplement with environment variables if specified
    if (process.env.ADMIN_TELEGRAM_ID) {
      process.env.ADMIN_TELEGRAM_ID.split(",").map(s => s.trim()).filter(Boolean).forEach(id => {
        const num = Number(id);
        this.adminChatIds.add(!isNaN(num) ? num : id);
      });
    }

    if (process.env.ADMIN_USERNAME) {
      process.env.ADMIN_USERNAME.split(",").map(s => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean).forEach(u => {
        this.adminUsernames.add(u);
      });
    }

    // Save initial disk state without triggering unhydrated channel backup
    BotPersistenceService.getInstance().saveStateSync();

    // 3. Initiate immediate Channel storage restore BEFORE admin sync
    // This guarantees that all approved users from the pinned backup are hydrated before any admin sync runs.
    this.restoreStateFromChannelBackup()
      .then(async () => {
        this.isChannelRestoreComplete = true;
        await this.syncAdminsFromChannel();
        this.syncAndPersistState(true);
      })
      .catch(err => {
        console.warn("[TelegramBot] Initial channel restore warning:", err);
        this.isChannelRestoreComplete = true;
        this.syncAdminsFromChannel().catch(() => {});
      });

    // 4. Set up recurring 60s background sync to ensure admins and whitelists are never forgotten
    setInterval(() => {
      this.syncAdminsFromChannel().catch(() => {});
      this.restoreStateFromChannelBackup().catch(() => {});
    }, 60000);

    // 5. Initialize Daily Cron Jobs
    this.initCronJobs();
  }

  private initCronJobs() {
    // Schedule for 08:00 AM (05:00 UTC) and 08:00 PM (17:00 UTC) EAT
    // We will use standard daily schedule: 08:00 AM and 08:00 PM local server time.
    cron.schedule("0 8,20 * * *", () => {
      console.log("[Cron] Executing daily clinical vignette post...");
      this.postDailyVignette().catch(err => {
        console.error("[Cron] Error posting daily vignette:", err);
      });
    });
  }

  public async postDailyVignette(forcedTopic?: string): Promise<boolean> {
    const channelId = "@M_T_C_ethiopia";
    let topicToPost = forcedTopic;

    if (!topicToPost) {
      if (this.autoPostTopics.length === 0) {
        console.warn("[Cron] No topics available for daily auto-post. Skipping.");
        return false;
      }
      // Pick a random topic from the list
      const randomIndex = Math.floor(Math.random() * this.autoPostTopics.length);
      topicToPost = this.autoPostTopics[randomIndex];
    }

    try {
      const prompt = `Generate a highly challenging, USMLE-style Clinical Vignette (Multiple Choice Question) focusing on the following topic: ${topicToPost}. 
Return ONLY a strictly valid JSON array with 1 object matching this schema:
[{
  "scenario": "A 45-year-old male presents with...",
  "question": "What is the most likely diagnosis?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctOptionId": 0,
  "explanation": "Short 1-sentence explanation of the correct answer.",
  "fullRationale": "Detailed explanation of why the right answer is correct and why the others are wrong."
}]
Do not use markdown blocks around the JSON.`;

      const { text } = await generateGeminiReply(prompt, [], this.config.systemInstruction, 0.7, [], this.config.model);
      const cleanJsonStr = text.replace(/^```json\s*/, "").replace(/```$/, "").trim();
      
      const parsedQuizzes = JSON.parse(cleanJsonStr) as QuizData[];
      if (!parsedQuizzes || parsedQuizzes.length === 0) return false;

      const q = parsedQuizzes[0];
      const fullText = `*Daily Clinical Vignette: ${topicToPost}*\n\n${q.scenario ? q.scenario + "\n\n" : ""}${q.question}`;

      // 1. Send the scenario text
      const msgRes = await fetch(`${this.getApiBase()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channelId,
          text: fullText,
          parse_mode: "Markdown"
        })
      });
      const msgData = await msgRes.json();
      if (!msgData.ok) {
        console.error("[Cron] Failed to send vignette text to channel:", msgData);
        return false;
      }
      const messageId = msgData.result.message_id;

      // 2. Send the poll as a reply to the text
      const pollRes = await fetch(`${this.getApiBase()}/sendPoll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channelId,
          question: q.question.slice(0, 300),
          options: JSON.stringify(q.options.slice(0, 10).map((opt) => String(opt).slice(0, 100))),
          type: "quiz",
          correct_option_id: q.correctOptionId,
          is_anonymous: true,
          explanation: (q.explanation || "").slice(0, 200),
          reply_to_message_id: messageId
        })
      });
      const pollData = await pollRes.json();
      if (!pollData.ok) {
        console.error("[Cron] Failed to send poll to channel:", pollData);
        return false;
      }
      const pollMsgId = pollData.result.message_id;

      // 3. Send full rationale as a spoiler-tagged HTML reply
      if (q.fullRationale) {
        const safeRationale = q.fullRationale.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        await fetch(`${this.getApiBase()}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: channelId,
            text: `<b>Rationale:</b>\n<tg-spoiler>${safeRationale}</tg-spoiler>`,
            parse_mode: "HTML",
            reply_to_message_id: pollMsgId
          })
        });
      }

      console.log(`[Cron] Successfully posted vignette on "${topicToPost}" to ${channelId}`);
      return true;
    } catch (err) {
      console.error("[Cron] Failed to post daily vignette:", err);
      return false;
    }
  }

  /**
   * Restores state from the pinned backup message in the Telegram channel to survive container restarts
   */
  public async restoreStateFromChannelBackup(): Promise<void> {
    try {
      const channelStorage = ChannelStorageService.getInstance();
      const backupState = await channelStorage.restoreStateFromChannel(this.token);

      if (backupState) {
        let changed = false;

        if (backupState.adminChatIds) {
          for (const id of backupState.adminChatIds) {
            const num = Number(id);
            const validId = !isNaN(num) ? num : id;
            if (!this.adminChatIds.has(validId)) {
              this.adminChatIds.add(validId);
              changed = true;
            }
          }
        }

        if (backupState.adminUsernames) {
          for (const u of backupState.adminUsernames) {
            const clean = u.replace(/^@/, '').toLowerCase().trim();
            if (!this.adminUsernames.has(clean)) {
              this.adminUsernames.add(clean);
              changed = true;
            }
          }
        }

        if (backupState.approvedUsers) {
          for (const user of backupState.approvedUsers) {
            const key = String(user.chatId).trim();
            if (!this.approvedUsers.has(key)) {
              this.approvedUsers.set(key, user);
              changed = true;
            }
            if (user.username) {
              const clean = user.username.replace(/^@/, '').toLowerCase().trim();
              this.approvedUsernames.add(clean);
            }
          }
        }

        // Restore approvedUsernames
        if (backupState.approvedUsernames) {
          for (const u of backupState.approvedUsernames) {
            const clean = u.replace(/^@/, '').toLowerCase().trim();
            if (!this.approvedUsernames.has(clean)) {
              this.approvedUsernames.add(clean);
              changed = true;
            }
          }
        }

        // Restore pendingRequests
        if (backupState.pendingRequests) {
          for (const req of backupState.pendingRequests) {
            const key = String(req.chatId).trim();
            if (!this.pendingRequests.has(key)) {
              this.pendingRequests.set(key, req);
              changed = true;
            }
          }
        }

        if (backupState.customSystemPrompts) {
          for (const [cId, prompt] of Object.entries(backupState.customSystemPrompts)) {
            if (!this.customSystemPrompts.has(cId)) {
              this.customSystemPrompts.set(cId, prompt);
              changed = true;
            }
          }
        }

        if (backupState.autoPostTopics && backupState.autoPostTopics.length > 0) {
          this.autoPostTopics = backupState.autoPostTopics;
          changed = true;
        }

        if (changed) {
          console.log(`[TelegramBot] Successfully merged state from channel backup (${this.approvedUsers.size} users, ${this.approvedUsernames.size} usernames, ${this.adminChatIds.size} admins).`);
          this.syncAndPersistState();
        }
      }
    } catch (err) {
      console.warn("[TelegramBot] Error restoring state from channel backup:", err);
    } finally {
      this.isChannelRestoreComplete = true;
    }
  }

  /**
   * Synchronizes channel administrators and creators from @theoutliness
   */
  public async syncAdminsFromChannel(): Promise<void> {
    try {
      const channelStorage = ChannelStorageService.getInstance();
      const channelData = await channelStorage.syncAdminsFromChannel(this.token);

      let changed = false;
      for (const id of channelData.adminChatIds) {
        const num = Number(id);
        const validId = !isNaN(num) ? num : id;
        if (!this.adminChatIds.has(validId)) {
          this.adminChatIds.add(validId);
          changed = true;
        }
      }

      for (const u of channelData.adminUsernames) {
        const clean = u.replace(/^@/, '').toLowerCase().trim();
        if (!this.adminUsernames.has(clean)) {
          this.adminUsernames.add(clean);
          this.approvedUsernames.add(clean);
          changed = true;
        }
      }

      for (const user of channelData.approvedUsers) {
        const key = String(user.chatId).trim();
        if (!this.approvedUsers.has(key)) {
          this.approvedUsers.set(key, user);
          changed = true;
        }
      }

      if (changed) {
        console.log(`[TelegramBot] Successfully synced & saved admins from @theoutliness`);
        this.syncAndPersistState();
      }
    } catch (err) {
      console.warn("[TelegramBot] Error syncing channel admins:", err);
    }
  }

  public syncAndPersistState(forceChannelBackup: boolean = false): void {
    try {
      const persistence = BotPersistenceService.getInstance();
      const state = persistence.getState();

      state.adminChatIds = Array.from(this.adminChatIds);
      state.adminUsernames = Array.from(this.adminUsernames);
      state.approvedUsers = Array.from(this.approvedUsers.values());
      state.approvedUsernames = Array.from(this.approvedUsernames);
      state.pendingRequests = Array.from(this.pendingRequests.values());
      state.accessControlEnabled = this.accessControlEnabled;
      state.adminSecret = this.adminSecret;
      state.config = { ...this.config };
      state.customSystemPrompts = Object.fromEntries(
        Array.from(this.customSystemPrompts.entries()).map(([k, v]) => [String(k), v])
      );
      state.autoPostTopics = this.autoPostTopics || [];
      state.stats = { ...this.stats };

      // 1. Save synchronously to local disk
      persistence.saveStateSync();

      // 2. Asynchronously backup to permanent cloud channel storage (@theoutliness)
      // Guard: Only post backup to channel if restore is complete, or if forceChannelBackup is true,
      // or if we have users, to prevent an unhydrated container from overwriting channel storage.
      if (this.isChannelRestoreComplete || forceChannelBackup || this.approvedUsers.size > 1) {
        ChannelStorageService.getInstance().backupStateToChannel(this.token, state).catch(err => {
          console.warn("[TelegramBot] Channel backup error:", err);
        });
      }
    } catch (err) {
      console.error("[Telegram] Failed to synchronize persistent state:", err);
    }
  }

  public getApiBase(): string {
    return `https://api.telegram.org/bot${this.token}`;
  }

  public isAdmin(chatId: number | string, username?: string): boolean {
    const sId = String(chatId).trim();
    const nId = Number(chatId);

    // 1. Check direct admin chat ID match (string & numeric)
    for (const id of this.adminChatIds) {
      if (String(id).trim() === sId) return true;
      if (!isNaN(nId) && Number(id) === nId) return true;
    }

    // 2. Check admin username match (case-insensitive, '@'-stripped)
    if (username) {
      const cleanUser = username.replace(/^@/, '').toLowerCase().trim();
      if (cleanUser && this.adminUsernames.has(cleanUser)) return true;
      for (const u of this.adminUsernames) {
        if (u.replace(/^@/, '').toLowerCase().trim() === cleanUser) return true;
      }
    }

    return false;
  }

  public isAuthorized(chatId: number | string, username?: string): boolean {
    if (!this.accessControlEnabled) return true;
    if (this.isAdmin(chatId, username)) return true;

    const sId = String(chatId).trim();
    const nId = Number(chatId);

    // 1. Direct Map Key check
    if (this.approvedUsers.has(chatId) || this.approvedUsers.has(sId) || (!isNaN(nId) && this.approvedUsers.has(nId))) {
      return true;
    }

    // 2. Iterate approvedUsers list for ID or username match
    for (const [key, user] of this.approvedUsers.entries()) {
      if (String(key).trim() === sId || String(user.chatId).trim() === sId) return true;
      if (!isNaN(nId) && (Number(key) === nId || Number(user.chatId) === nId)) return true;
      if (username && user.username) {
        const u1 = user.username.replace(/^@/, '').toLowerCase().trim();
        const u2 = username.replace(/^@/, '').toLowerCase().trim();
        if (u1 && u1 === u2) return true;
      }
    }

    // 3. Check approved usernames set
    if (username) {
      const cleanUser = username.replace(/^@/, '').toLowerCase().trim();
      if (cleanUser && this.approvedUsernames.has(cleanUser)) return true;
      for (const u of this.approvedUsernames) {
        if (u.replace(/^@/, '').toLowerCase().trim() === cleanUser) return true;
      }
    }

    return false;
  }

  public async approveUser(identifier: number | string, approvedByName: string = "Administrator"): Promise<{ ok: boolean; message: string; targetChatId?: number | string }> {
    const raw = String(identifier).trim();
    let targetChatId: number | string | undefined;
    let targetUsername: string | undefined;
    let targetName: string | undefined;

    // Search in pending requests
    for (const [cId, req] of this.pendingRequests.entries()) {
      const matchChatId = String(cId).trim() === raw;
      const matchUsername = req.username && req.username.replace(/^@/, '').toLowerCase().trim() === raw.replace(/^@/, '').toLowerCase().trim();
      if (matchChatId || matchUsername) {
        targetChatId = cId;
        targetUsername = req.username;
        targetName = req.name;
        this.pendingRequests.delete(cId);
        break;
      }
    }

    if (!targetChatId) {
      if (raw.startsWith("@") || isNaN(Number(raw))) {
        targetUsername = raw.replace(/^@/, '').toLowerCase().trim();
        this.approvedUsernames.add(targetUsername);
        // Also register in approvedUsers map so they appear in student lists, stats, and cloud backups
        this.approvedUsers.set(`@${targetUsername}`, {
          chatId: `@${targetUsername}`,
          username: `@${targetUsername}`,
          name: targetName || `@${targetUsername}`,
          approvedAt: new Date().toISOString(),
          approvedBy: approvedByName,
        });
      } else {
        targetChatId = Number(raw);
      }
    }

    if (targetChatId) {
      const key = String(targetChatId).trim();
      this.approvedUsers.set(key, {
        chatId: targetChatId,
        username: targetUsername,
        name: targetName || "Student",
        approvedAt: new Date().toISOString(),
        approvedBy: approvedByName,
      });
      if (targetUsername) {
        this.approvedUsernames.add(targetUsername.replace(/^@/, '').toLowerCase().trim());
      }

      // Notify student in Telegram
      try {
        const welcomeMsg = `🎉 *Access Approved!*

Welcome to *Medchat Medical AI*. Your access has been approved by the administrator.

📚 *You can now use all features:*
• Ask any medical science or clinical question
• Generate Board-level practice MCQs (\`/mcq\`)
• Analyze histology slides & radiology images
• Download PDF study notes (\`/pdf\`)

Tap an option below or send your first medical question to begin!`;
        await this.sendMessage(targetChatId, welcomeMsg, "Markdown", this.getPersistentReplyKeyboard());
      } catch (err) {
        console.warn(`[Telegram] Could not notify user ${targetChatId}:`, err);
      }
    }

    this.syncAndPersistState(true);

    return {
      ok: true,
      message: `User ${targetUsername ? '@' + targetUsername : targetChatId} successfully approved!`,
      targetChatId,
    };
  }

  public async revokeUser(identifier: number | string): Promise<{ ok: boolean; message: string }> {
    const raw = String(identifier).trim();
    const cleanUser = raw.replace(/^@/, '').toLowerCase().trim();
    let removed = false;

    for (const [cId, user] of this.approvedUsers.entries()) {
      const matchChatId = String(cId).trim() === raw || String(user.chatId).trim() === raw;
      const matchUsername = user.username && user.username.replace(/^@/, '').toLowerCase().trim() === cleanUser;
      if (matchChatId || matchUsername) {
        this.approvedUsers.delete(cId);
        if (user.username) {
          this.approvedUsernames.delete(user.username.replace(/^@/, '').toLowerCase().trim());
        }
        removed = true;
        try {
          await this.sendMessage(cId, "⚠️ *Access Revoked*\n\nYour access to Medchat has been revoked by the administrator.", "Markdown");
        } catch {}
        break;
      }
    }

    if (this.approvedUsernames.has(cleanUser)) {
      this.approvedUsernames.delete(cleanUser);
      removed = true;
    }

    if (removed) {
      this.syncAndPersistState();
    }

    return {
      ok: true,
      message: removed ? `Access revoked for ${raw}.` : `User ${raw} was not found in approved list.`,
    };
  }

  public getAccessControlStatus() {
    return {
      accessControlEnabled: this.accessControlEnabled,
      adminSecretSet: Boolean(this.adminSecret),
      adminsCount: this.adminChatIds.size + this.adminUsernames.size,
      storageChannel: ChannelStorageService.getInstance().getChannelTarget(),
      storageChannelUrl: "https://t.me/theoutliness",
      admins: [
        ...Array.from(this.adminChatIds).map(id => ({ type: 'chatId', value: String(id) })),
        ...Array.from(this.adminUsernames).map(u => ({ type: 'username', value: `@${u}` })),
      ],
      approvedUsers: Array.from(this.approvedUsers.values()),
      approvedUsernames: Array.from(this.approvedUsernames),
      pendingRequests: Array.from(this.pendingRequests.values()),
    };
  }

  public setAccessControlEnabled(enabled: boolean) {
    this.accessControlEnabled = enabled;
    this.syncAndPersistState();
  }

  public addAdmin(identifier: number | string): boolean {
    const raw = String(identifier).trim();
    if (raw.startsWith("@") || isNaN(Number(raw))) {
      const clean = raw.replace(/^@/, '').toLowerCase().trim();
      this.adminUsernames.add(clean);
      this.approvedUsernames.add(clean);
    } else {
      const num = Number(raw);
      this.adminChatIds.add(!isNaN(num) ? num : raw);
      this.approvedUsers.set(raw, {
        chatId: !isNaN(num) ? num : raw,
        name: "Administrator",
        approvedAt: new Date().toISOString(),
        approvedBy: "Dashboard Admin",
      });
    }
    this.syncAndPersistState();
    return true;
  }

  public removeAdmin(identifier: number | string): boolean {
    const raw = String(identifier).trim();
    let removed = false;
    if (raw.startsWith("@") || isNaN(Number(raw))) {
      const clean = raw.replace(/^@/, '').toLowerCase().trim();
      if (this.adminUsernames.has(clean)) {
        this.adminUsernames.delete(clean);
        removed = true;
      }
    } else {
      const num = Number(raw);
      if (this.adminChatIds.has(num)) {
        this.adminChatIds.delete(num);
        removed = true;
      }
      if (this.adminChatIds.has(raw)) {
        this.adminChatIds.delete(raw);
        removed = true;
      }
    }
    if (removed) {
      this.syncAndPersistState();
    }
    return removed;
  }

  private getSystemPrompt(chatId: number | string): string {
    return this.customSystemPrompts.get(chatId) || this.config.systemInstruction;
  }

  public async initialize(): Promise<void> {
    console.log("[Telegram] Initializing medical bot manager...");
    await this.fetchBotInfo();
    await this.fetchWebhookInfo();

    if (this.webhookInfo?.url) {
      this.mode = 'webhook';
      console.log(`[Telegram] Bot webhook is registered to: ${this.webhookInfo.url}`);
    } else if (this.config.pollingEnabled) {
      this.mode = 'polling';
      this.startPolling();
    } else {
      this.mode = 'idle';
    }
  }

  public async fetchBotInfo(): Promise<any> {
    try {
      const res = await fetch(`${this.getApiBase()}/getMe`);
      const data = await res.json();
      if (data.ok) {
        this.botInfo = data.result;
        this.botError = null;
        console.log(`[Telegram] Bot connected successfully: @${this.botInfo.username} (${this.botInfo.first_name})`);
        return this.botInfo;
      } else {
        this.botError = data.description || "Failed to authenticate with Telegram";
        console.error(`[Telegram] Telegram getMe failed: ${this.botError}`);
        return null;
      }
    } catch (err: any) {
      this.botError = err.message || "Network error reaching Telegram API";
      console.error(`[Telegram] Error fetching bot info:`, err);
      return null;
    }
  }

  public async fetchWebhookInfo(): Promise<any> {
    try {
      const res = await fetch(`${this.getApiBase()}/getWebhookInfo`);
      const data = await res.json();
      if (data.ok) {
        this.webhookInfo = data.result;
        return this.webhookInfo;
      }
    } catch (err) {
      console.warn("[Telegram] Failed to fetch webhook info:", err);
    }
    return null;
  }

  public async setWebhook(url: string): Promise<{ ok: boolean; description?: string }> {
    this.stopPolling();
    try {
      const res = await fetch(`${this.getApiBase()}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.ok) {
        this.mode = 'webhook';
        await this.fetchWebhookInfo();
      }
      return data;
    } catch (err: any) {
      return { ok: false, description: err.message };
    }
  }

  public async deleteWebhook(): Promise<{ ok: boolean; description?: string }> {
    try {
      const res = await fetch(`${this.getApiBase()}/deleteWebhook`);
      const data = await res.json();
      if (data.ok) {
        await this.fetchWebhookInfo();
        if (this.config.pollingEnabled) {
          this.mode = 'polling';
          this.startPolling();
        } else {
          this.mode = 'idle';
        }
      }
      return data;
    } catch (err: any) {
      return { ok: false, description: err.message };
    }
  }

  public startPolling(): void {
    if (this.isPollingActive) return;
    this.isPollingActive = true;
    this.mode = 'polling';
    this.pollingAbortController = new AbortController();
    console.log("[Telegram] Starting long polling loop...");
    this.runPollingLoop();
  }

  public stopPolling(): void {
    if (!this.isPollingActive) return;
    this.isPollingActive = false;
    if (this.pollingAbortController) {
      this.pollingAbortController.abort();
      this.pollingAbortController = null;
    }
    if (this.mode === 'polling') {
      this.mode = 'idle';
    }
    console.log("[Telegram] Long polling stopped.");
  }

  private async runPollingLoop(): Promise<void> {
    while (this.isPollingActive) {
      try {
        const url = `${this.getApiBase()}/getUpdates?offset=${this.nextUpdateOffset}&timeout=20`;
        const res = await fetch(url, {
          signal: this.pollingAbortController?.signal,
        });

        if (!res.ok) {
          console.warn(`[Telegram] getUpdates HTTP error: ${res.status}`);
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.nextUpdateOffset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        } else if (!data.ok) {
          console.warn(`[Telegram] getUpdates returned error:`, data.description);
          if (data.description?.includes("webhook is active")) {
            console.log("[Telegram] Deleting webhook to enable long polling...");
            await fetch(`${this.getApiBase()}/deleteWebhook`);
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          break;
        }
        console.warn("[Telegram] Polling loop error:", err.message || err);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  public async sendChatAction(chatId: number | string, action: string = "typing"): Promise<void> {
    try {
      await fetch(`${this.getApiBase()}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
    } catch (e) {
      // Ignore chat action failures
    }
  }

  public async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await fetch(`${this.getApiBase()}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: text || "Processing medical question...",
        }),
      });
    } catch (e) {
      // Ignore callback acknowledgement errors
    }
  }

  public async sendMessage(
    chatId: number | string,
    text: string,
    parseMode: 'Markdown' | 'HTML' | null = 'Markdown',
    replyMarkup?: any
  ): Promise<boolean> {
    const MAX_LEN = 3900;
    const chunks: string[] = [];

    const safeText = text || "(Empty message)";

    if (safeText.length <= MAX_LEN) {
      chunks.push(safeText);
    } else {
      let remaining = safeText;
      while (remaining.length > 0) {
        if (remaining.length <= MAX_LEN) {
          chunks.push(remaining);
          break;
        }
        let splitIdx = remaining.lastIndexOf("\n\n", MAX_LEN);
        if (splitIdx === -1 || splitIdx < 1500) {
          splitIdx = remaining.lastIndexOf("\n", MAX_LEN);
        }
        if (splitIdx === -1 || splitIdx < 1500) {
          splitIdx = remaining.lastIndexOf(" ", MAX_LEN);
        }
        if (splitIdx === -1) {
          splitIdx = MAX_LEN;
        }
        chunks.push(remaining.substring(0, splitIdx).trim());
        remaining = remaining.substring(splitIdx).trim();
      }
    }

    let success = true;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk || chunk.trim().length === 0) continue;

      // Attach replyMarkup only to the final chunk
      const markup = i === chunks.length - 1 ? replyMarkup : undefined;

      try {
        const payload: any = {
          chat_id: chatId,
          text: parseMode === 'Markdown' ? sanitizeTelegramMarkdown(chunk) : chunk,
        };
        if (parseMode) payload.parse_mode = parseMode;
        if (markup) payload.reply_markup = markup;

        let res = await fetch(`${this.getApiBase()}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        let resData = await res.json();

        // If markdown entity parsing failed (Telegram 400), retry as clean plain text without parse_mode
        if (!resData.ok && payload.parse_mode) {
          delete payload.parse_mode;
          payload.text = chunk; // Send original plain text
          res = await fetch(`${this.getApiBase()}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          resData = await res.json();
        }

        // If still failed and has reply_markup, retry without reply_markup
        if (!resData.ok && payload.reply_markup) {
          delete payload.reply_markup;
          res = await fetch(`${this.getApiBase()}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          resData = await res.json();
        }

        if (!resData.ok && resData.description === 'Bad Request: message text is empty') {
           console.error(`[Telegram] Caught "message text is empty". Original chunk:`, JSON.stringify(chunk));
           payload.text = "⚠️ (Empty message content generated)";
           res = await fetch(`${this.getApiBase()}/sendMessage`, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify(payload),
           });
           resData = await res.json();
        }

        if (!resData.ok) {
          console.error(`[Telegram] Send message failed:`, resData);
          success = false;
        }
      } catch (err) {
        console.error(`[Telegram] Send message error:`, err);
        success = false;
      }
    }
    return success;
  }

  public async sendPhoto(
    chatId: number | string,
    photoUrl: string,
    caption?: string,
    replyMarkup?: any
  ): Promise<boolean> {
    try {
      const payload: any = {
        chat_id: chatId,
        photo: photoUrl,
      };
      if (caption) {
        payload.caption = sanitizeTelegramMarkdown(caption.slice(0, 1024));
        payload.parse_mode = 'Markdown';
      }
      if (replyMarkup) payload.reply_markup = replyMarkup;

      let res = await fetch(`${this.getApiBase()}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let data = await res.json();

      if (!data.ok && payload.parse_mode) {
        // Retry without Markdown if formatting caused error (400 Bad Request)
        delete payload.parse_mode;
        if (caption) payload.caption = caption.slice(0, 1024);
        res = await fetch(`${this.getApiBase()}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        data = await res.json();
      }

      if (!data.ok && payload.reply_markup) {
        delete payload.reply_markup;
        res = await fetch(`${this.getApiBase()}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        data = await res.json();
      }

      return Boolean(data.ok);
    } catch (err) {
      console.error('[Telegram] sendPhoto error:', err);
      return false;
    }
  }

  public async sendPhotoBuffer(
    chatId: number | string,
    fileBuffer: Buffer,
    fileName: string = "medical_table.png",
    caption?: string,
    replyMarkup?: any
  ): Promise<boolean> {
    try {
      const formData = new FormData();
      formData.append('chat_id', String(chatId));
      formData.append('photo', new Blob([fileBuffer], { type: 'image/png' }), fileName);
      if (caption) {
        formData.append('caption', sanitizeTelegramMarkdown(caption.slice(0, 1024)));
        formData.append('parse_mode', 'Markdown');
      }
      if (replyMarkup) {
        formData.append('reply_markup', JSON.stringify(replyMarkup));
      }

      let res = await fetch(`${this.getApiBase()}/sendPhoto`, {
        method: 'POST',
        body: formData,
      });
      let data = await res.json();

      if (!data.ok && caption) {
        // Retry without Markdown if syntax caused error
        const retryFormData = new FormData();
        retryFormData.append('chat_id', String(chatId));
        retryFormData.append('photo', new Blob([fileBuffer], { type: 'image/png' }), fileName);
        retryFormData.append('caption', caption.slice(0, 1024));
        if (replyMarkup) {
          retryFormData.append('reply_markup', JSON.stringify(replyMarkup));
        }
        res = await fetch(`${this.getApiBase()}/sendPhoto`, {
          method: 'POST',
          body: retryFormData,
        });
        data = await res.json();
      }

      return Boolean(data.ok);
    } catch (err) {
      console.error('[Telegram] sendPhotoBuffer error:', err);
      return false;
    }
  }

  /**
   * Intelligently sends medical responses to Telegram.
   * If the text contains markdown tables or tabular comparison diagrams,
   * it automatically renders the table into a high-resolution visual PNG image card
   * and inserts it between the preceding and succeeding text blocks right where it is needed!
   */
  public async sendSmartMedicalMessage(
    chatId: number | string,
    fullText: string,
    parseMode: 'Markdown' | 'HTML' | null = 'Markdown',
    replyMarkup?: any
  ): Promise<boolean> {
    if (!fullText) return false;

    // Apply medical symbol & spacing formatting
    const formattedText = cleanAndFormatMedicalText(fullText);

    // Check for tables in the response
    const { tables, parts } = extractMarkdownTables(formattedText);

    // If no markdown tables found, send as standard message
    if (tables.length === 0 || parts.length === 0) {
      return this.sendMessage(chatId, formattedText, parseMode, replyMarkup);
    }

    // Process parts sequentially: text -> visual table image -> text -> etc.
    let overallSuccess = true;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLastPart = i === parts.length - 1;
      const currentMarkup = isLastPart ? replyMarkup : undefined;

      if (part.type === 'text') {
        const textContent = part.content.trim();
        if (textContent.length > 0) {
          const sent = await this.sendMessage(chatId, textContent, parseMode, currentMarkup);
          if (!sent) overallSuccess = false;
        }
      } else if (part.type === 'table' && part.tableData) {
        try {
          await this.sendChatAction(chatId, "upload_photo");
          const pngBuffer = await renderTableToPngBuffer(part.tableData);
          const tableTitle = part.tableData.title || "Clinical Comparison & Reference Table";
          const caption = `📊 *${tableTitle}*`;

          const sent = await this.sendPhotoBuffer(
            chatId,
            pngBuffer,
            "medical_table.png",
            caption,
            currentMarkup
          );

          if (!sent) {
            // Fallback: send as monospace code block if photo failed
            await this.sendMessage(
              chatId,
              `📊 *${tableTitle}*\n\`\`\`\n${part.content}\n\`\`\``,
              'Markdown',
              currentMarkup
            );
          }
        } catch (err) {
          console.error("[Telegram] Error rendering table image:", err);
          // Graceful fallback to text
          await this.sendMessage(
            chatId,
            `📊 *Clinical Table:*\n\`\`\`\n${part.content}\n\`\`\``,
            'Markdown',
            currentMarkup
          );
        }
      }
    }

    return overallSuccess;
  }

  public async sendMediaGroup(
    chatId: number | string,
    media: Array<{ type: 'photo'; media: string; caption?: string; parse_mode?: string }>
  ): Promise<boolean> {
    try {
      const payload = {
        chat_id: chatId,
        media: media.map(m => ({
          ...m,
          caption: m.caption ? sanitizeTelegramMarkdown(m.caption.slice(0, 1024)) : undefined,
        })),
      };

      const res = await fetch(`${this.getApiBase()}/sendMediaGroup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) return true;

      // Retry without parse_mode on media items if markdown entities failed
      const plainMedia = media.map(m => {
        const { parse_mode, ...rest } = m;
        return rest;
      });
      const fallbackRes = await fetch(`${this.getApiBase()}/sendMediaGroup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, media: plainMedia }),
      });
      const fallbackData = await fallbackRes.json();
      if (fallbackData.ok) return true;

      console.warn('[Telegram] sendMediaGroup rejected:', fallbackData);
      return false;
    } catch (err) {
      console.error('[Telegram] sendMediaGroup network error:', err);
      return false;
    }
  }

  // Telegram Interactive Quiz Poll
  public async sendPoll(
    chatId: number | string,
    question: string,
    options: string[],
    correctOptionId: number,
    explanation?: string,
    isAnonymous: boolean = false,
    openPeriodSeconds?: number,
    replyToMessageId?: number
  ): Promise<any> {
    try {
      const cleanOptions = options && options.length >= 2
        ? options.slice(0, 10).map((opt) => String(opt).slice(0, 100))
        : ["Option A", "Option B", "Option C", "Option D"];

      const validCorrectId = Math.max(0, Math.min(cleanOptions.length - 1, correctOptionId));

      const payload: any = {
        chat_id: chatId,
        question: question.slice(0, 300),
        options: JSON.stringify(cleanOptions),
        type: 'quiz',
        correct_option_id: validCorrectId,
        is_anonymous: isAnonymous,
      };

      if (explanation && explanation.trim().length > 0) {
        payload.explanation = explanation.slice(0, 200);
      }

      if (openPeriodSeconds && openPeriodSeconds >= 5 && openPeriodSeconds <= 600) {
        payload.open_period = Math.round(openPeriodSeconds);
      }

      if (replyToMessageId) {
        payload.reply_to_message_id = replyToMessageId;
      }

      const res = await fetch(`${this.getApiBase()}/sendPoll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) {
        console.warn('[Telegram] sendPoll rejected:', data);
      }
      return data;
    } catch (err) {
      console.error('[Telegram] sendPoll network error:', err);
      return { ok: false, error: err };
    }
  }

  public async sendSmartQuiz(
    chatId: number | string,
    quiz: QuizData,
    prefixStem?: string,
    openPeriodSeconds?: number,
    isAnonymous: boolean = false
  ): Promise<void> {
    const rawQuestion = prefixStem ? `${prefixStem} ${quiz.question}` : quiz.question;
    const hasScenario = !!quiz.scenario && quiz.scenario.trim().length > 0;
    
    // Send the image first if available
    let photoMessageId: number | undefined;
    if (quiz.imageUrl) {
      try {
        const photoRes = await fetch(`${this.getApiBase()}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            photo: quiz.imageUrl
          })
        });
        const photoData = await photoRes.json();
        if (photoData.ok) {
          photoMessageId = photoData.result.message_id;
        }
      } catch (e) {
        console.error("Failed to send quiz image:", e);
      }
    }
    
    // If the question alone exceeds Telegram's limit (300) OR there is a scenario, we split it up.
    if (rawQuestion.length > 290 || hasScenario) {
      // Clean up the header to include the prefix (e.g. Q1/50)
      const headerPrefix = prefixStem ? ` ${prefixStem.replace(/[\[\]]/g, '')}` : "";
      const fullText = `📋 *Clinical Vignette${headerPrefix}:*\n\n${hasScenario ? quiz.scenario + "\n\n" : ""}${quiz.question}`;
      
      const payload: any = {
        chat_id: chatId,
        text: fullText.slice(0, 4000),
        parse_mode: "Markdown"
      };
      // Link the text to the photo if we just sent one
      if (photoMessageId) {
        payload.reply_to_message_id = photoMessageId;
      }
      
      const msgRes = await fetch(`${this.getApiBase()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const msgData = await msgRes.json();
      const replyToId = msgData?.ok ? msgData.result?.message_id : (photoMessageId || undefined);

      const pollData = await this.sendPoll(
        chatId,
        "💡 Select your answer below:",
        quiz.options,
        quiz.correctOptionId,
        quiz.explanation,
        isAnonymous,
        openPeriodSeconds,
        replyToId
      );

      // If there's a full rationale (usually for daily posts, but could be present here)
      if (quiz.fullRationale && pollData?.ok) {
        const safeRationale = quiz.fullRationale.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        await fetch(`${this.getApiBase()}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `<b>Rationale:</b>\n<tg-spoiler>${safeRationale}</tg-spoiler>`,
            parse_mode: "HTML",
            reply_to_message_id: pollData.result.message_id
          })
        });
      }

    } else {
      // It fits perfectly in a regular poll
      await this.sendPoll(
        chatId,
        rawQuestion,
        quiz.options,
        quiz.correctOptionId,
        quiz.explanation,
        isAnonymous,
        openPeriodSeconds,
        photoMessageId
      );
    }
  }

  public async fetchWikipediaMedicalImage(topic: string): Promise<string | null> {
    try {
      // First, we ask Gemini to give us a highly specific Wikipedia page title for the given topic that is likely to have a good clinical image.
      const prompt = `Given the broad medical topic "${topic}", provide exactly ONE specific medical diagnosis, condition, or sign that is highly likely to have a high-quality clinical photograph or diagram on its Wikipedia page. Return ONLY the Wikipedia page title string. No quotes, no formatting.`;
      
      const { text: pageTitle } = await generateGeminiReply(
        prompt,
        [],
        "You are an API that returns a single Wikipedia page title. Output only the title.",
        0.3,
        [],
        this.config.model
      );

      const cleanTitle = pageTitle.trim();
      const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=${encodeURIComponent(cleanTitle)}&pithumbsize=600&format=json`;
      const res = await fetch(apiUrl);
      const data = await res.json();
      
      if (data && data.query && data.query.pages) {
        const pages = Object.values(data.query.pages) as any[];
        if (pages.length > 0 && pages[0].thumbnail && pages[0].thumbnail.source) {
          return pages[0].thumbnail.source;
        }
      }
      return null;
    } catch (e) {
      console.error("Wikipedia Image Fetch Error:", e);
      return null;
    }
  }
  public async sendDocument(
    chatId: number | string,
    fileBuffer: Buffer,
    fileName: string,
    caption?: string
  ): Promise<boolean> {
    try {
      const formData = new FormData();
      formData.append('chat_id', String(chatId));
      formData.append('document', new Blob([fileBuffer], { type: 'application/pdf' }), fileName);
      if (caption) {
        formData.append('caption', caption.slice(0, 1024));
      }

      const res = await fetch(`${this.getApiBase()}/sendDocument`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) return true;

      console.warn('[Telegram] sendDocument rejected:', data);
      return false;
    } catch (err) {
      console.error('[Telegram] sendDocument network error:', err);
      return false;
    }
  }

  // Telegram File Retrieval for Vision & Document Processing
  public async getTelegramFilePath(fileId: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.getApiBase()}/getFile?file_id=${fileId}`);
      const data = await res.json();
      if (data.ok && data.result?.file_path) {
        return data.result.file_path;
      }
      console.warn("[Telegram] getFile error response:", data);
      return null;
    } catch (err) {
      console.error("[Telegram] getFile error:", err);
      return null;
    }
  }

  public async downloadTelegramFile(filePath: string): Promise<Buffer | null> {
    try {
      const fileUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      console.error("[Telegram] download file error:", err);
      return null;
    }
  }

  // Automated PPT Compiler & Exporter
  public async compileAndSendMedicalPpt(
    chatId: number | string,
    requestedTopic?: string,
    fallbackText?: string
  ): Promise<boolean> {
    await this.sendChatAction(chatId, "upload_document");

    const history = this.chatHistories.get(chatId) || [];
    const lastBotResp = this.lastBotResponseByChat.get(chatId);
    const lastModelTurn = [...history].reverse().find((t) => t.role === "model");

    let cleanTopic = (requestedTopic || "").trim();
    if (
      !cleanTopic ||
      /^(ppt|pptx|convert to ppt|make ppt|download ppt|export ppt|notes|this|it|previous response|last response|last message)$/i.test(cleanTopic)
    ) {
      cleanTopic = "";
    }

    let sourceContent =
      lastBotResp?.text ||
      lastModelTurn?.text ||
      fallbackText ||
      "";

    if (!sourceContent && cleanTopic && cleanTopic.length > 2) {
      try {
        await this.sendMessage(
          chatId,
          `⚙️ *Generating presentation on ${cleanTopic}...*\n_Preparing clinical content and compiling PPT..._`,
          "Markdown"
        );
        const { text: generatedText } = await generateGeminiReply(
          `Provide an exhaustive, high-yield clinical study guide on: "${cleanTopic}". Include core pathophysiology, diagnostic workup, first-line pharmacotherapy, and clinical pearls.`,
          [],
          this.getSystemPrompt(chatId),
          0.3,
          [],
          this.config.model
        );
        sourceContent = generatedText;
        this.lastBotResponseByChat.set(chatId, {
          text: generatedText,
          topic: cleanTopic,
          sourceType: 'general',
          timestamp: Date.now(),
        });
      } catch (err: any) {
        console.error("[Telegram] Error generating medical content for PPT:", err);
      }
    }

    if (!sourceContent) {
      await this.sendMessage(
        chatId,
        "ℹ️ *No previous response found to convert to PPT.*\n\nAsk any clinical question, request MCQs, or generate notes first, then send `/ppt` to download your presentation instantly!",
        "Markdown"
      );
      return false;
    }

    try {
      const docTitle = cleanTopic || lastBotResp?.topic || "Medical Study Notes";
      const pptBuffer = await generateMedicalPpt(sourceContent, docTitle);
      
      const safeFileName = `${docTitle.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 32)}.pptx`;
      const success = await this.sendDocument(chatId, pptBuffer, safeFileName, `📊 **${docTitle}**\n_Auto-compiled Presentation_`);

      if (success) {
        this.stats.documentsProcessed++;
        this.syncAndPersistState();
        return true;
      }
    } catch (err) {
      console.error("[Telegram] Error compiling PPT:", err);
      await this.sendMessage(chatId, "⚠️ Failed to compile the presentation document. Please try again.");
    }
    return false;
  }

  // Automated PDF Compiler & Exporter (Compiles previous response directly without extra Gemini prompts)
  public async compileAndSendMedicalPdf(
    chatId: number | string,
    requestedTopic?: string,
    fallbackText?: string
  ): Promise<boolean> {
    await this.sendChatAction(chatId, "upload_document");

    const history = this.chatHistories.get(chatId) || [];
    const lastBotResp = this.lastBotResponseByChat.get(chatId);
    const lastModelTurn = [...history].reverse().find((t) => t.role === "model");
    const lastUserTurn = [...history].reverse().find((t) => t.role === "user");

    let cleanTopic = (requestedTopic || "").trim();
    // Normalize if the topic is just a generic phrase or command
    if (
      !cleanTopic ||
      /^(pdf|convert to pdf|make pdf|download pdf|export pdf|notes|this|it|previous response|last response|last message|notes pdf|download|export)$/i.test(cleanTopic)
    ) {
      cleanTopic = "";
    }

    // Determine the source content to compile into PDF
    let sourceContent =
      lastBotResp?.text ||
      lastModelTurn?.text ||
      fallbackText ||
      "";

    // If no previous response text exists, but user asked for a specific topic, generate the medical notes first
    if (!sourceContent && cleanTopic && cleanTopic.length > 2) {
      try {
        await this.sendMessage(
          chatId,
          `⚙️ *Generating study notes on ${cleanTopic}...*\n_Preparing clinical content and compiling PDF..._`,
          "Markdown"
        );
        const { text: generatedText } = await generateGeminiReply(
          `Provide an exhaustive, high-yield clinical study guide on: "${cleanTopic}". Include core pathophysiology, diagnostic workup, first-line pharmacotherapy, and clinical pearls.`,
          [],
          this.getSystemPrompt(chatId),
          0.3,
          [],
          this.config.model
        );
        sourceContent = generatedText;
        this.lastBotResponseByChat.set(chatId, {
          text: generatedText,
          topic: cleanTopic,
          sourceType: 'general',
          timestamp: Date.now(),
        });
      } catch (err: any) {
        console.error("[Telegram] Error generating medical content for PDF:", err);
      }
    }

    if (!sourceContent || sourceContent.trim().length < 10) {
      await this.sendMessage(
        chatId,
        "ℹ️ *No previous response found to convert to PDF.*\n\nAsk any clinical question, request MCQs, or generate notes first, then tap *📄 Export PDF Notes* or send `/pdf` to download your PDF instantly!",
        "Markdown"
      );
      return false;
    }

    try {
      // Determine clean metadata for the PDF document directly from the previous response
      const docTopic = cleanTopic || lastBotResp?.topic || "Clinical Medicine & Board Review";
      const docTitle = cleanTopic
        ? `${cleanTopic.slice(0, 40)} — Clinical Notes`
        : (lastBotResp?.topic && lastBotResp.topic.length > 3 ? lastBotResp.topic : "Medchat Clinical Study Notes");

      // Generate the PDF buffer directly from the previous response text (fast & 100% offline/in-memory)
      const pdfBuffer = await generateMedicalPdf(sourceContent, {
        title: docTitle,
        topic: `${docTopic} • Board Review`,
        author: "Medchat Medical AI (Clinical Reference)",
        userQuestion: lastUserTurn?.text,
      });

      const safeFileName = `${docTitle.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 32)}.pdf`;
      const caption = `🩺 *${docTitle}*\n📄 _Compiled directly from your previous medical consultation._`;

      const sent = await this.sendDocument(
        chatId,
        pdfBuffer,
        safeFileName,
        caption
      );

      if (!sent) {
        await this.sendMessage(chatId, "⚠️ Could not deliver PDF document. Please try again.");
        return false;
      }

      this.logActivity({
        id: `pdf-gen-${Date.now()}`,
        chatId,
        userName: "Student",
        userMessage: requestedTopic ? `/pdf ${requestedTopic}` : "/pdf (Direct compiled response)",
        aiResponse: `[Generated PDF Document: ${safeFileName}]`,
        latencyMs: 80,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'telegram',
      });

      return true;
    } catch (err: any) {
      console.error("[Telegram] Direct PDF compilation error:", err);
      await this.sendMessage(chatId, `⚠️ Could not compile PDF document: ${err.message || "Unknown error"}. Please try again.`);
      return false;
    }
  }

  // Telegram Keyboards
  public getMainInlineKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: "⚡️ Rapid Fire Exam (Timed)", callback_data: "action_rapidfire_random" },
          { text: "📊 Interactive Quiz", callback_data: "action_quiz_random" },
        ],
        [
          { text: "🎯 Clinical Board MCQ", callback_data: "action_mcq_random" },
          { text: "💡 Medical Exam Tips", callback_data: "action_exam_tips" },
        ],
        [
          { text: "📄 Export PDF Notes", callback_data: "action_export_pdf" },
          { text: "⏱️ Timer Settings", callback_data: "action_timer_menu" },
        ],
        [
          { text: "📸 Medical Vision & Docs Guide", callback_data: "action_multimodal_guide" },
        ],
        [
          { text: "🫀 Anatomy & Physio", callback_data: "action_mcq_anatomy" },
          { text: "💊 Pharmacology", callback_data: "action_mcq_pharm" },
        ],
        [
          { text: "🔬 Pathology & Micro", callback_data: "action_mcq_path" },
          { text: "🧬 Biochemistry", callback_data: "action_mcq_biochem" },
        ],
        [
          { text: "🧠 High-Yield Mnemonics", callback_data: "action_mnemonics" },
          { text: "⏱️ Exam Strategy", callback_data: "action_strategy" },
        ],
      ],
    };
  }

  public getPersistentReplyKeyboard() {
    return {
      keyboard: [
        [{ text: "⚡️ Rapid Fire Exam" }, { text: "📊 Interactive Quiz" }],
        [{ text: "📄 Export PDF Notes" }, { text: "⏱️ Timer Settings" }],
        [{ text: "🧹 Reset Memory" }, { text: "⚙️ Custom Prompt" }],
      ],
      resize_keyboard: true,
      persistent: true,
    };
  }

  public getMcqActionButtons(subject: string = "general") {
    return {
      inline_keyboard: [
        [
          { text: `🔄 Another ${subject.toUpperCase()} MCQ`, callback_data: `action_mcq_${subject.toLowerCase()}` },
          { text: "📄 Export PDF", callback_data: "action_export_pdf" },
        ],
        [
          { text: "💊 Pharmacology MCQ", callback_data: "action_mcq_pharm" },
          { text: "🔬 Pathology MCQ", callback_data: "action_mcq_path" },
        ],
        [
          { text: "🫀 Anatomy MCQ", callback_data: "action_mcq_anatomy" },
          { text: "🧬 Biochemistry MCQ", callback_data: "action_mcq_biochem" },
        ],
      ],
    };
  }

  public getExamTipsActionButtons() {
    return {
      inline_keyboard: [
        [
          { text: "🎯 Practice Board MCQ", callback_data: "action_mcq_random" },
          { text: "💡 Another Exam Tip", callback_data: "action_exam_tips" },
        ],
        [
          { text: "🧠 High-Yield Mnemonics", callback_data: "action_mnemonics" },
          { text: "⏱️ Vignette Time Strategy", callback_data: "action_strategy" },
        ],
      ],
    };
  }

  public getGeneralStudyActionButtons() {
    return {
      inline_keyboard: [
        [
          { text: "🎯 Practice Board MCQ", callback_data: "action_mcq_random" },
          { text: "💡 Medical Exam Tip", callback_data: "action_exam_tips" },
        ],
        [
          { text: "📸 Medical Vision & Docs Guide", callback_data: "action_multimodal_guide" },
        ],
      ],
    };
  }

  // Core Medical Content Generators
  public async generateClinicalMcq(
    subject: string = "general",
    userPrompt: string = "",
    chatId?: number | string
  ): Promise<{ text: string; latencyMs: number }> {
    const subjectTitle =
      subject === "anatomy"
        ? "Anatomy, Neuroanatomy, or Embryology"
        : subject === "physio" || subject === "physiology"
        ? "Medical Physiology or Organ System Pathophysiology"
        : subject === "pharm" || subject === "pharmacology"
        ? "Medical Pharmacology (Drug Mechanisms, Interactions, or Adverse Effects)"
        : subject === "path" || subject === "pathology"
        ? "Medical Pathology (Histology, Lab Findings, and Morphologic Disease Patterns)"
        : subject === "micro" || subject === "microbiology"
        ? "Medical Microbiology & Infectious Diseases"
        : subject === "biochem" || subject === "biochemistry"
        ? "Medical Biochemistry & Clinical Genetics"
        : subject.trim().length > 0 && subject !== "general"
        ? subject
        : "High-Yield Medical Science (Anatomy, Physiology, Biochemistry, Micro, Pathology, or Pharmacology)";

    const wantsScenario = /\b(clinical case|clinical scenario|vignette|patient|case study|clinical vignette)\b/i.test(userPrompt);
    let count = 1;
    const countMatch = userPrompt.match(/\b(\d+)\s*(?:mcqs|mcq|questions|items)\b/i);
    if (countMatch && countMatch[1]) {
      count = Math.min(Math.max(1, parseInt(countMatch[1], 10)), 30);
    }

    const scenarioDirective = wantsScenario
      ? `Include authentic patient clinical vignettes with age, sex, presenting symptoms, vitals, and relevant labs/diagnostics.`
      : `CRITICAL USER INTENT DIRECTIVE: The user prompt is "${userPrompt}". The user asked for direct questions on "${subjectTitle}". The user DID NOT request a clinical case or patient scenario! DO NOT fabricate or prepend any patient clinical vignettes or case stories. Write clear, direct question stems directly testing ${subjectTitle} knowledge.`;

    const prompt = `Generate exactly ${count} authentic, high-yield, medical examination Multiple Choice Question(s) (MCQ) specifically testing ${subjectTitle}.

${scenarioDirective}

Requirements for each question:
1. Question Stem: Clear, higher-order reasoning question testing ${subjectTitle} directly.
2. 4 to 5 Choices: Labeled A), B), C), D), and optionally E).
3. Full Answer & Detailed Explanation:
   - Correct Option identified clearly.
   - Biological/Anatomical mechanism breakdown.
   - Distractor Rationale: Specifically why each incorrect option is false and when it would apply instead.
   - High-Yield Board Pearl: A 1-2 sentence golden takeaway or mnemonic for exam day.`;

    const result = await generateGeminiReply(
      prompt,
      [],
      this.getSystemPrompt(chatId || ""),
      this.config.temperature,
      [],
      this.config.model
    );
    this.stats.mcqsGenerated += count;
    return result;
  }

  public async generateExamTips(topic: string = "general", chatId?: number | string): Promise<{ text: string; latencyMs: number }> {
    const prompt = topic === "mnemonics"
      ? `Provide 3 to 4 extremely high-yield, memorable medical mnemonics for medical students preparing for board exams (USMLE / NEET-PG / PLAB). Include mnemonics covering Pharmacology, Pathology, or Biochemistry with clinical context explaining what each letter or keyword represents and why it is commonly tested.`
      : topic === "strategy"
      ? `Provide an elite, high-yield guide on "How to Master Long Medical Clinical Vignettes Under Exam Time Pressure" for medical students.
Include:
1. The "Reverse Reading" technique (Stem first, then vignette).
2. How to highlight anchor buzzwords vs distractor noise.
3. Process of elimination framework for 50/50 options.
4. Time budget rule per question.`
      : `Provide high-yield medical exam preparation tips and high-yield mnemonics for medical students studying Anatomy, Physiology, Biochemistry, Microbiology, Pathology, and Pharmacology.
Include:
1. Active recall & spaced repetition strategies specifically for memorizing drug classes and metabolic pathways.
2. 2 high-yield medical mnemonics with immediate clinical exam applications.
3. Common examiner trap to avoid on board questions.`;

    const result = await generateGeminiReply(
      prompt,
      [],
      this.getSystemPrompt(chatId || ""),
      this.config.temperature,
      [],
      this.config.model
    );
    this.stats.examTipsShared++;
    return result;
  }

  // Interactive Telegram-style Medical Quiz Generator (Supports up to 50 Quizzes & Strict Difficulty/Complexity Intent)
  public async generateInteractiveQuizzes(
    userPrompt: string,
    topicOverride?: string,
    countOverride?: number,
    attachments: MediaAttachment[] = []
  ): Promise<{
    quizzes: QuizData[];
    textSummary: string;
    latencyMs: number;
    count: number;
    topic: string;
    allowScenario: boolean;
    isHarder: boolean;
    isComplex: boolean;
  }> {
    const startTime = Date.now();
    const intent = parseUserPromptIntent(userPrompt, topicOverride || "General Medical Sciences");
    const count = countOverride !== undefined && countOverride > 0 ? countOverride : intent.count;
    const topic = topicOverride || intent.topic;
    const allowScenario = intent.allowScenario;
    const isHarder = intent.isHarder;
    const isComplex = intent.isComplex;
    const isWebQuizRequested = intent.isWebQuizRequested;

    // We generate quizzes in batches of at most 10 for parallel speed and reliability
    const batchSizes: number[] = [];
    let remaining = count;
    while (remaining > 0) {
      const b = Math.min(remaining, 10);
      batchSizes.push(b);
      remaining -= b;
    }

    const batchPromises = batchSizes.map((batchCount, batchIdx) =>
      this.generateQuizBatch(
        topic,
        batchCount,
        allowScenario,
        isHarder,
        isComplex,
        userPrompt,
        batchIdx,
        batchSizes.length,
        attachments,
        isWebQuizRequested
      )
    );

    const batchResults = await Promise.all(batchPromises);
    let allQuizzes: QuizData[] = [];
    for (const batch of batchResults) {
      allQuizzes.push(...batch);
    }

    // Safety fallback if empty or failed
    if (allQuizzes.length === 0) {
      allQuizzes = [
        {
          scenario: allowScenario ? "A 52-year-old patient presents with classic clinical findings for evaluation." : "",
          question: `Which of the following is a classic high-yield feature of ${topic}?`,
          options: ["Primary characteristic", "Secondary finding", "Incorrect distractor A", "Incorrect distractor B"],
          correctOptionId: 0,
          explanation: `Tests core fundamental principles of ${topic}.`,
          fullRationale: `Comprehensive review of ${topic} for medical board preparation.`,
          topic,
        },
      ];
    }

    // Ensure we keep up to the requested count
    allQuizzes = allQuizzes.slice(0, count);

    // Enforce scenario rules strictly
    for (let i = 0; i < allQuizzes.length; i++) {
      const q = allQuizzes[i];
      if (!allowScenario) {
        q.scenario = "";
      } else if (q.scenario) {
        q.scenario = q.scenario.trim();
      }

      q.question = (q.question || `Question ${i + 1} on ${topic}`).slice(0, 290);
      if (!Array.isArray(q.options) || q.options.length < 2) {
        q.options = ["Option A", "Option B", "Option C", "Option D"];
      }
      q.options = q.options.slice(0, 5).map((o) => String(o).slice(0, 95));
      q.correctOptionId =
        typeof q.correctOptionId === "number" &&
        q.correctOptionId >= 0 &&
        q.correctOptionId < q.options.length
          ? q.correctOptionId
          : 0;
      q.explanation = (q.explanation || `Key concept in ${topic}.`).slice(0, 195);
      q.topic = topic;
    }

    // Post-generation image fetching for Web Quizzes
    if (isWebQuizRequested) {
      for (let i = 0; i < allQuizzes.length; i++) {
        if (allQuizzes[i].wikipediaTitleForImage) {
          const imgUrl = await this.fetchWikipediaMedicalImage(allQuizzes[i].wikipediaTitleForImage!);
          if (imgUrl) {
             allQuizzes[i].imageUrl = imgUrl;
          }
        }
      }
    }

    this.stats.mcqsGenerated += allQuizzes.length;
    const latencyMs = Date.now() - startTime;

    const textSummary = allQuizzes
      .map((q, idx) => {
        const header = allQuizzes.length > 1 ? `### **Quiz ${idx + 1} of ${allQuizzes.length}: ${topic}**\n\n` : "";
        const sc = q.scenario ? `*Clinical Scenario:*\n${q.scenario}\n\n` : "";
        const opts = q.options.map((opt, oIdx) => `${String.fromCharCode(65 + oIdx)}) ${opt}`).join("\n");
        const ans = `✅ *Correct Answer:* ${String.fromCharCode(65 + q.correctOptionId)}) ${q.options[q.correctOptionId]}`;
        const exp = `💡 *Explanation:* ${q.explanation}`;
        const rat = q.fullRationale ? `\n📖 *Detailed Rationale:*\n${q.fullRationale}` : "";
        return `${header}${sc}*Question:* ${q.question}\n\n${opts}\n\n${ans}\n\n${exp}${rat}`;
      })
      .join("\n\n---\n\n");

    return {
      quizzes: allQuizzes,
      textSummary,
      latencyMs,
      count: allQuizzes.length,
      topic,
      allowScenario,
      isHarder,
      isComplex,
    };
  }

  private async generateQuizBatch(
    topic: string,
    count: number,
    allowScenario: boolean,
    isHarder: boolean,
    isComplex: boolean,
    userPrompt: string,
    batchIndex: number,
    totalBatches: number,
    attachments: MediaAttachment[] = [],
    isWebQuizRequested: boolean = false
  ): Promise<QuizData[]> {
    const focus = totalBatches > 1
      ? `(Batch ${batchIndex + 1} of ${totalBatches}: Focus on diverse aspects, mechanisms, structures, and common exam traps for ${topic})`
      : "";

    const scenarioDirective = allowScenario
      ? `Include a realistic, concise clinical patient case in "scenario" for each question.`
      : `CRITICAL INSTRUCTION: The user asked for direct questions on "${topic}" without requesting a patient scenario. Set "scenario" to "" (empty string) for every question, and make each "question" test ${topic} directly.`;

    const difficultyDirective = isHarder
      ? `🔥 HARDER LEVEL DIRECTIVE: Formulate higher-order 2nd-order or 3rd-order clinical reasoning questions with challenging, subtle distractors, tricky board traps, and nuanced clinical distinctions.`
      : "";

    const complexityDirective = isComplex
      ? `🧬 COMPLEXITY DIRECTIVE: Formulate complex multi-step medical questions featuring multimorbid conditions, atypical disease presentations, or diagnostic dilemmas.`
      : "";

    const attachmentDirective = attachments.length > 0
      ? `📸 IMAGE ATTACHMENT DIRECTIVE: You have received ${attachments.length} medical image(s). Base the quiz questions and findings directly on the visual structures, histology, or radiographic patterns visible in the uploaded image(s).`
      : "";

    const webQuizDirective = isWebQuizRequested
      ? `🌐 WEB QUIZ DIRECTIVE: The user requested a "web quiz" with images. For EACH question, you MUST provide a "wikipediaTitleForImage" field. This field must contain the EXACT Wikipedia page title (e.g. "Erythema migrans", "Tetralogy of Fallot") of the specific condition or anatomical structure tested in the question, so the system can fetch its public image. Choose conditions highly likely to have clinical images on Wikipedia.`
      : "";

    const prompt = `Generate exactly ${count} distinct, high-yield, interactive multiple-choice quiz questions specifically testing "${topic}". ${focus}

USER INTENT & CUSTOM INSTRUCTIONS:
The user specifically requested: "${userPrompt}"
${difficultyDirective}
${complexityDirective}
${attachmentDirective}
${webQuizDirective}

SCENARIO RULE:
${scenarioDirective}

Respond ONLY with a valid JSON array containing exactly ${count} object(s), with NO markdown formatting, NO backticks, and NO surrounding text:
[
  {
    "scenario": "${allowScenario ? "Patient vignette" : ""}",
    "question": "Clear, direct question stem testing ${topic} directly (MAXIMUM 280 characters)",
    "options": [
      "Option A (MAXIMUM 95 characters)",
      "Option B (MAXIMUM 95 characters)",
      "Option C (MAXIMUM 95 characters)",
      "Option D (MAXIMUM 95 characters)"
    ],
    "correctOptionId": 0,
    "explanation": "High-yield concise rationale shown upon answering (MAXIMUM 195 characters)",
    "fullRationale": "Comprehensive medical explanation detailing why the correct option is right, why each distractor is wrong, and an exam pearl/mnemonic.",
    "topic": "${topic}"${isWebQuizRequested ? `,\n    "wikipediaTitleForImage": "Wikipedia page title for related image"` : ""}
  }
]

CRITICAL CONSTRAINTS:
1. Return EXACTLY ${count} quiz objects in the JSON array.
2. "question" MUST be under 280 characters.
3. Exactly 4 or 5 "options", each MUST be under 95 characters.
4. "correctOptionId" MUST be an integer between 0 and options.length - 1.
5. "explanation" MUST be under 195 characters.
6. Return valid JSON array ONLY.`;

    try {
      const { text: rawJson } = await generateGeminiReply(
        prompt,
        [],
        "You are an elite Medical Board Examiner creating interactive quiz questions strictly adhering to user intent. Output valid JSON array only.",
        0.3,
        attachments,
        this.config.model
      );

      const cleaned = rawJson.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        return parsed;
      } else if (parsed && typeof parsed === "object") {
        return [parsed];
      }
      return [];
    } catch (err) {
      console.warn(`[Quiz Batch ${batchIndex + 1}] Generation error:`, err);
      return [];
    }
  }

  // Generate Long-Text Clinical Case Questions (Supports up to 50 comprehensive patient cases with full explanations)
  public async generateLongTextCaseQuestions(
    userPrompt: string,
    topicOverride?: string,
    countOverride?: number,
    attachments: MediaAttachment[] = [],
    chatId?: number | string
  ): Promise<{
    cases: LongTextCaseQuestion[];
    textSummary: string;
    latencyMs: number;
    count: number;
    topic: string;
  }> {
    const startTime = Date.now();
    const intent = parseUserPromptIntent(userPrompt, topicOverride || "Clinical Medicine & Pathophysiology");
    const count = countOverride !== undefined && countOverride > 0 ? countOverride : intent.count;
    const topic = topicOverride || intent.topic;
    const isHarder = intent.isHarder;
    const isComplex = intent.isComplex;

    // Batch in groups of 5 cases for maximum depth and to prevent truncation
    const batchSizes: number[] = [];
    let remaining = count;
    while (remaining > 0) {
      const b = Math.min(remaining, 5);
      batchSizes.push(b);
      remaining -= b;
    }

    let currentCaseOffset = 0;
    const batchPromises = batchSizes.map((batchCount, batchIdx) => {
      const offset = currentCaseOffset;
      currentCaseOffset += batchCount;
      return this.generateLongCaseBatch(
        topic,
        batchCount,
        offset,
        isHarder,
        isComplex,
        userPrompt,
        batchIdx,
        batchSizes.length,
        attachments,
        chatId
      );
    });

    const batchResults = await Promise.all(batchPromises);
    let allCases: LongTextCaseQuestion[] = [];
    for (const batch of batchResults) {
      allCases.push(...batch);
    }

    // Fallback if empty
    if (allCases.length === 0) {
      allCases = [
        {
          caseNumber: 1,
          title: `Comprehensive Clinical Case: ${topic}`,
          vignette: `A 58-year-old patient presents to the emergency department with a 3-day history of worsening clinical symptoms. Past medical history is notable for hypertension and hyperlipidemia. Vital signs on presentation reveal blood pressure 148/92 mmHg, pulse 88 bpm, respiratory rate 18 breaths/min, and oxygen saturation 97% on ambient air. Physical examination reveals unremarkable cardiorespiratory findings. Laboratory workup and targeted diagnostic testing are initiated.`,
          question: `Which of the following pathophysiological mechanisms or therapeutic interventions is most appropriate for this patient?`,
          options: [
            "A) First-line targeted pharmacological intervention",
            "B) Alternative secondary pathway inhibition",
            "C) Distractor option testing atypical manifestation",
            "D) Contraindicated drug class in this setting",
            "E) Observation with serial biomarker monitoring"
          ],
          correctAnswer: "A) First-line targeted pharmacological intervention",
          mechanism: `The primary cellular and organ-system mechanism underlying this condition involves targeted receptor modulation and restoring physiologic homeostasis.`,
          distractorAnalysis: `Options B, C, D, and E represent common clinical distractors that apply in distinct etiologies or alternative stages of disease.`,
          clinicalPearl: `Always anchor diagnostic reasoning on key chronological markers and vitals before finalizing the pharmacological intervention.`,
        }
      ];
    }

    allCases = allCases.slice(0, count);
    for (let i = 0; i < allCases.length; i++) {
      allCases[i].caseNumber = i + 1;
    }

    this.stats.mcqsGenerated += allCases.length;
    const latencyMs = Date.now() - startTime;

    const textSummary = allCases
      .map((c) => {
        const title = `### **Case ${c.caseNumber} of ${allCases.length}: ${c.title || topic}**\n\n`;
        const vig = `**Clinical Presentation & Vignette:**\n${c.vignette}\n\n`;
        const q = `**Question:**\n${c.question}\n\n`;
        const opts = `**Options:**\n${c.options.join("\n")}\n\n`;
        const ans = `✅ **Correct Answer:** ${c.correctAnswer}\n\n`;
        const mech = `🧬 **Pathophysiological Mechanism:**\n${c.mechanism}\n\n`;
        const dist = `🎯 **Distractor Analysis:**\n${c.distractorAnalysis}\n\n`;
        const pearl = `💡 **High-Yield Clinical Pearl:**\n${c.clinicalPearl}`;
        return `${title}${vig}${q}${opts}${ans}${mech}${dist}${pearl}`;
      })
      .join("\n\n---\n\n");

    return {
      cases: allCases,
      textSummary,
      latencyMs,
      count: allCases.length,
      topic,
    };
  }

  private async generateLongCaseBatch(
    topic: string,
    count: number,
    caseOffset: number,
    isHarder: boolean,
    isComplex: boolean,
    userPrompt: string,
    batchIndex: number,
    totalBatches: number,
    attachments: MediaAttachment[] = [],
    chatId?: number | string
  ): Promise<LongTextCaseQuestion[]> {
    const focus = totalBatches > 1
      ? `(Batch ${batchIndex + 1} of ${totalBatches}: Focus on diverse patient presentations, rare vs common variants, and high-yield board scenarios for ${topic})`
      : "";

    const difficultyDirective = isHarder
      ? `🔥 HARDER LEVEL DIRECTIVE: Formulate higher-order 2nd-order or 3rd-order diagnostic and mechanistic questions with tricky, plausible distractors, classic board traps, and subtle clinical clues.`
      : "";

    const complexityDirective = isComplex
      ? `🧬 COMPLEX MULTIMORBID CASES: Include complex multi-organ disease presentations, atypical clinical courses, polypharmacy interactions, or nuanced management dilemmas.`
      : "";

    const prompt = `Generate exactly ${count} authentic, comprehensive, LONG-TEXT clinical case examination questions on "${topic}". ${focus}

USER INSTRUCTIONS:
The user requested: "${userPrompt}"
${difficultyDirective}
${complexityDirective}

MANDATORY LONG VIGNETTE REQUIREMENTS:
1. "vignette": MUST be an extensive, realistic 2-3 paragraph clinical vignette (200-350 words) including:
   - Patient demographics, setting (Emergency Dept, Outpatient Clinic, ICU), and chronological timeline of symptoms.
   - Past medical history, medications, allergies, and social/family history.
   - Full Vital Signs (Temperature, HR, BP with orthostatics if relevant, RR, SpO2).
   - Focused Physical Exam findings across multiple relevant organ systems.
   - Complete Diagnostic Labs (CBC, comprehensive metabolic panel, arterial blood gas, specific cardiac/inflammatory biomarkers, CSF/synovial fluid, ECG findings, or Imaging reports).
2. "question": High-order reasoning question stem testing mechanism, diagnosis, or pharmacotherapy.
3. "options": Exactly 5 options labeled A) through E).
4. "correctAnswer": Exact correct choice with letter and text.
5. "mechanism": In-depth biological, physiological, or pharmacological explanation.
6. "distractorAnalysis": Exhaustive breakdown of why each incorrect option is wrong and under what clinical scenario it would be chosen.
7. "clinicalPearl": High-yield board exam takeaway or mnemonic.

Respond ONLY with a valid JSON array of ${count} objects:
[
  {
    "caseNumber": ${caseOffset + 1},
    "title": "Descriptive Case Title (e.g. 54-Year-Old Male with Acute Epigastric Pain & Hypotension)",
    "vignette": "Extensive 2-3 paragraph clinical vignette with full history, vitals, exam, and lab values...",
    "question": "Which of the following is the most likely cellular mechanism...?",
    "options": ["A) ...", "B) ...", "C) ...", "D) ...", "E) ..."],
    "correctAnswer": "A) ...",
    "mechanism": "Comprehensive pathophysiological mechanism breakdown...",
    "distractorAnalysis": "Detailed distractor analysis explaining why B, C, D, E are incorrect...",
    "clinicalPearl": "High-yield board pearl or exam trap..."
  }
]`;

    try {
      const { text: rawJson } = await generateGeminiReply(
        prompt,
        [],
        "You are an elite Medical Board Examiner creating comprehensive, long-text clinical case question banks. Output valid JSON array only.",
        0.4,
        attachments,
        this.config.model
      );

      const cleaned = rawJson.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        return parsed;
      } else if (parsed && typeof parsed === "object") {
        return [parsed];
      }
      return [];
    } catch (err) {
      console.warn(`[Long Case Batch ${batchIndex + 1}] Error:`, err);
      return [];
    }
  }

  // Handle Long Text Case Questions Workflow in Telegram
  public async handleLongTextCaseQuestions(
    chatId: number | string,
    sender: any,
    userName: string,
    userHandle: string | undefined,
    text: string,
    intent: UserPromptIntent,
    attachments: MediaAttachment[] = []
  ): Promise<void> {
    const count = intent.count;
    const topic = intent.topic;

    await this.sendChatAction(chatId, "typing");
    await this.sendMessage(
      chatId,
      `📚 *Generating ${count} comprehensive long-text clinical case question${count > 1 ? "s" : ""} on ${topic}...*\n${intent.isHarder ? "_Applying advanced board-level difficulty with 2nd/3rd-order reasoning..._\n" : ""}${intent.isComplex ? "_Structuring complex multimorbid cases and diagnostic dilemmas..._\n" : ""}_Preparing in-depth patient vignettes, physical exams, laboratory workups, and complete rationales..._`,
      "Markdown"
    );

    try {
      const { cases, textSummary, latencyMs } = await this.generateLongTextCaseQuestions(
        text,
        topic,
        count,
        attachments,
        chatId
      );

      // Group cases into messages under 3500 chars each for clean, reliable delivery
      const messagesToSend: string[] = [];
      let currentMessage = "";

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const caseBlock = `📋 *CASE ${c.caseNumber} OF ${cases.length}: ${sanitizeTelegramMarkdown(c.title || topic)}*

*Clinical Presentation & Patient Vignette:*
${sanitizeTelegramMarkdown(c.vignette)}

*Question:*
${sanitizeTelegramMarkdown(c.question)}

*Options:*
${c.options.map((opt) => `${sanitizeTelegramMarkdown(opt)}`).join("\n")}

*Answer & Educational Breakdown:*
✅ *Correct Answer:* ${sanitizeTelegramMarkdown(c.correctAnswer)}

🧬 *Pathophysiological Mechanism:*
${sanitizeTelegramMarkdown(c.mechanism)}

🎯 *Distractor Rationale:*
${sanitizeTelegramMarkdown(c.distractorAnalysis)}

💡 *Clinical Pearl:* ${sanitizeTelegramMarkdown(c.clinicalPearl)}`;

        if (currentMessage.length + caseBlock.length + 20 > 3500 && currentMessage.length > 0) {
          messagesToSend.push(currentMessage);
          currentMessage = caseBlock;
        } else {
          currentMessage = currentMessage ? `${currentMessage}\n\n---\n\n${caseBlock}` : caseBlock;
        }
      }

      if (currentMessage.length > 0) {
        messagesToSend.push(currentMessage);
      }

      for (let i = 0; i < messagesToSend.length; i++) {
        await this.sendMessage(chatId, messagesToSend[i], "Markdown");
        if (i < messagesToSend.length - 1) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      // Follow-up message with instant PDF export option
      await this.sendMessage(
        chatId,
        `✅ *All ${cases.length} comprehensive clinical case questions on ${topic} delivered!*\n\n📄 _Tap_ *📄 Export PDF Notes* _or send_ \`/pdf\` _anytime to download this complete question bank as a PDF document._`,
        "Markdown"
      );

      const history = this.chatHistories.get(chatId) || [];
      history.push({ role: "user", text });
      history.push({ role: "model", text: textSummary });
      this.chatHistories.set(chatId, history.slice(-12));

      this.lastBotResponseByChat.set(chatId, {
        text: textSummary,
        topic: `Long Case Questions (${topic})`,
        sourceType: 'general',
        timestamp: Date.now(),
      });

      this.logActivity({
        id: `case-q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: text,
        aiResponse: `[Long Case Questions: ${cases.length} cases on ${topic}]`,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: "success",
        source: "telegram",
      });
    } catch (err: any) {
      console.error("[Telegram] Long text case question generation error:", err);
      await this.sendMessage(chatId, "⚠️ Error generating clinical case questions. Please try again or request a smaller batch.");
    }
  }

  // Handle Interactive Quiz Polls Workflow in Telegram (Supports up to 50 polls!)
  public async handleInteractiveQuizzes(
    chatId: number | string,
    sender: any,
    userName: string,
    userHandle: string | undefined,
    text: string,
    intent?: UserPromptIntent,
    attachments: MediaAttachment[] = []
  ): Promise<void> {
    const promptIntent = intent || parseUserPromptIntent(text);
    const count = promptIntent.count;
    const topic = promptIntent.topic;
    const allowScenario = promptIntent.allowScenario;

    await this.sendChatAction(chatId, "typing");
    if (count > 1) {
      await this.sendMessage(
        chatId,
        `📚 *Generating ${count} interactive quiz poll${count > 1 ? "s" : ""} on ${topic}...*\n${promptIntent.isHarder ? "_Applying advanced board-level difficulty with 2nd/3rd-order reasoning..._\n" : ""}${promptIntent.isComplex ? "_Structuring complex multi-step reasoning questions..._\n" : ""}Sending Telegram polls sequentially:`,
        "Markdown"
      );
    }

    try {
      const { quizzes, textSummary, latencyMs } = await this.generateInteractiveQuizzes(
        text,
        topic,
        count,
        attachments
      );

      for (let i = 0; i < quizzes.length; i++) {
        const quiz = quizzes[i];

        // Format question stem (prefix with index if multiple quizzes)
        const prefix = quizzes.length > 1
          ? `[${i + 1}/${quizzes.length}]`
          : undefined;

        // Send native Telegram interactive Quiz Poll
        await this.sendSmartQuiz(
          chatId,
          quiz,
          prefix
        );

        // Delay slightly between polls to ensure clean order in Telegram
        if (quizzes.length > 1 && i < quizzes.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      if (quizzes.length === 1) {
        await this.sendMessage(
          chatId,
          `💡 *Tap your choice in the quiz above!* You'll see instant answer feedback and high-yield explanation.\n\n📄 _Want downloadable PDF notes? Reply with_ \`/pdf\` _anytime._`,
          "Markdown"
        );
      } else {
        await this.sendMessage(
          chatId,
          `✅ *All ${quizzes.length} interactive quiz polls on ${topic} delivered!*\n💡 Tap your choice on each poll above to test your recall.\n📄 _Reply with_ \`/pdf\` _anytime to export full questions and explanations to a PDF document._`,
          "Markdown"
        );
      }

      const history = this.chatHistories.get(chatId) || [];
      history.push({ role: "user", text });
      history.push({ role: "model", text: textSummary });
      this.chatHistories.set(chatId, history.slice(-12));

      this.lastBotResponseByChat.set(chatId, {
        text: textSummary,
        topic: `Interactive Quiz (${topic})`,
        sourceType: 'quiz',
        timestamp: Date.now(),
      });

      this.logActivity({
        id: `quiz-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: text,
        aiResponse: `[Interactive Quiz: ${quizzes.length} poll(s) on ${topic}]`,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: "success",
        source: "telegram",
      });
    } catch (err: any) {
      console.error("[Telegram] Quiz generation error:", err);
      await this.sendMessage(chatId, "⚠️ Error generating interactive quiz polls. Please try again.");
    }
  }

  // High-Yield Rapid Fire Timed Exam Simulator (Supports custom question count + adjustable countdown timers per poll)
  public async handleRapidFireExam(
    chatId: number | string,
    sender: any,
    userName: string,
    userHandle: string | undefined,
    text: string,
    intent?: UserPromptIntent,
    attachments: MediaAttachment[] = []
  ): Promise<void> {
    const promptIntent = intent || parseUserPromptIntent(text);
    const count = promptIntent.count > 1 ? promptIntent.count : (/\b\d+\b/.test(text) ? promptIntent.count : 5);
    const topic = promptIntent.topic || "General Medical Board Review";
    const countdownSeconds = promptIntent.customTimerSeconds || this.config.rapidFireCountdownSeconds || 30;
    const clampedTimer = Math.max(5, Math.min(600, countdownSeconds));

    await this.sendChatAction(chatId, "typing");

    // Introductory Banner
    const introBanner = `⚡️ *HIGH-YIELD RAPID-FIRE EXAM SIMULATOR*
━━━━━━━━━━━━━━━━━━━━━
🎯 *Target Topic:* \`${topic}\`
📊 *Question Count:* \`${count} Single-Best-Answer MCQs\`
⏱️ *Countdown Timer:* \`${clampedTimer}s per question\` (Active Ticking)
🔒 *Auto-Lock:* _Poll automatically closes and locks in answers when timer reaches 0!_
━━━━━━━━━━━━━━━━━━━━━
🚀 *Generating ${count} rapid-fire board items... Get ready!*`;

    await this.sendMessage(chatId, introBanner, "Markdown");

    try {
      const { quizzes, textSummary, latencyMs } = await this.generateInteractiveQuizzes(
        text,
        topic,
        count,
        attachments
      );

      for (let i = 0; i < quizzes.length; i++) {
        const quiz = quizzes[i];

        // Format question stem with rapid fire indicator and countdown timer badge
        const prefix = `[⚡️ Q${i + 1}/${quizzes.length} • ⏱️${clampedTimer}s]`;

        // Send native Telegram interactive Quiz Poll with open_period active countdown timer
        await this.sendSmartQuiz(
          chatId,
          quiz,
          prefix,
          clampedTimer
        );

        // Wait for the countdown timer to finish plus a 2-second buffer before sending the next question
        if (quizzes.length > 1 && i < quizzes.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, (clampedTimer + 2) * 1000));
        }
      }

      // Completion & summary banner
      const completionBanner = `🏁 *RAPID-FIRE SPRINT COMPLETED!*
━━━━━━━━━━━━━━━━━━━━━
✅ *Delivered:* \`${quizzes.length} Timed MCQs\`
🎯 *Discipline:* \`${topic}\`
⏱️ *Pace:* \`${clampedTimer}s per question\`
━━━━━━━━━━━━━━━━━━━━━
💡 *Performance Tip:* Tap any closed poll above to review your score and read the high-yield rationale.

• 📄 _Type_ \`/pdf\` _to export this rapid-fire set as a study PDF._
• ⚡️ _Type_ \`/rapidfire ${count} ${topic}\` _to run another timed session._
• ⏱️ _Type_ \`/timer <seconds>\` _to adjust your countdown timer (e.g. \`/timer 20\`)._`;

      await this.sendMessage(chatId, completionBanner, "Markdown");

      const history = this.chatHistories.get(chatId) || [];
      history.push({ role: "user", text });
      history.push({ role: "model", text: textSummary });
      this.chatHistories.set(chatId, history.slice(-12));

      this.lastBotResponseByChat.set(chatId, {
        text: textSummary,
        topic: `Rapid Fire Exam (${topic})`,
        sourceType: 'quiz',
        timestamp: Date.now(),
      });

      this.logActivity({
        id: `rapid-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: text,
        aiResponse: `[Rapid Fire: ${quizzes.length} timed poll(s) (${clampedTimer}s) on ${topic}]`,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: "success",
        source: "telegram",
      });
    } catch (err: any) {
      console.error("[Telegram] Rapid Fire generation error:", err);
      await this.sendMessage(chatId, "⚠️ Error generating rapid-fire questions. Please try again with `/rapidfire`.");
    }
  }

  // Backwards-compatible single interactive quiz generator
  public async generateInteractiveQuiz(topic: string = "general"): Promise<{
    quiz: QuizData;
    textSummary: string;
    latencyMs: number;
  }> {
    const res = await this.generateInteractiveQuizzes(topic, topic, 1);
    return {
      quiz: res.quizzes[0],
      textSummary: res.textSummary,
      latencyMs: res.latencyMs,
    };
  }

  public async handleCallbackQuery(callbackQuery: any): Promise<void> {
    const queryId = callbackQuery.id;
    const data = callbackQuery.data || "";
    const chatId = callbackQuery.message?.chat?.id;
    const fromUser = callbackQuery.from || {};
    const userName = fromUser.first_name || "Doctor / Student";
    const userHandle = fromUser.username ? `@${fromUser.username}` : undefined;

    if (!chatId) {
      await this.answerCallbackQuery(queryId, "Action received");
      return;
    }

    // 1. Handle Admin Approval / Denial Callbacks
    if (data.startsWith("auth_approve_")) {
      const targetChatId = data.replace("auth_approve_", "");
      const adminHandle = userHandle || userName;

      // Auto-claim admin if no admin is set yet
      if (this.adminChatIds.size === 0 && this.adminUsernames.size === 0) {
        const numId = Number(chatId);
        this.adminChatIds.add(!isNaN(numId) ? numId : chatId);
        if (fromUser.username) {
          const clean = fromUser.username.replace(/^@/, '').toLowerCase().trim();
          this.adminUsernames.add(clean);
          this.approvedUsernames.add(clean);
        }
        this.syncAndPersistState();
      }

      if (!this.isAdmin(chatId, fromUser.username)) {
        await this.answerCallbackQuery(queryId, "⚠️ Only administrators can approve users.");
        return;
      }

      const res = await this.approveUser(targetChatId, adminHandle);
      await this.answerCallbackQuery(queryId, `✅ Approved user!`);
      await this.sendMessage(chatId, `✅ *Approval Processed:*\n\n${res.message}`, "Markdown");
      return;
    }

    if (data.startsWith("auth_deny_")) {
      const targetChatId = data.replace("auth_deny_", "");
      if (!this.isAdmin(chatId, fromUser.username) && (this.adminChatIds.size > 0 || this.adminUsernames.size > 0)) {
        await this.answerCallbackQuery(queryId, "⚠️ Only administrators can deny requests.");
        return;
      }
      this.pendingRequests.delete(targetChatId);
      this.pendingRequests.delete(String(targetChatId).trim());
      this.syncAndPersistState();
      await this.answerCallbackQuery(queryId, `❌ Access request denied.`);
      await this.sendMessage(chatId, `❌ Request for ID \`${targetChatId}\` was dismissed.`, "Markdown");
      return;
    }

    // 2. Authorization check for other callback actions
    if (!this.isAuthorized(chatId, fromUser.username)) {
      await this.answerCallbackQuery(queryId, "🔒 Access restricted. Please request access from the admin.");
      return;
    }

    await this.answerCallbackQuery(queryId, "Generating high-yield medical content...");
    await this.sendChatAction(chatId, "typing");

    try {
      if (data.startsWith("action_rapidfire_")) {
        const subject = data.replace("action_rapidfire_", "");
        const cleanSubject = subject === "random" ? "General Medical Board Review" : subject;
        await this.handleRapidFireExam(
          chatId,
          fromUser,
          userName,
          userHandle,
          `rapidfire 5 ${cleanSubject}`
        );
      } else if (data === "action_timer_menu") {
        const currentTimer = this.config.rapidFireCountdownSeconds || 30;
        await this.sendMessage(
          chatId,
          `⏱️ *Rapid Fire Countdown Timer Settings*\n\n` +
          `• *Current Default Countdown:* \`${currentTimer} seconds\`\n` +
          `• *Allowed Range:* 5 to 600 seconds\n\n` +
          `🔧 *To Change Countdown Duration:*\n` +
          `Send \`/timer <seconds>\` anytime, for example:\n` +
          `• \`/timer 15\` (Ultra-fast 15s blitz)\n` +
          `• \`/timer 30\` (Standard 30s board pace)\n` +
          `• \`/timer 45\` (Moderate 45s analysis)\n` +
          `• \`/timer 60\` (Relaxed 60s deep reasoning)\n\n` +
          `⚡️ *Run a Timed Exam:* \`/rapidfire 10 cardiology\` or \`/rapidfire 5 pharm 20s\``,
          "Markdown"
        );
      } else if (data.startsWith("action_quiz_")) {
        const subject = data.replace("action_quiz_", "");
        const cleanSubject = subject === "random" ? "General Medical Board Review" : subject;
        const { quiz, textSummary, latencyMs } = await this.generateInteractiveQuiz(cleanSubject);

        await this.sendSmartQuiz(chatId, quiz);
        await this.sendMessage(
          chatId,
          `💡 *Select your answer above!* Instant explanation will appear.\n📄 _Type_ \`/pdf\` _to download complete notes._`,
          "Markdown"
        );

        this.logActivity({
          id: `cb-quiz-${Date.now()}`,
          chatId,
          userName,
          userMessage: `[Button] Interactive Quiz (${cleanSubject})`,
          aiResponse: `[Interactive Quiz Poll: ${quiz.question}]`,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          source: 'telegram',
        });
      } else if (data === "action_export_pdf") {
        await this.compileAndSendMedicalPdf(chatId);
      } else if (data.startsWith("action_mcq_")) {
        const subject = data.replace("action_mcq_", "");
        const cleanSubject = subject === "random" ? "medical sciences" : subject;
        const { text, latencyMs } = await this.generateClinicalMcq(cleanSubject);
        await this.sendMessage(chatId, text, "Markdown");

        this.lastBotResponseByChat.set(chatId, {
          text,
          topic: `Clinical MCQ (${cleanSubject})`,
          sourceType: 'mcq',
          timestamp: Date.now(),
        });

        this.logActivity({
          id: `cb-mcq-${Date.now()}`,
          chatId,
          userName,
          userMessage: `[Button] Generate ${cleanSubject} MCQ`,
          aiResponse: text,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          source: 'telegram',
        });
      } else if (data === "action_exam_tips" || data === "action_mnemonics" || data === "action_strategy") {
        const topic = data === "action_mnemonics" ? "mnemonics" : data === "action_strategy" ? "strategy" : "general";
        const { text, latencyMs } = await this.generateExamTips(topic);
        await this.sendMessage(chatId, text, "Markdown");

        this.lastBotResponseByChat.set(chatId, {
          text,
          topic: `Exam Tips & Mnemonics (${topic})`,
          sourceType: 'exam_tips',
          timestamp: Date.now(),
        });

        this.logActivity({
          id: `cb-tip-${Date.now()}`,
          chatId,
          userName,
          userMessage: `[Button] Medical Exam Tip (${topic})`,
          aiResponse: text,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          source: 'telegram',
        });
      } else if (data === "action_multimodal_guide") {
        const guideText = `📸 *Medical Image Vision & Document Processing Guide*

Medchat is equipped with multimodal perception powered by Google Gemini!

🔬 *Medical Image Vision:*
• *Histopathology & Micrographs:* Send micrographs to detect tissue type, staining, key pathognomonic cellular hallmarks (e.g. Reed-Sternberg, Auer rods, Councilman bodies, Mallory-Denk), and molecular pathology.
• *Radiology & Imaging:* Send chest X-rays, CT scans, MRI, or ultrasound images for anatomical landmark identification, radiographic signs, and differential diagnoses.
• *ECG & Rhythm Strips:* Send 12-lead ECGs or rhythm strips for rate, rhythm, axis, interval calculation, and ischemia/infarction localization.
• *Anatomy Diagrams & Dissections:* Review vascular branching, plexus nerves, fascial compartments, and foramina.
• *Board Questions with Images:* Send question screenshots to get the answer, clinical pearl, and distractor breakdowns!

📄 *Document & PDF Reading:*
• *Lecture Handouts & Study Slides:* Upload PDF or text summaries to generate executive clinical summaries and high-yield concepts.
• *Clinical Guidelines & Papers:* Medchat extracts high-yield disease mechanisms, first-line drug recommendations, and diagnostic algorithms.
• *Auto-Generated Board MCQs:* Every uploaded document or image automatically generates practice MCQs to test your retention!

💡 *Try it right now:* Tap the paperclip 📎 or photo icon in Telegram to send any medical slide or document!`;
        await this.sendMessage(chatId, guideText, "Markdown");
      }
    } catch (err: any) {
      console.error("[Telegram] Callback action error:", err);
      await this.sendMessage(chatId, "⚠️ Failed to generate medical content right now. Please try again.");
    }
  }

  // Media Batching & Multi-Image Album Queue
  public queueMediaUpdate(
    chatId: number | string,
    sender: any,
    userName: string,
    userHandle: string | undefined,
    item: PendingMediaBatchItem,
    mediaGroupId?: string
  ): void {
    const batchKey = mediaGroupId ? `mg_${chatId}_${mediaGroupId}` : `burst_${chatId}`;
    const existing = this.mediaBatchMap.get(batchKey);

    if (existing) {
      clearTimeout(existing.timer);
      existing.items.push(item);
      existing.timer = setTimeout(() => {
        this.processMediaBatch(batchKey);
      }, 850);
    } else {
      const timer = setTimeout(() => {
        this.processMediaBatch(batchKey);
      }, 850);

      this.mediaBatchMap.set(batchKey, {
        items: [item],
        timer,
        chatId,
        sender,
        userName,
        userHandle,
        startTime: Date.now(),
      });
    }
  }

  private async processMediaBatch(batchKey: string): Promise<void> {
    const batch = this.mediaBatchMap.get(batchKey);
    if (!batch) return;
    this.mediaBatchMap.delete(batchKey);

    const { chatId, sender, userName, userHandle, items } = batch;
    if (items.length === 0) return;

    // Combine any captions provided in the batch
    const captions = items
      .map((it) => it.caption?.trim())
      .filter((c): c is string => Boolean(c && c.length > 0));
    const combinedCaption = Array.from(new Set(captions)).join(" | ").trim();

    // Check if this is a single PDF document
    if (items.length === 1 && items[0].mimeType === "application/pdf") {
      const it = items[0];
      await this.handleDocumentMessage(
        chatId,
        sender,
        userName,
        userHandle,
        { file_id: it.fileId, file_name: it.fileName || "medical_document.pdf", mime_type: "application/pdf" },
        combinedCaption
      );
      return;
    }

    // Download all images in parallel
    await this.sendChatAction(chatId, "typing");
    if (items.length > 1) {
      await this.sendMessage(
        chatId,
        `🩺 *Received ${items.length} medical images together!* Downloading and processing all slides/scans in parallel with Gemini multimodal vision...`,
        "Markdown"
      );
    }

    const downloadedAttachments: MediaAttachment[] = [];
    const downloadPromises = items.map(async (it, idx) => {
      try {
        const filePath = await this.getTelegramFilePath(it.fileId);
        if (!filePath) return;
        const fileBuffer = await this.downloadTelegramFile(filePath);
        if (!fileBuffer) return;
        const detectedMime = it.mimeType || (filePath.endsWith(".png") ? "image/png" : "image/jpeg");
        downloadedAttachments.push({
          mimeType: detectedMime,
          data: fileBuffer.toString("base64"),
          fileName: it.fileName || `medical_image_${idx + 1}.jpg`,
        });
      } catch (err) {
        console.warn(`[Telegram] Error downloading batch item ${idx + 1}:`, err);
      }
    });

    await Promise.all(downloadPromises);

    if (downloadedAttachments.length === 0) {
      await this.sendMessage(chatId, "⚠️ Could not retrieve the uploaded image(s) from Telegram. Please try re-sending.");
      return;
    }

    await this.handleBatchMediaMessage(chatId, sender, userName, userHandle, downloadedAttachments, combinedCaption);
  }

  // Handle Batch of 1 to 10+ Medical Images Analyzed Together
  public async handleBatchMediaMessage(
    chatId: number | string,
    sender: any,
    userName: string,
    userHandle: string | undefined,
    attachments: MediaAttachment[],
    caption: string = ""
  ): Promise<void> {
    if (!this.config.botActive) {
      await this.sendMessage(chatId, "⚠️ The medical AI assistant is currently paused by the administrator.");
      return;
    }

    this.stats.lastActiveAt = new Date().toISOString();
    this.stats.totalMessages++;
    if (!this.chatHistories.has(chatId)) {
      this.stats.activeChatsCount++;
    }

    const intent = parseUserPromptIntent(caption || "Medical Image Analysis");

    // 1. If user explicitly requested interactive quiz polls based on the images
    if (intent.isPollRequested || (caption && /\b(quizzes?|polls?|interactive quiz)\b/i.test(caption))) {
      await this.handleInteractiveQuizzes(
        chatId,
        sender,
        userName,
        userHandle,
        caption || `Interactive Quiz on ${attachments.length} Images`,
        intent,
        attachments
      );
      return;
    }

    // 2. If user requested long text case questions based on the images
    if (intent.isTextCaseRequested || (intent.isLongCase && (intent.count > 1 || /\b(questions?|cases?)\b/i.test(caption)))) {
      await this.handleLongTextCaseQuestions(
        chatId,
        sender,
        userName,
        userHandle,
        caption || `Long Text Clinical Cases on ${attachments.length} Images`,
        intent,
        attachments
      );
      return;
    }

    // 3. Multimodal Analysis of All Images Together
    await this.sendChatAction(chatId, "typing");
    const numImages = attachments.length;

    const promptText = caption
      ? `[USER QUERY & SPECIFIC INSTRUCTIONS ACCOMPANYING ${numImages} UPLOADED IMAGE(S)]:
"${caption}"

CRITICAL INSTRUCTIONS FOR MULTI-IMAGE CLINICAL ANALYSIS:
1. Thoroughly and specifically address every question, request, or comparison the user specified in their prompt: "${caption}".
2. Individual Image Breakdown:
   - Systematically inspect each image (${numImages > 1 ? "Image 1 through Image " + numImages : "Image 1"}).
   - Identify anatomical structures, relations, neurovascular supply, radiographic signs/densities, or cellular hallmarks/stains.
3. Comparative & Cross-Image Correlation:
   - Correlate findings across all ${numImages} image(s) (e.g. multi-plane views, disease progression, differential comparisons, histopathologic confirmation of radiology).
4. Pathophysiological & Pharmacological Insights:
   - Underlying cellular mechanisms, first-line clinical management, and diagnostic algorithms.
5. High-Yield Board Exam Pearls & Mnemonics:
   - Classic board associations, exam traps, and memorable high-yield takeaways.
${intent.isHarder ? "\n🔥 HARDER LEVEL: Provide advanced subspecialty distinctions and challenging board pearls." : ""}
${intent.isComplex ? "\n🧬 COMPLEXITY: Highlight atypical presentations and multidisciplinary management." : ""}`
      : `Analyze all ${numImages} uploaded medical image(s) together with comprehensive anatomical, histological, and radiological precision:

1. 🫀 **Comprehensive Survey of Each Image (1 to ${numImages})**:
   - For Anatomical Diagrams/Dissections: Identify every visible structure, spatial boundaries, neurovascular pedicles, and clinical relations.
   - For Histopathology/Micrographs: Staining method, tissue of origin, pathognomonic cellular hallmarks (e.g. inclusion bodies, architectural disarray), and disease etiology.
   - For Radiology/Imaging (X-ray, CT, MRI, US): Modality, projection, systematic survey, radiological signs, and tissue densities.
   - For ECGs: Rate, rhythm, axis, intervals, ischemic changes, and chamber hypertrophy.
2. 🔄 **Cross-Image Comparative Correlation**:
   - Synthesize how the findings across these ${numImages} images integrate, compare, or contrast.
3. 🧬 **Pathophysiological Mechanisms & Clinical Management**:
   - Core molecular mechanisms, gold-standard workup, and first-line therapeutic interventions.
4. 💡 **High-Yield Board Exam Pearls & Mnemonics**:
   - High-yield USMLE / NEET-PG associations, buzzwords, and examiner traps to avoid.

CRITICAL: DO NOT attach an unsolicited quiz or MCQ. Provide exhaustive clinical and anatomical synthesis only.`;

    const history = this.chatHistories.get(chatId) || [];

    try {
      const { text: reply, latencyMs } = await generateGeminiReply(
        promptText,
        history,
        this.getSystemPrompt(chatId),
        this.config.temperature,
        attachments,
        this.config.model
      );

      history.push({ role: "user", text: `[${numImages} Medical Images Uploaded${caption ? `: ${caption}` : ""}]` });
      history.push({ role: "model", text: reply });
      this.chatHistories.set(chatId, history.slice(-12));

      const detectedTopic = caption ? caption.slice(0, 45) : `${numImages} Image Multimodal Analysis`;
      this.lastBotResponseByChat.set(chatId, {
        text: reply,
        topic: detectedTopic,
        sourceType: "image",
        timestamp: Date.now(),
      });

      this.stats.imagesProcessed += numImages;
      this.totalLatencySum += latencyMs;
      this.totalLatencyCount++;
      this.stats.averageLatencyMs = Math.round(this.totalLatencySum / this.totalLatencyCount);

      await this.sendSmartMedicalMessage(chatId, reply, "Markdown");

      this.logActivity({
        id: `img-batch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: caption ? `[${numImages} Images] ${caption}` : `[${numImages} Medical Images]`,
        aiResponse: reply,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: "success",
        source: "telegram",
        mediaType: "image",
      });
    } catch (err: any) {
      console.error("[Telegram] Batch image processing error:", err);
      this.stats.totalErrors++;
      await this.sendMessage(
        chatId,
        "⚠️ Failed to complete batch image analysis. Please try again with fewer images or lower resolution."
      );
    }
  }

  // Handle Medical Image (Histology, Radiology, ECG, Dermatology, Anatomy)
  private async handleImageMessage(
    chatId: number | string,
    sender: any,
    userName: string,
    userHandle: string | undefined,
    fileId: string,
    caption: string,
    mimeType: string = "image/jpeg",
    fileName?: string
  ): Promise<void> {
    this.queueMediaUpdate(
      chatId,
      sender,
      userName,
      userHandle,
      {
        fileId,
        mimeType,
        fileName: fileName || "medical_image.jpg",
        caption,
        messageId: Date.now(),
        timestamp: Date.now(),
      }
    );
  }

  // Handle Medical Document (PDF, Lecture Slides, Clinical Guidelines, Notes)
  private async handleDocumentMessage(
    chatId: number | string,
    sender: any,
    userName: string,
    userHandle: string | undefined,
    doc: any,
    caption: string
  ): Promise<void> {
    if (!this.config.botActive) {
      await this.sendMessage(chatId, "⚠️ The medical AI assistant is currently paused by the administrator.");
      return;
    }

    this.stats.lastActiveAt = new Date().toISOString();
    this.stats.totalMessages++;
    if (!this.chatHistories.has(chatId)) {
      this.stats.activeChatsCount++;
    }

    const fileName = doc.file_name || "medical_document.pdf";
    const mimeType = doc.mime_type || "application/pdf";
    const fileSize = doc.file_size || 0;

    // If an image was sent as uncompressed document, route directly to image vision handler
    const isImageFile = mimeType.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(fileName);
    if (isImageFile) {
      await this.handleImageMessage(chatId, sender, userName, userHandle, doc.file_id, caption, mimeType, fileName);
      return;
    }

    // Telegram Bot API limit for downloading is 20MB
    if (fileSize > 20 * 1024 * 1024) {
      await this.sendMessage(chatId, `⚠️ The document *${fileName}* is too large (${Math.round(fileSize / (1024 * 1024))}MB). Telegram bots support downloading files up to 20MB.`, "Markdown");
      return;
    }

    await this.sendChatAction(chatId, "typing");
    await this.sendMessage(chatId, `📄 *Processing medical document:* \`${fileName}\`\n\nReading clinical content and extracting high-yield medical concepts and mechanisms with Gemini 3.8...`, "Markdown");

    const filePath = await this.getTelegramFilePath(doc.file_id);
    if (!filePath) {
      await this.sendMessage(chatId, "⚠️ Could not retrieve the document from Telegram servers. Please try again.");
      return;
    }

    const fileBuffer = await this.downloadTelegramFile(filePath);
    if (!fileBuffer) {
      await this.sendMessage(chatId, "⚠️ Failed to download the document. Please try again.");
      return;
    }

    const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
    const isText = mimeType.startsWith("text/") || fileName.toLowerCase().endsWith(".txt") || fileName.toLowerCase().endsWith(".md") || fileName.toLowerCase().endsWith(".csv") || fileName.toLowerCase().endsWith(".json");
    const isPpt = fileName.toLowerCase().endsWith(".ppt") || fileName.toLowerCase().endsWith(".pptx") || mimeType.includes("presentation");

    let promptText = "";
    let attachments: MediaAttachment[] = [];
    const docIntent = parseUserPromptIntent(caption || `Document ${fileName}`);

    // Skip Gemini analysis for PPT files if we don't want to compile text in a PPT
    if (isPpt) {
      await this.sendMessage(chatId, `📊 *Presentation File Received:* \`${fileName}\`\n\n_Note: PowerPoint (PPT/PPTX) files are safely stored but not currently parsed by the AI for text compilation. To extract text, please upload as a PDF._`, "Markdown");
      return;
    }

    if (docIntent.isPollRequested || (caption && /\b(quizzes?|polls?)\b/i.test(caption))) {
      await this.sendMessage(chatId, `🎯 *Generating interactive quiz polls based on your uploaded document (${fileName})...*`, "Markdown");
      const docAttachments: MediaAttachment[] = isPdf ? [{ mimeType: "application/pdf", data: fileBuffer.toString("base64"), fileName }] : [];
      await this.handleInteractiveQuizzes(chatId, sender, userName, userHandle, caption || `Quiz on ${fileName}`, docIntent, docAttachments);
      return;
    }

    if (docIntent.isTextCaseRequested || (docIntent.isLongCase && (docIntent.count > 1 || /\b(questions?|cases?)\b/i.test(caption)))) {
      await this.sendMessage(chatId, `📚 *Generating clinical case questions based on your uploaded document (${fileName})...*`, "Markdown");
      const docAttachments: MediaAttachment[] = isPdf ? [{ mimeType: "application/pdf", data: fileBuffer.toString("base64"), fileName }] : [];
      await this.handleLongTextCaseQuestions(chatId, sender, userName, userHandle, caption || `Cases on ${fileName}`, docIntent, docAttachments);
      return;
    }

    if (isPdf) {
      const base64Data = fileBuffer.toString("base64");
      attachments = [{
        mimeType: "application/pdf",
        data: base64Data,
        fileName,
      }];
      promptText = caption
        ? `[User Query on Medical Document '${fileName}']: "${caption}"

Perform a thorough, expert-level clinical and scientific analysis of this document:
1. Address the user's specific inquiry: "${caption}" thoroughly and directly, referencing key facts, tables, or recommendations in the document.
2. 📋 **Executive Clinical & Scientific Summary** (Scope, disease definitions, diagnostic criteria, clinical takeaways).
3. 🧬 **Core Pathophysiological / Pharmacological / Anatomical Mechanisms** (Cellular pathways, drug receptors, anatomical relationships).
4. 💊 **Clinical Management & Therapeutics** (Gold standard tests, first-line pharmacotherapy, contraindications).
5. 💡 **High-Yield Board Exam Pearls & Mnemonics** (Exam associations, classic buzzwords, common pitfalls).`
        : `Thoroughly and comprehensively analyze this medical document ('${fileName}'):

1. 📋 **Executive Clinical & Scientific Summary**:
   - Scope, core disease processes, diagnostic criteria, and clinical takeaways.
2. 🧬 **Core Mechanisms & Biological Principles**:
   - Pathophysiological mechanisms, anatomical relations, enzyme kinetics, or receptor pathways.
3. 💊 **Clinical Management & Diagnostics Framework**:
   - Gold-standard laboratory/imaging tests, first-line medications, and therapeutic management guidelines.
4. 💡 **High-Yield Board Exam Pearls & Mnemonics**:
   - High-yield USMLE / NEET-PG / Board associations, high-retention mnemonics, and classic examiner traps.

CRITICAL: Provide exhaustive, high-yield educational synthesis. DO NOT attach an unsolicited quiz or MCQ.`;
    } else if (isText) {
      const textContent = fileBuffer.toString("utf-8").slice(0, 60000);
      promptText = `[Medical Document Attached: '${fileName}']
--- START OF DOCUMENT CONTENT ---
${textContent}
--- END OF DOCUMENT CONTENT ---

` + (caption
        ? `[User Query]: "${caption}"

Address the user's query with expert medical reasoning, quoting and synthesizing the relevant portions of the document. Provide high-yield clinical insights.`
        : `Thoroughly review this medical document. Provide:
1. 📋 **Executive Summary & High-Yield Concepts**
2. 🧬 **Key Pathophysiological / Pharmacological Mechanisms**
3. 💊 **Diagnostic & Therapeutic Recommendations**
4. 💡 **Active Recall Exam Pearls & Mnemonics**
(DO NOT attach unsolicited quiz questions).`);
    } else {
      const base64Data = fileBuffer.toString("base64");
      attachments = [{
        mimeType: mimeType || "application/octet-stream",
        data: base64Data,
        fileName,
      }];
      promptText = caption
        ? `[Medical Document '${fileName}']: ${caption}`
        : `Analyze this medical document ('${fileName}') and extract high-yield clinical concepts, therapeutic guidelines, and disease mechanisms. (No unsolicited MCQs).`;
    }

    const history = this.chatHistories.get(chatId) || [];

    try {
      const { text: reply, latencyMs } = await generateGeminiReply(
        promptText,
        history,
        this.getSystemPrompt(chatId),
        this.config.temperature,
        attachments,
        this.config.model
      );

      history.push({ role: 'user', text: `[Medical Document Uploaded: ${fileName}${caption ? ` - ${caption}` : ''}]` });
      history.push({ role: 'model', text: reply });
      this.chatHistories.set(chatId, history.slice(-12));

      // Record as the latest bot response for instant /pdf compilation
      const cleanDocTopic = caption ? caption.slice(0, 40) : fileName.replace(/\.[^/.]+$/, "").slice(0, 40);
      this.lastBotResponseByChat.set(chatId, {
        text: reply,
        topic: cleanDocTopic || "Medical Document Analysis",
        sourceType: 'document',
        timestamp: Date.now(),
      });

      this.stats.documentsProcessed++;
      this.totalLatencySum += latencyMs;
      this.totalLatencyCount++;
      this.stats.averageLatencyMs = Math.round(this.totalLatencySum / this.totalLatencyCount);

      await this.sendSmartMedicalMessage(chatId, reply, "Markdown");

      this.logActivity({
        id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: caption ? `[Document: ${fileName}] ${caption}` : `[Document: ${fileName}]`,
        aiResponse: reply,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'telegram',
        mediaType: 'document',
        fileName,
      });
    } catch (err: any) {
      console.error("[Telegram] Document processing error:", err);
      this.stats.totalErrors++;
      await this.sendMessage(chatId, `⚠️ Failed to process the document *${fileName}*. If it contains scanned images, you can also send key pages directly as photos.`);
      this.logActivity({
        id: `err-${Date.now()}`,
        chatId,
        userName,
        userHandle,
        userMessage: `[Doc Error: ${fileName}]`,
        aiResponse: "",
        latencyMs: 0,
        timestamp: new Date().toISOString(),
        status: 'error',
        errorMessage: err.message || "Document processing error",
        source: 'telegram',
        mediaType: 'document',
        fileName,
      });
    }
  }

  public async handleUpdate(update: any): Promise<void> {
    // Handle inline button callbacks
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = message.chat.id;
    const sender = message.from || {};
    const userName = sender.first_name ? `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}` : "Medical Student";
    const userHandle = sender.username ? `@${sender.username}` : undefined;
    const text = (message.text || "").trim();

    // 0. Superadmin claim command (/claimadmin <passcode> or /adminlogin <passcode>)
    if (text.startsWith("/claimadmin") || text.startsWith("/adminlogin")) {
      const parts = text.split(" ");
      const secret = parts[1]?.trim();
      const isFirstAdmin = this.adminChatIds.size === 0 && this.adminUsernames.size === 0;

      if (!secret && !isFirstAdmin) {
        await this.sendMessage(chatId, "⚠️ *Admin Access*\n\nPlease provide the admin passcode:\n`/claimadmin <passcode>`", "Markdown");
        return;
      }

      if (secret === this.adminSecret || isFirstAdmin) {
        const numId = Number(chatId);
        this.adminChatIds.add(!isNaN(numId) ? numId : chatId);
        if (sender.username) {
          const cleanUser = sender.username.replace(/^@/, '').toLowerCase().trim();
          this.adminUsernames.add(cleanUser);
          this.approvedUsernames.add(cleanUser);
        }
        this.approvedUsers.set(String(chatId).trim(), {
          chatId,
          username: userHandle,
          name: userName,
          approvedAt: new Date().toISOString(),
          approvedBy: "Self (Admin Claim)",
        });

        this.syncAndPersistState();

        const adminWelcome = `👑 *Admin Privileges Activated!*

Welcome, *${userName}*! You are registered as an Administrator for Medchat.

🛡️ *Your Admin Command Center:*
• \`/approve <@username or ID>\` - Approve a waiting student
• \`/revoke <@username or ID>\` - Revoke student access
• \`/pending\` - View and 1-click approve pending requests
• \`/users\` or \`/whitelist\` - List all authorized students
• \`/broadcast <message>\` - Send announcement to all students
• \`/toggleauth\` - Toggle private mode ON/OFF
• \`/admin\` - View admin command reference

_You will also receive instant interactive alerts whenever a new student requests access._`;

        await this.sendMessage(chatId, adminWelcome, "Markdown", this.getPersistentReplyKeyboard());
        return;
      } else {
        await this.sendMessage(chatId, "❌ Incorrect admin passcode.", "Markdown");
        return;
      }
    }

    // Check authorization status across both chatId and sender.id (handles DMs, groups, channels)
    const senderId = sender.id;
    const isAdminUser = this.isAdmin(chatId, sender.username) || (senderId ? this.isAdmin(senderId, sender.username) : false);
    const isApprovedUser = this.isAuthorized(chatId, sender.username) || (senderId ? this.isAuthorized(senderId, sender.username) : false);

    // Auto-lock and permanently store active admin or approved user IDs to prevent state loss
    if (isAdminUser || isApprovedUser) {
      let stateChanged = false;
      const key = String(chatId).trim();

      if (!this.approvedUsers.has(key)) {
        this.approvedUsers.set(key, {
          chatId,
          username: userHandle,
          name: userName,
          approvedAt: new Date().toISOString(),
          approvedBy: isAdminUser ? "Administrator (Self/Channel)" : "Whitelisted Member",
        });
        stateChanged = true;
      }

      // Also register senderId if distinct from chatId (e.g. In groups or supergroups)
      if (senderId && String(senderId).trim() !== key) {
        const sKey = String(senderId).trim();
        if (!this.approvedUsers.has(sKey)) {
          this.approvedUsers.set(sKey, {
            chatId: senderId,
            username: userHandle,
            name: userName,
            approvedAt: new Date().toISOString(),
            approvedBy: isAdminUser ? "Administrator (Self/Channel)" : "Whitelisted Member",
          });
          stateChanged = true;
        }
      }

      if (sender.username) {
        const cleanU = sender.username.replace(/^@/, '').toLowerCase().trim();
        if (!this.approvedUsernames.has(cleanU)) {
          this.approvedUsernames.add(cleanU);
          stateChanged = true;
        }
      }

      if (isAdminUser) {
        const numId = Number(chatId);
        const validAdminId = !isNaN(numId) ? numId : chatId;
        if (!this.adminChatIds.has(validAdminId)) {
          this.adminChatIds.add(validAdminId);
          stateChanged = true;
        }
        if (senderId) {
          const numSenderId = Number(senderId);
          const validSenderId = !isNaN(numSenderId) ? numSenderId : senderId;
          if (!this.adminChatIds.has(validSenderId)) {
            this.adminChatIds.add(validSenderId);
            stateChanged = true;
          }
        }
        if (sender.username) {
          const cleanU = sender.username.replace(/^@/, '').toLowerCase().trim();
          if (!this.adminUsernames.has(cleanU)) {
            this.adminUsernames.add(cleanU);
            stateChanged = true;
          }
        }
      }

      if (stateChanged) {
        this.syncAndPersistState();
      }
    }

    // If access control is enabled and user is NOT authorized:
    if (!isApprovedUser) {
      const isNewReq = !this.pendingRequests.has(String(chatId).trim()) && !this.pendingRequests.has(chatId);
      this.pendingRequests.set(String(chatId).trim(), {
        chatId,
        username: userHandle,
        name: userName,
        requestedAt: new Date().toISOString(),
        lastMessage: text || (message.photo ? "[Photo]" : message.document ? "[Document]" : "[Action]"),
      });

      this.syncAndPersistState();

      const accessNotice = `🔒 *Access Restricted: Private Medical Bot*

Hello *${userName}*! Medchat is currently in private mode for authorized medical students and clinicians.

⏳ *Your access request has been sent to the administrator.* You will receive a notification here as soon as you are approved.

📋 *Your Details:*
• *Name:* ${userName}
${userHandle ? `• *Username:* ${userHandle}\n` : ''}• *Telegram ID:* \`${chatId}\`

_If you are the bot owner, activate admin mode with:_ \`/claimadmin <passcode>\``;

      await this.sendMessage(chatId, accessNotice, "Markdown");

      // Notify admins
      if (isNewReq && this.adminChatIds.size > 0) {
        for (const adminId of this.adminChatIds) {
          try {
            const alertMsg = `🔔 *New Access Request for Medchat*

👤 *Student:* ${userName} ${userHandle ? `(${userHandle})` : ''}
🆔 *Chat ID:* \`${chatId}\`
💬 *Message:* "${(text || '').slice(0, 80)}"`;
            await this.sendMessage(adminId, alertMsg, "Markdown", {
              inline_keyboard: [
                [
                  { text: `✅ Approve ${userHandle || userName}`, callback_data: `auth_approve_${chatId}` },
                  { text: `❌ Deny`, callback_data: `auth_deny_${chatId}` }
                ]
              ]
            });
          } catch (err) {
            console.warn(`[Telegram] Failed to notify admin ${adminId}:`, err);
          }
        }
      }

      this.logActivity({
        id: `auth-req-${Date.now()}`,
        chatId,
        userName,
        userHandle,
        userMessage: text || "[Media Upload]",
        aiResponse: "[Access Denied - Pending Admin Approval]",
        latencyMs: 5,
        timestamp: new Date().toISOString(),
        status: 'error',
        errorMessage: 'Unauthorized User Request',
        source: 'telegram',
      });
      return;
    }

    // Handle Admin Commands if sender is Admin
    if (isAdminUser && text) {
      if (text.startsWith("/approve")) {
        const parts = text.split(" ");
        const target = parts.slice(1).join(" ").trim();
        if (!target) {
          if (this.pendingRequests.size === 0) {
            await this.sendMessage(chatId, "ℹ️ No pending requests.\n\nUsage: `/approve @username` or `/approve <chatId>`", "Markdown");
            return;
          }
          let msg = `📋 *Pending Access Requests (${this.pendingRequests.size}):*\n\n`;
          const buttons: any[] = [];
          for (const [pId, req] of this.pendingRequests.entries()) {
            msg += `• *${req.name}* ${req.username ? `(${req.username})` : ''} - \`${pId}\`\n`;
            buttons.push([
              { text: `✅ Approve ${req.username || req.name}`, callback_data: `auth_approve_${pId}` },
              { text: `❌ Deny`, callback_data: `auth_deny_${pId}` }
            ]);
          }
          await this.sendMessage(chatId, msg, "Markdown", { inline_keyboard: buttons });
          return;
        }

        const res = await this.approveUser(target, userHandle || userName);
        await this.sendMessage(chatId, `✅ *Approval Result:*\n\n${res.message}`, "Markdown");
        return;
      }

      if (text.startsWith("/revoke")) {
        const parts = text.split(" ");
        const target = parts.slice(1).join(" ").trim();
        if (!target) {
          await this.sendMessage(chatId, "Usage: `/revoke @username` or `/revoke <chatId>`", "Markdown");
          return;
        }
        const res = await this.revokeUser(target);
        await this.sendMessage(chatId, `ℹ️ ${res.message}`, "Markdown");
        return;
      }

      if (text === "/users" || text === "/whitelist" || text === "/members") {
        const usersList = Array.from(this.approvedUsers.values());
        let msg = `👥 *Authorized Students & Members (${usersList.length}):*\n\n`;
        if (usersList.length === 0) {
          msg += "_No regular users added yet._\n";
        } else {
          usersList.forEach((u, i) => {
            msg += `${i + 1}. *${u.name}* ${u.username ? `(${u.username})` : ''} - \`${u.chatId}\`\n`;
          });
        }
        if (this.approvedUsernames.size > 0) {
          msg += `\n🏷️ *Whitelisted Usernames:* ${Array.from(this.approvedUsernames).map(u => `@${u}`).join(', ')}\n`;
        }
        msg += `\n👑 *Admins:* ${Array.from(this.adminChatIds).join(', ')}`;
        await this.sendMessage(chatId, msg, "Markdown");
        return;
      }

      if (text === "/pending") {
        if (this.pendingRequests.size === 0) {
          await this.sendMessage(chatId, "✅ *No pending requests!* All students have been processed.", "Markdown");
          return;
        }
        let msg = `⏳ *Pending Access Requests (${this.pendingRequests.size}):*\n\n`;
        const buttons: any[] = [];
        for (const [pId, req] of this.pendingRequests.entries()) {
          msg += `• *${req.name}* ${req.username ? `(${req.username})` : ''}\n  ID: \`${pId}\` | Msg: "${(req.lastMessage || '').slice(0, 40)}"\n`;
          buttons.push([
            { text: `✅ Approve ${req.username || req.name}`, callback_data: `auth_approve_${pId}` },
            { text: `❌ Deny`, callback_data: `auth_deny_${pId}` }
          ]);
        }
        await this.sendMessage(chatId, msg, "Markdown", { inline_keyboard: buttons });
        return;
      }

      if (text.startsWith("/broadcast")) {
        const broadcastMsg = text.replace("/broadcast", "").trim();
        if (!broadcastMsg) {
          await this.sendMessage(chatId, "Usage: `/broadcast <your message>`", "Markdown");
          return;
        }
        const targets = Array.from(this.approvedUsers.keys());
        let count = 0;
        for (const targetId of targets) {
          try {
            await this.sendMessage(targetId, `📢 *Announcement from Administrator:*\n\n${broadcastMsg}`, "Markdown");
            count++;
          } catch {}
        }
        await this.sendMessage(chatId, `✅ Broadcast sent to *${count}* / ${targets.length} users.`, "Markdown");
        return;
      }

      if (text === "/toggleauth") {
        this.accessControlEnabled = !this.accessControlEnabled;
        this.syncAndPersistState();
        await this.sendMessage(
          chatId,
          `🔒 *Access Control is now: ${this.accessControlEnabled ? 'ENABLED (Private - Approval Required)' : 'DISABLED (Public - Anyone can chat)'}*`,
          "Markdown"
        );
        return;
      }

      if (text === "/syncchannel" || text === "/syncadmins" || text === "/backup") {
        await this.syncAdminsFromChannel();
        this.syncAndPersistState();
        const channelName = ChannelStorageService.getInstance().getChannelTarget();
        await this.sendMessage(
          chatId,
          `☁️ *Channel Cloud Storage Synced!*\n\n` +
          `• *Storage Channel:* \`${channelName}\` (https://t.me/theoutliness)\n` +
          `• *Registered Admins:* ${this.adminChatIds.size}\n` +
          `• *Authorized Users:* ${this.approvedUsers.size}\n` +
          `• *Status:* State successfully mirrored to Telegram cloud storage.`,
          "Markdown"
        );
        return;
      }

      if (text === "/channel" || text === "/storage") {
        const channelName = ChannelStorageService.getInstance().getChannelTarget();
        await this.sendMessage(
          chatId,
          `📡 *Permanent Cloud Storage Center*\n\n` +
          `• *Channel Link:* https://t.me/theoutliness (\`${channelName}\`)\n` +
          `• *Auto-Admin Recognition:* Active (Channel owners and administrators automatically receive permanent Bot Admin privileges)\n` +
          `• *Decentralized State Backup:* Automatic\n` +
          `• *Manual Sync Command:* \`/backup\` or \`/syncchannel\``,
          "Markdown"
        );
        return;
      }

      if (text.startsWith("/autopost")) {
        const parts = text.split(" ");
        const action = parts[1]?.toLowerCase();
        const arg = parts.slice(2).join(" ").trim();

        if (action === "add" && arg) {
          this.autoPostTopics.push(arg);
          this.syncAndPersistState();
          await this.sendMessage(chatId, `✅ Topic added for daily auto-post: *${arg}*`, "Markdown");
        } else if (action === "remove" && arg) {
          const initialLength = this.autoPostTopics.length;
          this.autoPostTopics = this.autoPostTopics.filter(t => t.toLowerCase() !== arg.toLowerCase());
          if (this.autoPostTopics.length < initialLength) {
            this.syncAndPersistState();
            await this.sendMessage(chatId, `🗑️ Topic removed: *${arg}*`, "Markdown");
          } else {
            await this.sendMessage(chatId, `⚠️ Topic not found: *${arg}*`, "Markdown");
          }
        } else if (action === "trigger") {
          await this.sendMessage(chatId, `🚀 Triggering an immediate daily clinical vignette post...`);
          const success = await this.postDailyVignette(arg || undefined);
          await this.sendMessage(chatId, success ? `✅ Successfully posted vignette to @M_T_C_ethiopia` : `❌ Failed to post vignette.`);
        } else {
          let listMsg = `📅 *Daily Vignette Auto-Poster Topics*\n\n`;
          if (this.autoPostTopics.length === 0) {
            listMsg += `_No topics configured._\n`;
          } else {
            this.autoPostTopics.forEach((t, i) => listMsg += `${i + 1}. ${t}\n`);
          }
          listMsg += `\n*Commands:*\n• \`/autopost add <topic>\`\n• \`/autopost remove <topic>\`\n• \`/autopost trigger [optional_topic]\``;
          await this.sendMessage(chatId, listMsg, "Markdown");
        }
        return;
      }

      if (text === "/admin" || text === "/adminhelp") {
        const adminHelp = `👑 *Medchat Administrator Commands*

• \`/approve <@username or ID>\` - Grant user access
• \`/revoke <@username or ID>\` - Revoke user access
• \`/pending\` - View waiting access requests
• \`/users\` - List all authorized users
• \`/broadcast <text>\` - Send message to all users
• \`/toggleauth\` - Toggle private/public mode
• \`/syncchannel\` or \`/backup\` - Force sync with channel cloud storage
• \`/channel\` - View storage center status (t.me/theoutliness)
• \`/autopost\` - Manage Daily Question Auto-Poster
• \`/setprompt <prompt>\` - Set your custom prompt
• \`/resetprompt\` - Reset system instructions`;
        await this.sendMessage(chatId, adminHelp, "Markdown");
        return;
      }
    }

    // Check for Image / Photo message
    if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1]; // Highest resolution
      const caption = message.caption?.trim() || "";
      this.queueMediaUpdate(
        chatId,
        sender,
        userName,
        userHandle,
        {
          fileId: photo.file_id,
          mimeType: "image/jpeg",
          fileName: "medical_photo.jpg",
          caption,
          messageId: message.message_id || Date.now(),
          timestamp: Date.now(),
        },
        message.media_group_id
      );
      return;
    }

    // Check for Document message
    if (message.document) {
      const doc = message.document;
      const caption = message.caption?.trim() || "";
      const isImageFile = (doc.mime_type && doc.mime_type.startsWith("image/")) || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(doc.file_name || "");
      if (isImageFile) {
        this.queueMediaUpdate(
          chatId,
          sender,
          userName,
          userHandle,
          {
            fileId: doc.file_id,
            mimeType: doc.mime_type || "image/jpeg",
            fileName: doc.file_name || "medical_image.jpg",
            caption,
            messageId: message.message_id || Date.now(),
            timestamp: Date.now(),
          },
          message.media_group_id
        );
        return;
      }
      if (message.media_group_id) {
        this.queueMediaUpdate(
          chatId,
          sender,
          userName,
          userHandle,
          {
            fileId: doc.file_id,
            mimeType: doc.mime_type || "application/pdf",
            fileName: doc.file_name || "medical_document.pdf",
            caption,
            messageId: message.message_id || Date.now(),
            timestamp: Date.now(),
          },
          message.media_group_id
        );
        return;
      }
      // Medical document (PDF, TXT, MD, etc.)
      await this.handleDocumentMessage(chatId, sender, userName, userHandle, doc, caption);
      return;
    }

    if (!message.text) return;

    this.stats.lastActiveAt = new Date().toISOString();
    this.stats.totalMessages++;
    if (!this.chatHistories.has(chatId)) {
      this.stats.activeChatsCount++;
    }

    // 1. /start or /menu Command
    if (text.startsWith("/start") || text.startsWith("/menu") || text === "📋 Medical Menu") {
      const welcome = `🩺 *Welcome ${sender.first_name || 'Doctor / Medical Student'}!*

I am *Medchat*, your specialized Medical Sciences & Board Exam AI Professor powered by *Google Gemini 3.8*.

📚 *Specialized Medical Disciplines:*
• *Anatomy & Neuroanatomy* (Relations, cranial nerves, vasculature)
• *Physiology & Pathophysiology* (Systems, hemodynamics, acid-base)
• *Biochemistry & Genetics* (Metabolism, inborn errors, enzymes)
• *Microbiology & Immunology* (Bacteriology, virology, immunology)
• *Pathology* (Histopathology clues, morphologic signs, lab findings)
• *Pharmacology* (Mechanisms of action, ADRs, contraindications)

📸 *Medical Images On-Demand:*
• Request 2-5 medical diagrams anytime by typing e.g. \`heart image\`, \`lungs images\`, \`send kidney images\`!
• Questions & clinical MCQs are generated strictly when you ask for them (e.g. \`/mcq\` or \`question on heart failure\`).`;

      await this.sendMessage(chatId, welcome, "Markdown", this.getPersistentReplyKeyboard());

      this.logActivity({
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: text,
        aiResponse: welcome,
        latencyMs: 15,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'telegram',
      });
      return;
    }

    // Vision & Documents Guide Command
    if (text === "📸 Medical Vision & Docs Guide" || text.startsWith("/vision") || text.startsWith("/docs") || text.startsWith("/guide")) {
      const guideText = `📸 *Medical Image Vision & Document Processing Guide*

Medchat is equipped with multimodal perception powered by Google Gemini!

🔬 *Medical Image Vision:*
• *Histopathology & Micrographs:* Send micrographs to detect tissue type, staining, key pathognomonic cellular hallmarks (e.g. Reed-Sternberg, Auer rods, Councilman bodies, Mallory-Denk), and molecular pathology.
• *Radiology & Imaging:* Send chest X-rays, CT scans, MRI, or ultrasound images for anatomical landmark identification, radiographic signs, and differential diagnoses.
• *ECG & Rhythm Strips:* Send 12-lead ECGs or rhythm strips for rate, rhythm, axis, interval calculation, and ischemia/infarction localization.
• *Anatomy Diagrams & Dissections:* Review vascular branching, plexus nerves, fascial compartments, and foramina.
• *Board Questions with Images:* Send question screenshots to get the answer, clinical pearl, and distractor breakdowns!

📄 *Document & PDF Reading:*
• *Lecture Handouts & Study Slides:* Upload PDF or text summaries to generate executive clinical summaries and high-yield concepts.
• *Clinical Guidelines & Papers:* Medchat extracts high-yield disease mechanisms, first-line drug recommendations, and diagnostic algorithms.
• *Auto-Generated Board MCQs:* Every uploaded document or image automatically generates practice MCQs to test your retention!

💡 *Try it right now:* Tap the paperclip 📎 or photo icon in Telegram to send any medical slide or document!`;

      await this.sendMessage(chatId, guideText, "Markdown", this.getMainInlineKeyboard());
      this.logActivity({
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: text,
        aiResponse: guideText,
        latencyMs: 10,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'telegram',
      });
      return;
    }

    // 2. Exam Tips Command or Button
    if (text.startsWith("/examtips") || text.startsWith("/tips") || text === "💡 Exam Tips & Mnemonics") {
      await this.sendChatAction(chatId, "typing");
      try {
        const { text: tipsText, latencyMs } = await this.generateExamTips("general");
        await this.sendMessage(chatId, tipsText, "Markdown", this.getExamTipsActionButtons());
        this.logActivity({
          id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          chatId,
          userName,
          userHandle,
          userMessage: text,
          aiResponse: tipsText,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          source: 'telegram',
        });
      } catch (err: any) {
        await this.sendMessage(chatId, "⚠️ Could not generate exam tips. Please try again.");
      }
      return;
    }

    // 3. PDF Conversion and Download Requests (Gemini-Powered)
    const isPdfRequest =
      text.startsWith("/pdf") ||
      text.startsWith("/download") ||
      text === "📄 Download Notes PDF" ||
      text === "📄 Export PDF Notes" ||
      /\b(pdf|convert to pdf|download as pdf|download pdf|save as pdf|export pdf|send pdf|make pdf|make a pdf|create pdf|create a pdf|generate pdf|generate a pdf|compile (?:to|into|as)? pdf|give me (?:a\s+)?pdf)\b/i.test(text);

    const isPptRequest =
      text.startsWith("/ppt") ||
      text === "📊 Export PPT Notes" ||
      /\b(ppt|pptx|convert to ppt|download as ppt|download ppt|save as ppt|export ppt|send ppt|make ppt|make a ppt|create ppt|create a ppt|generate ppt|generate a ppt|compile (?:to|into|as)? ppt|give me (?:a\s+)?ppt)\b/i.test(text);

    if (isPdfRequest) {
      let topic = text
        .replace(/^\/(?:pdf|download)\s*/i, "")
        .replace(/^(?:can\s+you\s+)?(?:please\s+)?(?:convert|download|save|send|make|create|generate|compile|export)\s+(?:this\s+|it\s+|last\s+response\s+|previous\s+response\s+)?(?:to\s+|as\s+|into\s+)?(?:a\s+)?pdf\s*(?:of\s+|about\s+|on\s+)?/i, "")
        .replace(/\b(?:as\s+|in\s+)?pdf\b/gi, "")
        .trim();

      await this.compileAndSendMedicalPdf(chatId, topic);
      return;
    }

    if (isPptRequest) {
      let topic = text
        .replace(/^\/(?:ppt)\s*/i, "")
        .replace(/^(?:can\s+you\s+)?(?:please\s+)?(?:convert|download|save|send|make|create|generate|compile|export)\s+(?:this\s+|it\s+|last\s+response\s+|previous\s+response\s+)?(?:to\s+|as\s+|into\s+)?(?:a\s+)?ppt\s*(?:of\s+|about\s+|on\s+)?/i, "")
        .replace(/\b(?:as\s+|in\s+)?pptx?\b/gi, "")
        .trim();

      await this.compileAndSendMedicalPpt(chatId, topic);
      return;
    }

    // 3b. Rapid Fire Timer Configuration Command (e.g. /timer 20, /countdown 15, /timer, ⏱️ Timer Settings)
    if (text.startsWith("/timer") || text.startsWith("/countdown") || text === "⏱️ Timer Settings") {
      const parts = text.split(/\s+/);
      if (parts.length > 1 && !isNaN(parseInt(parts[1], 10))) {
        const newSec = Math.max(5, Math.min(600, parseInt(parts[1], 10)));
        this.config.rapidFireCountdownSeconds = newSec;
        this.syncAndPersistState();
        await this.sendMessage(
          chatId,
          `⏱️ *Rapid Fire Countdown Timer Updated!*\n\n• *New Default Timer:* \`${newSec} seconds\` per MCQ\n• *Status:* Saved & active for all subsequent \`/rapidfire\` sessions.\n\n🚀 _Test it now:_ \`/rapidfire 5\``,
          "Markdown"
        );
      } else {
        const currentTimer = this.config.rapidFireCountdownSeconds || 30;
        await this.sendMessage(
          chatId,
          `⏱️ *Rapid Fire Countdown Timer Settings*\n\n` +
          `• *Current Default Countdown:* \`${currentTimer} seconds\`\n` +
          `• *Allowed Range:* 5 to 600 seconds\n\n` +
          `🔧 *To Change the Timer Duration:*\n` +
          `Send \`/timer <seconds>\` anytime, for example:\n` +
          `• \`/timer 15\` (Ultra-fast 15s blitz)\n` +
          `• \`/timer 30\` (Standard 30s board pace)\n` +
          `• \`/timer 45\` (Moderate 45s analysis)\n` +
          `• \`/timer 60\` (Relaxed 60s deep reasoning)\n\n` +
          `⚡️ *Run a Rapid-Fire Exam:* \`/rapidfire 10 cardiology\` or \`/rapidfire 5 pharm 15s\``,
          "Markdown"
        );
      }
      return;
    }

    // Parse user intent for count, difficulty, complexity, format (polls vs long cases vs rapid fire)
    const intent = parseUserPromptIntent(text);

    // 4. Rapid Fire Timed Exam Simulator (e.g. /rapidfire, /rapid, /timed, "rapid fire", "⚡️ Rapid Fire Exam")
    const isRapidFireReq =
      intent.isRapidFire ||
      text.startsWith("/rapidfire") ||
      text.startsWith("/rapid") ||
      text.startsWith("/timed") ||
      text.startsWith("/speed") ||
      text === "⚡️ Rapid Fire Exam" ||
      text === "⚡️ Rapid Fire Exam (Timed)";

    if (isRapidFireReq) {
      await this.handleRapidFireExam(chatId, sender, userName, userHandle, text, intent);
      return;
    }

    // 4b. Interactive Quiz Request (Triggered when prompted with quizzes/polls or interactive quiz)
    const isQuizWord =
      intent.isPollRequested ||
      /\bquiz(?:zes)?\b/i.test(text) ||
      text.startsWith("/quiz") ||
      text === "📊 Interactive Quiz" ||
      (intent.count > 1 && /\b(polls?|poll questions?)\b/i.test(text));

    if (isQuizWord) {
      await this.handleInteractiveQuizzes(chatId, sender, userName, userHandle, text, intent);
      return;
    }

    // 5. Long Text Case Questions Request (e.g., "generate 50 long text case questions")
    // Note: This is checked AFTER isQuizWord so that if they say "long text case questions quiz", it generates polls.
    const isExplicitCaseQuestions =
      intent.isTextCaseRequested ||
      (intent.isLongCase && !intent.isPollRequested && (intent.count > 1 || /\b(questions?|cases?|items?|vignettes?)\b/i.test(text))) ||
      /\b(long text (?:case )?questions?|case questions?|case vignettes?|clinical case questions?)\b/i.test(text);

    if (isExplicitCaseQuestions) {
      await this.handleLongTextCaseQuestions(chatId, sender, userName, userHandle, text, intent);
      return;
    }

    // 6. Sensitivity Follow-ups (e.g., "make it harder", "harder", "more complex", "complex one", "longer ones")
    const isDifficultyFollowup =
      /^(?:make (?:it|them|the questions?|the cases?|the quiz)\s+)?(?:harder|more complex|complex|more difficult|tougher|longer|extended)(?:\s+ones?)?$/i.test(text.trim()) ||
      /^generate (?:harder|more complex|complex|longer)(?:\s+ones?)?$/i.test(text.trim());

    if (isDifficultyFollowup) {
      const last = this.lastBotResponseByChat.get(chatId);
      if (last?.sourceType === 'quiz') {
        const enhancedText = `${text} on ${last.topic}`;
        const followIntent = parseUserPromptIntent(enhancedText);
        await this.handleInteractiveQuizzes(chatId, sender, userName, userHandle, enhancedText, followIntent);
        return;
      } else if (last?.sourceType === 'long_case') {
        const enhancedText = `${text} on ${last.topic}`;
        const followIntent = parseUserPromptIntent(enhancedText);
        await this.handleLongTextCaseQuestions(chatId, sender, userName, userHandle, enhancedText, followIntent);
        return;
      }
    }

    // 5. General MCQ Requests (without the word "quiz") -> Generate Raw Text as of now
    const isMcqRequest =
      text.startsWith("/mcq") ||
      text === "🎯 High-Yield MCQ" ||
      text === "💊 Pharmacology MCQ" ||
      text === "🫀 Anatomy / Physio MCQ" ||
      text === "🔬 Pathology & Micro MCQ" ||
      text === "🧬 Biochemistry MCQ" ||
      /\b(mcq|mcqs|multiple choice)\b/i.test(text) ||
      text.startsWith("/anatomy") ||
      text.startsWith("/physiology") ||
      text.startsWith("/pharm") ||
      text.startsWith("/pharmacology") ||
      text.startsWith("/pathology") ||
      text.startsWith("/biochem") ||
      text.startsWith("/microbiology");

    if (isMcqRequest) {
      await this.sendChatAction(chatId, "typing");
      let subject = "general";
      if (text.includes("Pharm") || text.startsWith("/pharm")) subject = "pharmacology";
      else if (text.includes("Anatomy") || text.startsWith("/anatomy")) subject = "anatomy";
      else if (text.includes("Physio") || text.startsWith("/physiology")) subject = "physiology";
      else if (text.includes("Pathology") || text.startsWith("/pathology")) subject = "pathology";
      else if (text.includes("Micro") || text.startsWith("/microbiology")) subject = "microbiology";
      else if (text.includes("Biochem") || text.startsWith("/biochem")) subject = "biochemistry";
      else if (text.startsWith("/mcq ")) subject = text.replace("/mcq ", "").trim();

      try {
        const { text: mcqText, latencyMs } = await this.generateClinicalMcq(subject, text);
        await this.sendMessage(chatId, mcqText, "Markdown");
        this.lastBotResponseByChat.set(chatId, {
          text: mcqText,
          topic: `MCQ (${subject})`,
          sourceType: 'mcq',
          timestamp: Date.now(),
        });
        this.logActivity({
          id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          chatId,
          userName,
          userHandle,
          userMessage: text,
          aiResponse: mcqText,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          source: 'telegram',
        });
      } catch (err: any) {
        await this.sendMessage(chatId, "⚠️ Error generating clinical MCQ. Please try again.");
      }
      return;
    }

    // 4. Clear Context
    if (text.startsWith("/clear") || text.startsWith("/reset") || text === "🧹 Reset Memory") {
      this.chatHistories.delete(chatId);
      const msg = "🧹 *Medical conversation context cleared!* Memory has been reset. What medical science topic would you like to explore next?";
      await this.sendMessage(chatId, msg, "Markdown");
      this.logActivity({
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: text,
        aiResponse: msg,
        latencyMs: 10,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'telegram',
      });
      return;
    }

    // 5. Status Command
    if (text.startsWith("/status")) {
      const uptimeSec = Math.floor((Date.now() - new Date(this.stats.startedAt).getTime()) / 1000);
      const avgLat = this.totalLatencyCount > 0 ? Math.round(this.totalLatencySum / this.totalLatencyCount) : 0;
      const statusMsg = `🩺 *Medchat AI Status:*
• *Engine:* Google ${this.config.model}
• *Specialty:* All Medical Sciences (Anatomy, Physio, Biochem, Micro, Path, Pharm)
• *Target Exam:* ${this.config.examLevel || 'USMLE Step 1 / 2 CK'}
• *MCQs Generated:* ${this.stats.mcqsGenerated}
• *Average Response Time:* ${avgLat}ms
• *Uptime:* ${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;
      await this.sendMessage(chatId, statusMsg, "Markdown");
      return;
    }

    // Custom Prompt Handling
    if (text === "⚙️ Custom Prompt" || text.startsWith("/setprompt")) {
      const parts = text.split(" ");
      if (text.startsWith("/setprompt") && parts.length > 1) {
        const newPrompt = text.replace("/setprompt", "").trim();
        this.customSystemPrompts.set(chatId, newPrompt);
        this.userStates.delete(chatId);
        this.syncAndPersistState();
        await this.sendMessage(chatId, `✅ *Custom prompt updated!*\n\nYour new prompt:\n_${newPrompt}_\n\nTo revert, send /resetprompt`, "Markdown");
      } else {
        this.userStates.set(chatId, 'WAITING_FOR_PROMPT');
        await this.sendMessage(chatId, "⚙️ *Set Custom Prompt*\n\nPlease reply to this message with your new system prompt (e.g., 'Act as a 1st-year anatomy tutor').\n\nTo return to normal, send /resetprompt.", "Markdown");
      }
      return;
    }

    if (text === "/resetprompt") {
      this.customSystemPrompts.delete(chatId);
      this.userStates.delete(chatId);
      this.syncAndPersistState();
      await this.sendMessage(chatId, "✅ *Prompt Reset*\n\nYour bot has returned to its normal (default) medical mode.", "Markdown");
      return;
    }

    if (this.userStates.get(chatId) === 'WAITING_FOR_PROMPT') {
      this.customSystemPrompts.set(chatId, text);
      this.userStates.delete(chatId);
      this.syncAndPersistState();
      await this.sendMessage(chatId, `✅ *Custom prompt updated!*\n\nYour new prompt:\n_${text}_\n\nTo revert, send /resetprompt`, "Markdown");
      return;
    }

    // Check for YouTube Links
    const youtubeMatch = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (youtubeMatch && youtubeMatch[1]) {
      const videoId = youtubeMatch[1];
      await this.sendChatAction(chatId, "typing");
      
      try {
        await this.sendMessage(chatId, "⏳ *Fetching YouTube Transcript...*\n\nPlease wait while I analyze the video content.", "Markdown");
        
        const transcriptArr = await YoutubeTranscript.fetchTranscript(videoId);
        const transcriptText = transcriptArr.map(t => t.text).join(" ");
        
        // Ensure transcript fits within reasonable context window limits
        const truncatedTranscript = transcriptText.slice(0, 80000); // Rough limit to keep prompt size manageable
        
        const prompt = `You are a medical AI assistant. The user has shared a YouTube video with the following transcript:\n\n<transcript>\n${truncatedTranscript}\n</transcript>\n\nHere is the user's specific request regarding this video:\n\n<user_request>\n${text}\n</user_request>\n\nPlease fulfill the user's request based strictly on the content of this video (and your medical knowledge to contextualize it). If the user asks you to generate questions, quizzes, or summarize, do so comprehensively and structure your response nicely.`;

        const history = this.chatHistories.get(chatId) || [];
        const { text: reply, latencyMs, modelUsed } = await generateGeminiReply(
          prompt,
          history,
          this.getSystemPrompt(chatId),
          this.config.temperature,
          [],
          this.config.model
        );

        history.push({ role: 'user', text });
        history.push({ role: 'model', text: reply });
        if (history.length > 12) {
          this.chatHistories.set(chatId, history.slice(-12));
        } else {
          this.chatHistories.set(chatId, history);
        }

        this.totalLatencySum += latencyMs;
        this.totalLatencyCount++;

        await this.sendSmartMedicalMessage(chatId, reply, "Markdown");
        
        this.logActivity({
          id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          chatId,
          userName,
          userHandle,
          userMessage: text,
          aiResponse: reply,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          source: 'telegram',
        });

      } catch (err: any) {
        console.error("[Telegram] YouTube error:", err);
        await this.sendMessage(chatId, "⚠️ *Error processing YouTube Video*\n\nI could not fetch the transcript for this video. It might not have closed captions enabled or it may be restricted.", "Markdown");
      }
      return;
    }

    // 6. Medical Image Search Request (e.g. "heart image", "send image of kidney", "/image lungs")
    // Strictly triggers ONLY when user explicitly asks for an image ("only when i say to do so")
    const imageReq = detectImageRequest(text);
    if (imageReq.isRequest && imageReq.subject) {
      await this.handleImageSearchRequest(chatId, sender, userName, userHandle, text, imageReq.subject);
      return;
    }

    // 7. General Conversational / Medical Question
    if (!this.config.botActive) {
      await this.sendMessage(chatId, "⚠️ The medical AI assistant is currently paused by the administrator. Please check back shortly.");
      return;
    }

    await this.sendChatAction(chatId, "typing");
    const history = this.chatHistories.get(chatId) || [];

    try {
      const { text: reply, latencyMs, modelUsed } = await generateGeminiReply(
        text,
        history,
        this.getSystemPrompt(chatId),
        this.config.temperature,
        [],
        this.config.model
      );

      history.push({ role: 'user', text });
      history.push({ role: 'model', text: reply });
      if (history.length > 12) {
        this.chatHistories.set(chatId, history.slice(-12));
      } else {
        this.chatHistories.set(chatId, history);
      }

      this.totalLatencySum += latencyMs;
      this.totalLatencyCount++;
      this.stats.averageLatencyMs = Math.round(this.totalLatencySum / this.totalLatencyCount);

      // Send to Telegram with smart visual table rendering
      await this.sendSmartMedicalMessage(chatId, reply, "Markdown");
      this.lastBotResponseByChat.set(chatId, {
        text: reply,
        topic: text.slice(0, 40) || "Clinical Discussion",
        sourceType: 'general',
        timestamp: Date.now(),
      });

      this.logActivity({
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: text,
        aiResponse: reply,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'telegram',
      });
    } catch (err: any) {
      this.stats.totalErrors++;
      const errorMessage = err.message || "Error generating response";
      const isQuota = errorMessage.includes("quota") || errorMessage.includes("429");
      const fallbackReply = isQuota
        ? "🩺 *Medchat AI Notice:*\n\nThe Gemini API quota is temporarily reached for this key. Please check your Google AI Studio plan & billing in Settings. Once refreshed, responses will resume immediately."
        : "Doctor, I encountered a temporary issue generating that medical explanation. Please re-send your question.";
      await this.sendMessage(chatId, fallbackReply, "Markdown");

      this.logActivity({
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: text,
        aiResponse: fallbackReply,
        latencyMs: 0,
        timestamp: new Date().toISOString(),
        status: 'error',
        errorMessage,
        source: 'telegram',
      });
    }
  }

  // Handle explicit image search requests (e.g. "heart image", "send image of kidney", "lungs diagrams")
  // User directive: Returns 2-5 high-yield images without sub buttons
  public async handleImageSearchRequest(
    chatId: number | string,
    sender: any,
    userName: string,
    userHandle: string | undefined,
    userMessage: string,
    subject: string
  ): Promise<void> {
    if (!this.config.botActive) {
      await this.sendMessage(chatId, "⚠️ The medical AI assistant is currently paused by the administrator.");
      return;
    }

    await this.sendChatAction(chatId, "upload_photo");
    const startTime = Date.now();

    try {
      const imageResults = await searchMedicalImages(subject, 2, 5);

      const prompt = `The medical student specifically requested medical diagrams and illustrations of "${subject}" (prompt: "${userMessage}").
${imageResults.length > 0 ? `${imageResults.length} high-quality clinical/anatomical diagrams and illustrations (including ${imageResults.map(i => `"${i.title}"`).join(', ')}) were retrieved and delivered to the student.` : `No direct image file was found in the database, but provide an in-depth clinical anatomical walkthrough.`}

Please provide an educational clinical and anatomical guide:
1. 🫀 **Anatomical Landmarks & Structures**: Key visible structures, relations, borders, and tissue layers.
2. ⚡ **Functional & Physiological Relevance**: Blood supply, innervation, and core physiological role.
3. 💡 **High-Yield Clinical Pearls**: Classic pathologies, board exam buzzwords, or physical exam findings associated with ${subject}.

CRITICAL INSTRUCTION:
- DO NOT generate, append, or attach any multiple-choice questions (MCQ), quizzes, or practice tests! The user asked for images and explanation only.`;

      const { text: explanation } = await generateGeminiReply(
        prompt,
        [],
        this.getSystemPrompt(chatId),
        this.config.temperature,
        [],
        this.config.model
      );

      const latencyMs = Date.now() - startTime;
      this.totalLatencySum += latencyMs;
      this.totalLatencyCount++;
      this.stats.averageLatencyMs = Math.round(this.totalLatencySum / this.totalLatencyCount);
      this.stats.imagesProcessed += Math.max(1, imageResults.length);

      if (imageResults.length > 0) {
        // Send media group (album) of 2-5 images
        const mediaGroup = imageResults.map((img, idx) => ({
          type: 'photo' as const,
          media: img.url,
          caption: idx === 0 ? `📸 *${img.title}* (1 of ${imageResults.length})\n_${img.source}_` : undefined,
          parse_mode: 'Markdown',
        }));

        let groupSent = await this.sendMediaGroup(chatId, mediaGroup);

        if (!groupSent) {
          // Fallback: send individual photos without sub buttons
          for (let i = 0; i < imageResults.length; i++) {
            const img = imageResults[i];
            await this.sendPhoto(chatId, img.url, `📸 *${img.title}* (${i + 1}/${imageResults.length})\n_${img.source}_`);
          }
        }

        // Send anatomical & clinical explanation without sub buttons
        await this.sendMessage(chatId, explanation, "Markdown");

        this.logActivity({
          id: `img-req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          chatId,
          userName,
          userHandle,
          userMessage,
          aiResponse: explanation,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          source: 'telegram',
          mediaType: 'image',
          fileName: `${subject.replace(/\s+/g, '_')}_x${imageResults.length}.jpg`,
        });
      } else {
        const noImgMsg = `🩺 *${subject.toUpperCase()}* - Visual & Clinical Breakdown\n\nI searched medical databases for images of *${subject}*, but could not retrieve direct photo files. Here is the anatomical breakdown:\n\n${explanation}`;
        await this.sendMessage(chatId, noImgMsg, "Markdown");

        this.logActivity({
          id: `img-req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          chatId,
          userName,
          userHandle,
          userMessage,
          aiResponse: noImgMsg,
          latencyMs,
          timestamp: new Date().toISOString(),
          status: 'success',
          source: 'telegram',
        });
      }
    } catch (err: any) {
      console.error("[Telegram] Image search error:", err);
      await this.sendMessage(chatId, `⚠️ Could not retrieve images for *${subject}*. Please try another medical term.`);
    }
  }

  public async testWebChat(
    prompt: string,
    attachments: MediaAttachment[] = []
  ): Promise<{
    reply: string;
    latencyMs: number;
    imageUrl?: string;
    images?: Array<{ url: string; title: string; source: string; description?: string }>;
    quiz?: QuizData;
    quizzes?: QuizData[];
  }> {
    // 1. Check if user is requesting an interactive quiz or rapid-fire exam
    const intent = parseUserPromptIntent(prompt);
    const isQuizPrompt = intent.isRapidFire || intent.isPollRequested || /\bquiz(?:zes)?\b/i.test(prompt) || prompt.trim().startsWith("/quiz") || prompt.trim().startsWith("/rapidfire");
    if (isQuizPrompt && (!attachments || attachments.length === 0)) {
      const { quizzes, textSummary, latencyMs, count, topic } = await this.generateInteractiveQuizzes(prompt);

      const countdownSec = intent.customTimerSeconds || this.config.rapidFireCountdownSeconds || 30;
      const formattedQuizzes = quizzes.map((q, idx) => ({
        ...q,
        isRapidFire: intent.isRapidFire,
        countdownSeconds: intent.isRapidFire ? countdownSec : undefined,
      }));

      this.stats.totalMessages++;
      this.totalLatencySum += latencyMs;
      this.totalLatencyCount++;
      this.stats.averageLatencyMs = Math.round(this.totalLatencySum / this.totalLatencyCount);

      this.logActivity({
        id: `test-quiz-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId: "Web Simulator",
        userName: "Medical Student (Web)",
        userMessage: prompt,
        aiResponse: textSummary,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'web_test',
      });

      return {
        reply: textSummary,
        latencyMs,
        quiz: formattedQuizzes[0],
        quizzes: formattedQuizzes,
      };
    }

    // 2. Check if user is asking for an image (e.g. "heart image", "heart images")
    const imageReq = detectImageRequest(prompt);
    if (imageReq.isRequest && imageReq.subject && (!attachments || attachments.length === 0)) {
      const startTime = Date.now();
      const imageResults = await searchMedicalImages(imageReq.subject, 2, 5);

      const promptText = `The medical student specifically requested medical images of "${imageReq.subject}" (prompt: "${prompt}").
${imageResults.length > 0 ? `${imageResults.length} high-yield medical diagrams titled ${imageResults.map(i => `"${i.title}"`).join(', ')} have been retrieved and displayed.` : ''}
Provide a high-yield medical and anatomical description of ${imageReq.subject} covering key structures, relations, blood supply/innervation, and high-yield clinical pearls.
CRITICAL INSTRUCTION: DO NOT generate or attach any multiple-choice questions (MCQ), quiz, or practice questions. Answer with clinical explanation only.`;

      const { text: reply } = await generateGeminiReply(
        promptText,
        [],
        this.config.systemInstruction,
        this.config.temperature,
        [],
        this.config.model
      );

      const latencyMs = Date.now() - startTime;
      this.stats.totalMessages++;
      this.stats.imagesProcessed += Math.max(1, imageResults.length);
      this.totalLatencySum += latencyMs;
      this.totalLatencyCount++;
      this.stats.averageLatencyMs = Math.round(this.totalLatencySum / this.totalLatencyCount);

      this.logActivity({
        id: `test-img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId: "Web Simulator",
        userName: "Medical Student (Web)",
        userMessage: prompt,
        aiResponse: reply,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'web_test',
        mediaType: 'image',
        fileName: `${imageReq.subject.replace(/\s+/g, '_')}_x${imageResults.length}.jpg`,
      });

      return {
        reply,
        latencyMs,
        imageUrl: imageResults[0]?.url,
        images: imageResults.map(img => ({
          url: img.url,
          title: img.title,
          source: img.source,
          description: img.description,
        })),
      };
    }

    const { text: reply, latencyMs } = await generateGeminiReply(
      prompt,
      [],
      this.getSystemPrompt("web_simulator"),
      this.config.temperature,
      attachments,
      this.config.model
    );

    this.stats.totalMessages++;
    if (attachments.some(a => a.mimeType.startsWith("image/"))) {
      this.stats.imagesProcessed++;
    }
    if (attachments.some(a => a.mimeType.includes("pdf") || a.mimeType.startsWith("text/"))) {
      this.stats.documentsProcessed++;
    }

    this.totalLatencySum += latencyMs;
    this.totalLatencyCount++;
    this.stats.averageLatencyMs = Math.round(this.totalLatencySum / this.totalLatencyCount);

    const firstAtt = attachments[0];
    const mediaType = firstAtt ? (firstAtt.mimeType.startsWith("image/") ? "image" : "document") : undefined;

    this.logActivity({
      id: `test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      chatId: "Web Simulator",
      userName: "Medical Student (Web)",
      userMessage: prompt,
      aiResponse: reply,
      latencyMs,
      timestamp: new Date().toISOString(),
      status: 'success',
      source: 'web_test',
      mediaType,
      fileName: firstAtt?.fileName,
    });

    return { reply, latencyMs };
  }

  private logActivity(entry: MessageLogEntry): void {
    this.logs.unshift(entry);
    if (this.logs.length > 100) {
      this.logs.pop();
    }
  }

  public getLogs(): MessageLogEntry[] {
    return this.logs;
  }

  public clearLogs(): void {
    this.logs = [];
  }

  public updateConfig(newConfig: Partial<typeof this.config>): void {
    this.config = { ...this.config, ...newConfig };
    this.syncAndPersistState();
    if (newConfig.pollingEnabled !== undefined) {
      if (newConfig.pollingEnabled && !this.isPollingActive) {
        this.startPolling();
      } else if (!newConfig.pollingEnabled && this.isPollingActive) {
        this.stopPolling();
      }
    }
  }

  public getStatus(appUrl: string = ""): any {
    return {
      isOnline: !!this.botInfo && !this.botError,
      botInfo: this.botInfo,
      botError: this.botError,
      mode: this.mode,
      webhookInfo: this.webhookInfo,
      config: this.config,
      stats: {
        ...this.stats,
        activeChatsCount: this.chatHistories.size,
      },
      geminiReady: true,
      geminiModel: this.config.model,
      appUrl: appUrl || process.env.APP_URL || "",
    };
  }
}

export const telegramBot = new TelegramBotManager();
