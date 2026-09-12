import fs from "fs";
import path from "path";
import { DEFAULT_MEDICAL_PROMPT } from "../src/constants";

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

export interface BotConfigData {
  systemInstruction: string;
  temperature: number;
  botActive: boolean;
  pollingEnabled: boolean;
  model: string;
  medicalSpecialty: string;
  examLevel: string;
  activeSubjects: string[];
  rapidFireCountdownSeconds?: number;
}

export interface BotPersistentState {
  version: number;
  adminChatIds: Array<string | number>;
  adminUsernames: string[];
  approvedUsers: AuthorizedUser[];
  approvedUsernames: string[];
  pendingRequests: PendingUserRequest[];
  accessControlEnabled: boolean;
  adminSecret: string;
  config: BotConfigData;
  customSystemPrompts: Record<string, string>;
  autoPostTopics: string[];
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

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "bot_state.json");

export function getDefaultBotState(): BotPersistentState {
  return {
    version: 1,
    adminChatIds: [],
    adminUsernames: [],
    approvedUsers: [],
    approvedUsernames: [],
    pendingRequests: [],
    accessControlEnabled: true,
    adminSecret: process.env.ADMIN_SECRET || "medadmin2026",
    config: {
      systemInstruction: DEFAULT_MEDICAL_PROMPT,
      temperature: 0.4,
      botActive: true,
      pollingEnabled: true,
      model: "gemini-3.8-flash",
      medicalSpecialty: "All Medical Sciences",
      examLevel: "USMLE Step 1 / 2 CK & Board Prep",
      activeSubjects: ["Anatomy", "Physiology", "Biochemistry", "Microbiology", "Pathology", "Pharmacology"],
      rapidFireCountdownSeconds: 30,
    },
    customSystemPrompts: {},
    autoPostTopics: [],
    stats: {
      totalMessages: 0,
      totalErrors: 0,
      averageLatencyMs: 0,
      activeChatsCount: 0,
      mcqsGenerated: 0,
      examTipsShared: 0,
      imagesProcessed: 0,
      documentsProcessed: 0,
      startedAt: new Date().toISOString(),
      lastActiveAt: undefined,
    },
  };
}

export class BotPersistenceService {
  private static instance: BotPersistenceService;
  private state: BotPersistentState;
  private saveTimeout: NodeJS.Timeout | null = null;

  private constructor() {
    this.state = this.loadState();
  }

  public static getInstance(): BotPersistenceService {
    if (!BotPersistenceService.instance) {
      BotPersistenceService.instance = new BotPersistenceService();
    }
    return BotPersistenceService.instance;
  }

  private ensureDirExists(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (err) {
      console.error("[BotPersistence] Failed to create data directory:", err);
    }
  }

  private loadState(): BotPersistentState {
    this.ensureDirExists();
    const defaultState = getDefaultBotState();

    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);

        // Merge loaded state with defaults to preserve integrity
        return {
          ...defaultState,
          ...parsed,
          adminChatIds: Array.isArray(parsed.adminChatIds) ? parsed.adminChatIds : [],
          adminUsernames: Array.isArray(parsed.adminUsernames) ? parsed.adminUsernames : [],
          approvedUsers: Array.isArray(parsed.approvedUsers) ? parsed.approvedUsers : [],
          approvedUsernames: Array.isArray(parsed.approvedUsernames) ? parsed.approvedUsernames : [],
          pendingRequests: Array.isArray(parsed.pendingRequests) ? parsed.pendingRequests : [],
          accessControlEnabled: typeof parsed.accessControlEnabled === "boolean" ? parsed.accessControlEnabled : true,
          adminSecret: parsed.adminSecret || defaultState.adminSecret,
          config: {
            ...defaultState.config,
            ...(parsed.config || {}),
          },
          customSystemPrompts: parsed.customSystemPrompts || {},
          stats: {
            ...defaultState.stats,
            ...(parsed.stats || {}),
          },
        };
      }
    } catch (err) {
      console.error("[BotPersistence] Error reading state file, using defaults:", err);
    }

    return defaultState;
  }

  public getState(): BotPersistentState {
    return this.state;
  }

  public saveStateSync(): void {
    try {
      this.ensureDirExists();
      const tempFile = `${DATA_FILE}.tmp.${Date.now()}`;
      const payload = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(tempFile, payload, "utf-8");
      fs.renameSync(tempFile, DATA_FILE);
    } catch (err) {
      console.error("[BotPersistence] Failed to write state file:", err);
    }
  }

  public scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    // Debounce save for fast in-memory ops, while guaranteeing quick disk write
    this.saveTimeout = setTimeout(() => {
      this.saveStateSync();
      this.saveTimeout = null;
    }, 200);
  }
}
