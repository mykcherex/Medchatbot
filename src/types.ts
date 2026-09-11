export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface BotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface BotConfig {
  systemInstruction: string;
  temperature: number;
  botActive: boolean;
  pollingEnabled: boolean;
  model: string;
  medicalSpecialty?: string;
  examLevel?: string;
  activeSubjects?: string[];
}

export interface MediaAttachment {
  mimeType: string;
  data: string; // base64
  fileName?: string;
  fileSize?: number;
}

export interface MedicalImage {
  url: string;
  title: string;
  source: string;
  description?: string;
}

export interface QuizPollData {
  scenario?: string;
  question: string;
  options: string[];
  correctOptionId: number;
  explanation: string;
  fullRationale?: string;
  topic?: string;
}

export interface BotStats {
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
}

export interface MessageLog {
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

export interface BotStatusResponse {
  isOnline: boolean;
  botInfo: BotInfo | null;
  botError: string | null;
  mode: 'polling' | 'webhook' | 'idle';
  webhookInfo: {
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
  } | null;
  config: BotConfig;
  stats: BotStats;
  geminiReady: boolean;
  geminiModel: string;
  appUrl: string;
}
