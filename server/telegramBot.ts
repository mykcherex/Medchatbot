import { generateGeminiReply, ConversationTurn, MediaAttachment } from "./geminiService";
import { detectImageRequest, searchMedicalImages, searchMedicalImage, ImageSearchResult } from "./imageSearchService";
import { generateMedicalPdf } from "./pdfService";

export interface QuizData {
  scenario?: string;
  question: string;
  options: string[];
  correctOptionId: number;
  explanation: string;
  fullRationale?: string;
  topic?: string;
}

export interface ParsedQuizRequest {
  count: number;
  topic: string;
  allowScenario: boolean;
  userPrompt: string;
}

export function parseQuizPrompt(rawPrompt: string): ParsedQuizRequest {
  const text = (rawPrompt || "").trim();

  // 1. Check if user explicitly requests a clinical case / scenario / patient vignette
  const allowScenario = /\b(clinical case|clinical scenario|vignette|patient|case study|clinical vignette|patient vignette)\b/i.test(text);

  // 2. Extract count (e.g. "30 quizzes", "10 quiz", "/quiz 5", "generate 20 quizzes")
  let count = 1;
  const countRegexes = [
    /\b(\d+)\s*(?:quizzes|quiz|questions|mcqs|items)\b/i,
    /(?:generate|give me|create|send|make|produce)\s*(\d+)\s*(?:quizzes|quiz|questions|mcqs|items)?/i,
    /(?:\/quiz|quiz)\s*(\d+)\b/i,
    /\b(\d+)\s*(?:interactive\s*)?quiz(?:zes)?\b/i
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

  // Cap count between 1 and 50 to ensure reliability and avoid rate limits
  count = Math.min(Math.max(1, count), 50);

  // 3. Extract topic cleanly
  let topic = text
    .replace(/^\/quiz\s*/i, "")
    .replace(/(?:generate|give me|create|send|make|produce|test me with)\s*/i, "")
    .replace(/\b\d+\s*(?:quizzes|quiz|questions|mcqs|items)?\b/gi, "")
    .replace(/\b(quiz me on|quiz on|quizzes on|interactive quiz|quiz|quizzes)\b/gi, "")
    .replace(/\b(please|can you|i want|give|provide)\b/gi, "")
    .replace(/\b(clinical case|clinical scenario|vignette|case study)\b/gi, "")
    .trim();

  topic = topic.replace(/^[:\-\s,]+|[:\-\s,]+$/g, "").trim();
  if (!topic) {
    topic = "General Medical Sciences";
  }

  return {
    count,
    topic,
    allowScenario,
    userPrompt: text,
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

export const DEFAULT_MEDICAL_PROMPT = `You are Medchat, an elite Medical Sciences Professor, Board-Examiner (USMLE Step 1 & 2 CK, NEET-PG, PLAB, NCLEX), and Clinical Educator powered by Google Gemini.

SPECIALTY SCOPE:
You specialize strictly and deeply in ALL medical sciences:
1. Gross Anatomy, Neuroanatomy, Histology, and Embryology (anatomical relations, cranial nerves, vascular supply, embryological derivatives).
2. Medical Physiology (Cardiovascular, Renal, Respiratory, Neuro, GI, Endocrine, Acid-Base balance, cellular transport).
3. Medical Biochemistry & Clinical Genetics (Metabolic pathways, enzyme kinetics, inborn errors of metabolism, vitamin deficiencies, molecular genetics).
4. Medical Microbiology & Immunology (Bacteriology, Virology, Mycology, Parasitology, Antimicrobials, Innate/Adaptive immunity, Hypersensitivity reactions).
5. General & Systemic Pathology (Pathophysiology of disease, classic histopathology clues, diagnostic lab markers, morphologic features).
6. Medical Pharmacology (Mechanisms of Action, Pharmacokinetics/Dynamics, High-yield adverse drug reactions, Drug-drug interactions, Antidotes, First-line clinical guidelines).
7. Clinical Medicine & Diagnostic Reasoning (Internal Medicine, Emergency Medicine, Surgery, Pediatrics, OB/GYN).

CORE BEHAVIORS & INSTRUCTIONS:
- Target Audience: Medical students, clinical trainees, and healthcare professionals preparing for exams and rounds.
- Strict Domain Focus: You are strictly dedicated to medical sciences and clinical education. If a user asks non-medical questions, politely inform them that you specialize exclusively in medical education.
- Clinical Precision & High-Yield: Always emphasize precise physiological mechanisms, receptor actions, gold-standard diagnostic steps, and classic buzzwords (e.g., 'currant jelly sputum', 'bite cells & Heinz bodies', 'tram-track appearance', 'Koplik spots').
- Telegram Formatting: Use clean Telegram markdown with bold headings, bullet points, and concise clinical explanations optimized for mobile reading.

CRITICAL QUESTION GENERATION POLICY:
- DO NOT automatically generate a multiple-choice question (MCQ), quiz, or practice test for every prompt!
- Let question generation DEPEND ON THE SITUATION AND USER INTENT:
  * If the user asks for an explanation, fact, definition, summary, image, or diagnosis (e.g. "explain heart failure", "what is the mechanism of action of metformin?", "heart image", "hi"): provide a thorough, crystal-clear, high-yield explanation WITHOUT appending an unsolicited test question or quiz.
  * ONLY generate practice questions, MCQs, or quizzes when the user explicitly asks for them (e.g. commands like /mcq, /pharm, /anatomy, or phrases like "give me an MCQ", "quiz me", "test my knowledge", "practice question", or when answering a practice quiz).

MULTIMODAL (ANATOMICAL IMAGES, RADIOLOGY, HISTOLOGY & DOCUMENTS) CLINICAL RULES:
- When analyzing anatomical images, diagrams, cadaveric dissections, cross-sections, or surgical views:
  * Precisely identify, delineate, and explain EVERY visible organ, muscle, bone, vessel, and nerve.
  * Thoroughly detail spatial and relational anatomy: anterior/posterior, medial/lateral, superior/inferior borders, fascial compartments, and anatomical triangles.
  * Detail neurovascular supply: specific arterial branches, venous drainage, nerve roots, motor/sensory innervation, and lymphatic pathways.
  * Highlight clinical & surgical correlates: compression sites (e.g., carpal tunnel, cubital tunnel, thoracic outlet), surgical danger zones, injury nerve palsy deficits, and referred pain pathways.
  * Provide high-yield board exam associations: embryological origins, anatomical variations, and memorable mnemonics.
  * DO NOT formulate an unsolicited MCQ unless the user explicitly requested one.
- When analyzing radiological imaging (X-Ray, CT, MRI, Ultrasound, Angiography):
  * State the modality, projection/plane, contrast status, and windowing.
  * Perform a systematic anatomical survey of the region.
  * Characterize the primary abnormality: anatomical location, attenuation/signal intensity (e.g., T1/T2, FLAIR, DWI restriction, hypodensity/hyperdensity), margins, and mass effect.
  * Formulate an evidence-based differential diagnosis ranked by probability with next diagnostic step.
- When analyzing histopathology micrographs:
  * Specify tissue of origin, histological stain (e.g. H&E, Trichrome, Silver, PAS, Congo Red).
  * Describe cellular architecture, cytology, nuclear features, pathognomonic hallmarks (e.g., Reed-Sternberg cells, Auer rods, Councilman bodies, Psammoma bodies, granulomas), and molecular correlates.
- When reading and processing medical documents (PDF lecture notes, clinical guidelines, research papers, clinical notes, text):
  * Deliver an exhaustive, high-yield structured synthesis:
    1) Executive Clinical Summary & Key Concepts
    2) Core Pathophysiological / Pharmacological / Anatomical Mechanisms
    3) Diagnostic Algorithms & Therapeutic Management Tables
    4) High-Yield USMLE / Board Exam Pearls, Common Traps, and Mnemonics
  * If the user asks a specific question or query regarding the document, provide a comprehensive, direct, evidence-based answer referencing the document's specific data, findings, or recommendations.
  * DO NOT force practice MCQs unless the user explicitly requested questions or quizzes in their query.

MCQ & QUIZ GENERATION RULES (WHEN EXPLICITLY REQUESTED):
When generating MCQs, quizzes, or practice questions:
- STRICTLY FOLLOW USER INTENT & SCOPE:
  * If the user asks for a specific subject or topic (e.g. "Heart anatomy", "Pharmacology mechanisms", "Renal acid-base"), strictly focus on that topic.
  * CLINICAL VIGNETTE vs DIRECT CONCEPTUAL QUESTION: ONLY generate a clinical patient scenario/vignette if the user EXPLICITLY requested a clinical case, patient vignette, scenario, or case study. If the user asks for direct subject questions or quizzes (e.g. "Heart anatomy quiz", "Beta blockers quiz"), ask direct, high-yield questions testing anatomical/biological facts WITHOUT fabricating an unwanted patient clinical scenario!
  * QUANTITY / COUNT: If the user requests a specific number of quizzes or questions (e.g. "30 quizzes", "10 questions", "5 mcqs"), generate that exact requested quantity.
- Question Structure:
  * Sharp question stem testing higher-order understanding.
  * 4 or 5 options labeled A), B), C), D), and optionally E).
  * 'Correct Answer' and 'Detailed Rationale' explaining mechanism, distractor breakdowns, and high-yield clinical pearl.

EXAM TIPS & MNEMONICS RULES:
When providing exam tips:
- Provide high-yield, tested medical exam strategies and memorable medical mnemonics.`;

function sanitizeTelegramMarkdown(text: string): string {
  if (!text) return "";
  // In Telegram legacy Markdown, underscores between alphanumeric characters
  // (e.g. CYP3A4_substrate, H+_ATPase, Na_K_pump) cause syntax parse errors unless escaped.
  return text.replace(/([a-zA-Z0-9])_([a-zA-Z0-9])/g, "$1\\_$2");
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
      sourceType: 'general' | 'image' | 'document' | 'mcq' | 'quiz' | 'exam_tips';
      timestamp: number;
    }
  > = new Map();
  private customSystemPrompts: Map<number | string, string> = new Map();
  private userStates: Map<number | string, string> = new Map();
  private logs: MessageLogEntry[] = [];
  private totalLatencySum: number = 0;
  private totalLatencyCount: number = 0;

  private config = {
    systemInstruction: DEFAULT_MEDICAL_PROMPT,
    temperature: 0.4,
    botActive: true,
    pollingEnabled: true,
    model: "gemini-3.8-flash",
    medicalSpecialty: "All Medical Sciences",
    examLevel: "USMLE Step 1 / 2 CK & Board Prep",
    activeSubjects: ["Anatomy", "Physiology", "Biochemistry", "Microbiology", "Pathology", "Pharmacology"],
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

  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || "8862664585:AAFVFulDGYrS_pPdfcFH-peILkbHZVi-84A";
  }

  public getApiBase(): string {
    return `https://api.telegram.org/bot${this.token}`;
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
    isAnonymous: boolean = false
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

  // Telegram Document Upload (e.g. PDF generation & download)
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

  // Telegram Keyboards
  public getMainInlineKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: "📊 Interactive Quiz Poll", callback_data: "action_quiz_random" },
          { text: "🎯 Clinical Board MCQ", callback_data: "action_mcq_random" },
        ],
        [
          { text: "💡 Medical Exam Tips", callback_data: "action_exam_tips" },
          { text: "📄 Export PDF Notes", callback_data: "action_export_pdf" },
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
        [{ text: "📊 Interactive Quiz" }, { text: "🎯 High-Yield MCQ" }],
        [{ text: "💡 Exam Tips & Mnemonics" }, { text: "📄 Download Notes PDF" }],
        [{ text: "📸 Medical Vision & Docs Guide" }, { text: "📋 Medical Menu" }],
        [{ text: "💊 Pharmacology MCQ" }, { text: "🫀 Anatomy / Physio MCQ" }],
        [{ text: "🔬 Pathology & Micro MCQ" }, { text: "🧬 Biochemistry MCQ" }],
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
          { text: "💡 Medical Exam Tip", callback_data: "action_exam_tips" },
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

  // Interactive Telegram-style Medical Quiz Generator (Supports Multiple Quizzes & User Intent)
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
  }> {
    const startTime = Date.now();
    const parsed = parseQuizPrompt(userPrompt);
    const count = countOverride !== undefined && countOverride > 0 ? countOverride : parsed.count;
    const topic = topicOverride || parsed.topic;
    const allowScenario = parsed.allowScenario;

    // We generate quizzes in batches of at most 10 for parallel speed and reliability
    const batchSizes: number[] = [];
    let remaining = count;
    while (remaining > 0) {
      const b = Math.min(remaining, 10);
      batchSizes.push(b);
      remaining -= b;
    }

    const batchPromises = batchSizes.map((batchCount, batchIdx) =>
      this.generateQuizBatch(topic, batchCount, allowScenario, userPrompt, batchIdx, batchSizes.length, attachments)
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
          scenario: allowScenario ? "A 52-year-old patient presents for evaluation." : "",
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
    };
  }

  private async generateQuizBatch(
    topic: string,
    count: number,
    allowScenario: boolean,
    userPrompt: string,
    batchIndex: number,
    totalBatches: number,
    attachments: MediaAttachment[] = []
  ): Promise<QuizData[]> {
    const focus = totalBatches > 1
      ? `(Batch ${batchIndex + 1} of ${totalBatches}: Focus on diverse aspects, mechanisms, structures, and common exam traps for ${topic})`
      : "";

    const scenarioDirective = allowScenario
      ? `Include a concise clinical patient case in "scenario" for each question.`
      : `CRITICAL INSTRUCTION: The user prompt is "${userPrompt}". The user asked for direct questions on "${topic}" without asking for a clinical scenario! DO NOT generate any patient scenarios or clinical case vignettes. Set "scenario" to "" (empty string) for every question, and make each "question" test ${topic} directly and clearly.`;

    const prompt = `Generate exactly ${count} distinct, high-yield, interactive multiple-choice quiz questions specifically testing "${topic}". ${focus}

USER INTENT & CUSTOM INSTRUCTIONS:
The user specifically requested: "${userPrompt}"
CRITICAL: You MUST strictly adapt the difficulty, style, and specific focus to perfectly match what the user requested above. If they asked for hard questions, make them extremely challenging. If they asked for a specific topic, only focus on that.

SCENARIO RULE:
${scenarioDirective}

Respond ONLY with a valid JSON array containing exactly ${count} object(s), with NO markdown formatting, NO backticks, and NO surrounding text:
[
  {
    "scenario": "${allowScenario ? "Brief patient vignette" : ""}",
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
    "topic": "${topic}"
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

    if (!chatId) {
      await this.answerCallbackQuery(queryId, "Action received");
      return;
    }

    await this.answerCallbackQuery(queryId, "Generating high-yield medical content...");
    await this.sendChatAction(chatId, "typing");

    try {
      if (data.startsWith("action_quiz_")) {
        const subject = data.replace("action_quiz_", "");
        const cleanSubject = subject === "random" ? "General Medical Board Review" : subject;
        const { quiz, textSummary, latencyMs } = await this.generateInteractiveQuiz(cleanSubject);

        if (quiz.scenario && quiz.scenario.trim().length > 0) {
          await this.sendMessage(chatId, `📋 *Clinical Case Vignette:*\n\n${quiz.scenario}`, "Markdown");
        }

        await this.sendPoll(chatId, quiz.question, quiz.options, quiz.correctOptionId, quiz.explanation, false);
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
        await this.sendChatAction(chatId, "upload_document");
        const history = this.chatHistories.get(chatId) || [];
        const lastModelMsg = [...history].reverse().find((t) => t.role === "model");
        const contentToConvert = lastModelMsg?.text || `# Medchat Medical Study Notes\n\nHigh-Yield Medical Sciences review compiled by Medchat AI.\n\n## Core Board Review Topics\n* High-yield pathology and pharmacology\n* Interactive USMLE quiz questions\n* Clinical vignettes & active recall`;

        const pdfBuffer = await generateMedicalPdf(contentToConvert, {
          title: "Medchat Clinical Notes",
          topic: "Medical Sciences Board Review",
        });

        await this.sendDocument(chatId, pdfBuffer, "Medchat_Notes.pdf", "🩺 Here are your downloadable Medchat clinical notes in PDF format.");
      } else if (data.startsWith("action_mcq_")) {
        const subject = data.replace("action_mcq_", "");
        const cleanSubject = subject === "random" ? "medical sciences" : subject;
        const { text, latencyMs } = await this.generateClinicalMcq(cleanSubject);
        await this.sendMessage(chatId, text, "Markdown");

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
    if (!this.config.botActive) {
      await this.sendMessage(chatId, "⚠️ The medical AI assistant is currently paused by the administrator.");
      return;
    }

    this.stats.lastActiveAt = new Date().toISOString();
    this.stats.totalMessages++;
    if (!this.chatHistories.has(chatId)) {
      this.stats.activeChatsCount++;
    }

    await this.sendChatAction(chatId, "typing");
    await this.sendMessage(chatId, "🩺 *Analyzing medical image...* Examining cellular features, radiological findings, or anatomical structures with Gemini vision.", "Markdown");

    const filePath = await this.getTelegramFilePath(fileId);
    if (!filePath) {
      await this.sendMessage(chatId, "⚠️ Could not retrieve the image from Telegram servers. Please re-upload or try again.");
      return;
    }

    const fileBuffer = await this.downloadTelegramFile(filePath);
    if (!fileBuffer) {
      await this.sendMessage(chatId, "⚠️ Failed to download the image. Please try again.");
      return;
    }

    const base64Data = fileBuffer.toString("base64");
    const detectedMime = mimeType || (filePath.endsWith(".png") ? "image/png" : "image/jpeg");

    const userWantsQuestion = Boolean(caption && /mcq|quiz|question|test|exam/i.test(caption));

    if (userWantsQuestion) {
      await this.sendMessage(chatId, `🎯 *Generating interactive quiz polls based on your uploaded image...*`, "Markdown");
      try {
        const { quizzes, textSummary } = await this.generateInteractiveQuizzes(
          caption || "Medical Image Quiz",
          fileName || "Image Analysis",
          5,
          [{ mimeType: detectedMime, data: base64Data, fileName: fileName || "medical_image.jpg" }]
        );

        for (let i = 0; i < quizzes.length; i++) {
          const quiz = quizzes[i];
          const questionStem = quizzes.length > 1 ? `[${i + 1}/${quizzes.length}] ${quiz.question}` : quiz.question;
          await this.sendPoll(chatId, questionStem.slice(0, 290), quiz.options, quiz.correctOptionId, quiz.explanation, false);
          if (quizzes.length > 1 && i < quizzes.length - 1) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        await this.sendMessage(chatId, `💡 *Tap your choice in the polls above!* \n📄 _Reply with_ \`/pdf\` _anytime to export full questions and explanations to a PDF document._`, "Markdown");

        const history = this.chatHistories.get(chatId) || [];
        history.push({ role: 'user', text: `[Medical Image Uploaded with Quiz: ${caption}]` });
        history.push({ role: 'model', text: textSummary });
        this.chatHistories.set(chatId, history.slice(-12));

        this.lastBotResponseByChat.set(chatId, {
          text: textSummary,
          topic: caption || "Image Quiz",
          sourceType: 'quiz',
          timestamp: Date.now(),
        });
        return;
      } catch (err: any) {
        console.error("[Telegram] Image quiz generation error:", err);
      }
    }

    const promptText = caption
      ? `[User Medical Query with Image]: "${caption}"

Please analyze this image with expert clinical, anatomical, and diagnostic precision:
1. Address the user's specific query: "${caption}" thoroughly and directly.
2. If this is an Anatomical Diagram, Cadaveric Dissection, or Cross-section:
   - Identify every visible and labeled structure (muscles, origins/insertions, vessels, nerves, bones, organs).
   - Detail their spatial relations (anterior/posterior, medial/lateral, superior/inferior), boundaries, and fascial planes.
   - Detail neurovascular supply: arterial branches, venous drainage, nerve roots, and motor/sensory innervation.
   - Clinical & surgical correlates: compression sites (e.g. carpal tunnel, cubital tunnel, thoracic outlet), danger zones, nerve palsy presentations, and functional tests.
3. If this is Radiological Imaging (X-Ray, CT, MRI, Ultrasound):
   - Modality, plane/projection, systematic survey, specific pathology/findings, and differential diagnosis with next diagnostic steps.
4. If this is Histopathology / Micrograph:
   - Tissue, staining, architectural pattern, cellular morphology, pathognomonic hallmarks, and disease pathophysiology.
5. High-yield board exam pearls and mnemonics.
${userWantsQuestion ? "Formulate 1 high-yield board exam practice MCQ based on this finding with correct answer and rationale." : "CRITICAL: DO NOT formulate or append any practice quiz or MCQ unless explicitly requested."}`
      : `Analyze this medical image with rigorous clinical and anatomical precision:

1. 🫀 **Anatomical & Structural Identification**:
   - If Anatomical Diagram or Dissection: Identify every visible organ, muscle, bone, vessel, and nerve. Detail spatial relations (medial/lateral/anterior/posterior), fascial compartments, and boundaries.
   - Specify neurovascular supply: arterial branches, venous drainage, nerve roots, and motor/sensory innervation.
   - Clinical/Surgical Correlates: Common compression sites, surgical danger zones, nerve deficit presentations, and functional tests.
2. 🔬 **Histopathology & Micrograph (if applicable)**:
   - Tissue of origin, staining technique, architectural pattern, cellular hallmarks (e.g. inclusion bodies, pleomorphism, inflammatory cells), and definitive diagnosis.
3. 🩻 **Radiology & Imaging (if applicable)**:
   - Modality, plane/projection, systematic anatomical survey, specific density/intensity abnormalities, and prioritized differential diagnosis with next clinical steps.
4. ⚡ **ECG / Rhythm Strip (if applicable)**:
   - Rate, rhythm, axis, PR/QRS/QTc intervals, ST/T wave changes, and clinical interpretation.
5. 💡 **High-Yield Board Exam Pearls & Mnemonics**:
   - High-yield associations, embryological origins, and memorable mnemonics.

CRITICAL INSTRUCTION: DO NOT generate or append any multiple-choice questions (MCQs) or quiz questions. Provide expert clinical and anatomical analysis only.`;

    const history = this.chatHistories.get(chatId) || [];

    try {
      const { text: reply, latencyMs } = await generateGeminiReply(
        promptText,
        history,
        this.getSystemPrompt(chatId),
        this.config.temperature,
        [{ mimeType: detectedMime, data: base64Data, fileName: fileName || "medical_image.jpg" }],
        this.config.model
      );

      history.push({ role: 'user', text: `[Medical Image Uploaded${caption ? `: ${caption}` : ''}]` });
      history.push({ role: 'model', text: reply });
      if (history.length > 12) {
        this.chatHistories.set(chatId, history.slice(-12));
      } else {
        this.chatHistories.set(chatId, history);
      }

      // Record as the latest bot response for instant /pdf compilation
      const detectedTopic = caption
        ? caption.slice(0, 40)
        : (fileName ? fileName.slice(0, 40) : "Anatomical & Medical Image Analysis");
      this.lastBotResponseByChat.set(chatId, {
        text: reply,
        topic: detectedTopic,
        sourceType: 'image',
        timestamp: Date.now(),
      });

      this.stats.imagesProcessed++;
      this.totalLatencySum += latencyMs;
      this.totalLatencyCount++;
      this.stats.averageLatencyMs = Math.round(this.totalLatencySum / this.totalLatencyCount);

      await this.sendMessage(chatId, reply, "Markdown");

      this.logActivity({
        id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        chatId,
        userName,
        userHandle,
        userMessage: caption ? `[Image] ${caption}` : `[Medical Image Upload]`,
        aiResponse: reply,
        latencyMs,
        timestamp: new Date().toISOString(),
        status: 'success',
        source: 'telegram',
        mediaType: 'image',
        fileName: fileName || 'image.jpg',
      });
    } catch (err: any) {
      console.error("[Telegram] Image processing error:", err);
      this.stats.totalErrors++;
      await this.sendMessage(chatId, "⚠️ Failed to complete medical image analysis. Please try again with another image or lower resolution.");
      this.logActivity({
        id: `err-${Date.now()}`,
        chatId,
        userName,
        userHandle,
        userMessage: caption ? `[Image Error] ${caption}` : `[Image Error]`,
        aiResponse: "",
        latencyMs: 0,
        timestamp: new Date().toISOString(),
        status: 'error',
        errorMessage: err.message || "Image vision error",
        source: 'telegram',
        mediaType: 'image',
      });
    }
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

    let promptText = "";
    let attachments: MediaAttachment[] = [];
    const userWantsQuestion = Boolean(caption && /mcq|quiz|question|test|exam/i.test(caption));

    if (userWantsQuestion) {
      await this.sendMessage(chatId, `🎯 *Generating interactive quiz polls based on your uploaded document (${fileName})...*`, "Markdown");
      try {
        let requestedCount = 5;
        if (caption) {
          const parsed = parseQuizPrompt(caption);
          if (parsed.count !== 1) {
            requestedCount = parsed.count;
          } else {
            const numMatch = caption.match(/\b(\d+)\b/);
            if (numMatch && parseInt(numMatch[1], 10) > 0 && parseInt(numMatch[1], 10) <= 50) {
              requestedCount = parseInt(numMatch[1], 10);
            }
          }
        }

        const docAttachments: MediaAttachment[] = isPdf ? [{ mimeType: "application/pdf", data: fileBuffer.toString("base64"), fileName }] : [];
        const { quizzes, textSummary } = await this.generateInteractiveQuizzes(
          caption || `Quiz on ${fileName}`,
          fileName.replace(/\.[^/.]+$/, ""),
          requestedCount,
          docAttachments
        );

        for (let i = 0; i < quizzes.length; i++) {
          const quiz = quizzes[i];
          const questionStem = quizzes.length > 1 ? `[${i + 1}/${quizzes.length}] ${quiz.question}` : quiz.question;
          await this.sendPoll(chatId, questionStem.slice(0, 290), quiz.options, quiz.correctOptionId, quiz.explanation, false);
          if (quizzes.length > 1 && i < quizzes.length - 1) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        await this.sendMessage(chatId, `💡 *Tap your choice in the polls above!* \n📄 _Reply with_ \`/pdf\` _anytime to export full questions and explanations to a PDF document._`, "Markdown");

        const history = this.chatHistories.get(chatId) || [];
        history.push({ role: 'user', text: `[Document Uploaded with Quiz: ${fileName} - ${caption}]` });
        history.push({ role: 'model', text: textSummary });
        this.chatHistories.set(chatId, history.slice(-12));

        this.lastBotResponseByChat.set(chatId, {
          text: textSummary,
          topic: caption || fileName,
          sourceType: 'quiz',
          timestamp: Date.now(),
        });
        return;
      } catch (err: any) {
        console.error("[Telegram] Document quiz generation error:", err);
      }
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
5. 💡 **High-Yield Board Exam Pearls & Mnemonics** (Exam associations, classic buzzwords, common pitfalls).
${userWantsQuestion ? "Include practice clinical MCQs with detailed explanations." : "CRITICAL: DO NOT append any MCQs or quiz questions unless explicitly requested."}`
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

Address the user's query with expert medical reasoning, quoting and synthesizing the relevant portions of the document. Provide high-yield clinical insights.${userWantsQuestion ? " Include practice MCQs as requested." : " DO NOT generate practice MCQs."}`
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
      if (history.length > 12) {
        this.chatHistories.set(chatId, history.slice(-12));
      } else {
        this.chatHistories.set(chatId, history);
      }

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

      await this.sendMessage(chatId, reply, "Markdown");

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

    // Check for Image / Photo message
    if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1]; // Highest resolution
      const caption = message.caption?.trim() || "";
      await this.handleImageMessage(chatId, sender, userName, userHandle, photo.file_id, caption);
      return;
    }

    // Check for Document message
    if (message.document) {
      const doc = message.document;
      const caption = message.caption?.trim() || "";
      // If it's an image sent as file/document
      if (doc.mime_type && doc.mime_type.startsWith("image/")) {
        await this.handleImageMessage(chatId, sender, userName, userHandle, doc.file_id, caption, doc.mime_type, doc.file_name);
        return;
      }
      // Medical document (PDF, TXT, MD, etc.)
      await this.handleDocumentMessage(chatId, sender, userName, userHandle, doc, caption);
      return;
    }

    if (!message.text) return;
    const text = message.text.trim();

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

    // 3. PDF Conversion and Download Requests
    const isPdfRequest =
      text.startsWith("/pdf") ||
      text.startsWith("/download") ||
      text === "📄 Download Notes PDF" ||
      text === "📄 Export PDF Notes" ||
      /\b(pdf|convert to pdf|download as pdf|download pdf|save as pdf|export pdf|send pdf|make pdf)\b/i.test(text);

    if (isPdfRequest) {
      await this.sendChatAction(chatId, "upload_document");

      let topic = text
        .replace(/^\/pdf\s*/i, "")
        .replace(/^\/download\s*/i, "")
        .replace(/^(convert|download|save|send|make|export)\s+(to\s+|as\s+)?pdf\s*(of\s*)?/i, "")
        .trim();

      let contentToConvert = "";

      const lastBotResp = this.lastBotResponseByChat.get(chatId);
      const history = this.chatHistories.get(chatId) || [];
      const lastModelMsg = [...history].reverse().find((t) => t.role === "model");

      if (topic.length > 2 && !topic.toLowerCase().includes("pdf")) {
        // User asked for notes on a specific topic: generate comprehensive notes
        const prompt = `Provide an elite, comprehensive, board-level clinical study guide on "${topic}".
Include:
1. 📋 Overview & Core Pathophysiology
2. 🔍 Diagnostic Hallmarks & Gold Standard Testing
3. 💊 First-Line Pharmacotherapy & Management
4. 💡 High-Yield Board Pearls & Exam Mnemonics`;

        const { text: notes } = await generateGeminiReply(
          prompt,
          [],
          this.getSystemPrompt(chatId),
          this.config.temperature,
          [],
          this.config.model
        );
        contentToConvert = notes;
      } else if (lastBotResp && lastBotResp.text) {
        // Automatically compile the text in just previous response (previous last response)
        contentToConvert = lastBotResp.text;
        topic = lastBotResp.topic || "Clinical Notes";
      } else if (lastModelMsg && lastModelMsg.text) {
        contentToConvert = lastModelMsg.text;
        topic = "Clinical Notes";
      } else {
        contentToConvert = `# Medchat Medical Sciences Study Guide\n\nWelcome to Medchat! Here is your high-yield reference guide for USMLE and board examinations.\n\n## High-Yield Medical Specialties\n* **Anatomy & Embryology:** Cranial nerves, branchial arches, coronary anatomy.\n* **Physiology:** Frank-Starling curve, acid-base nomogram, nephron transport.\n* **Pharmacology:** Autonomic nervous system receptors, antiarrhythmics, antibiotics.\n* **Pathology:** Glomerulonephritides, leukemias, cardiac murmurs.\n\n💡 Tip: Ask Medchat any clinical question or send an anatomical image or PDF document, then type /pdf to download notes in PDF format!`;
        topic = "General Medical Review";
      }

      try {
        const pdfBuffer = await generateMedicalPdf(contentToConvert, {
          title: topic.length > 2 ? `Medchat: ${topic}` : "Medchat Clinical Notes",
          topic: topic || "Medical Sciences Review",
        });

        const safeFileName = `${(topic || "Medchat_Notes").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.pdf`;
        const sent = await this.sendDocument(
          chatId,
          pdfBuffer,
          safeFileName,
          `🩺 *Medchat Clinical Notes (${topic})*\nDownloaded from Medchat AI.`
        );

        if (!sent) {
          await this.sendMessage(chatId, "⚠️ Could not deliver PDF document. Please try again.");
        }
      } catch (err: any) {
        console.error("[Telegram] PDF generation error:", err);
        await this.sendMessage(chatId, "⚠️ Error generating PDF document. Please try again.");
      }
      return;
    }

    // 4. Interactive Quiz Request (Triggered specifically when prompted with the word "quiz" or "quizzes")
    const isQuizWord =
      /\bquiz(?:zes)?\b/i.test(text) ||
      text.startsWith("/quiz") ||
      text === "📊 Interactive Quiz";

    if (isQuizWord) {
      await this.sendChatAction(chatId, "typing");
      const parsed = parseQuizPrompt(text);
      const count = parsed.count;
      const topic = parsed.topic;
      const allowScenario = parsed.allowScenario;

      if (count > 1) {
        await this.sendMessage(
          chatId,
          `📚 *Generating ${count} interactive quizzes on ${topic}...*\nSending Telegram polls sequentially:`,
          "Markdown"
        );
      }

      try {
        const { quizzes, textSummary, latencyMs } = await this.generateInteractiveQuizzes(text);

        for (let i = 0; i < quizzes.length; i++) {
          const quiz = quizzes[i];

          // Send patient vignette as clinical scenario ONLY if explicitly requested and present
          if (allowScenario && quiz.scenario && quiz.scenario.trim().length > 0) {
            await this.sendMessage(
              chatId,
              `📋 *Clinical Case Vignette${quizzes.length > 1 ? ` (${i + 1}/${quizzes.length})` : ""}:*\n\n${quiz.scenario}`,
              "Markdown"
            );
          }

          // Format question stem (prefix with index if multiple quizzes)
          const questionStem = quizzes.length > 1
            ? `[${i + 1}/${quizzes.length}] ${quiz.question}`
            : quiz.question;

          // Send native Telegram interactive Quiz Poll
          await this.sendPoll(
            chatId,
            questionStem.slice(0, 290),
            quiz.options,
            quiz.correctOptionId,
            quiz.explanation,
            false
          );

          // Delay slightly between polls to ensure clean order
          if (quizzes.length > 1 && i < quizzes.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }

        // Friendly follow-up instructions
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
        await this.sendMessage(chatId, "⚠️ Error generating interactive quiz. Please try again.");
      }
      return;
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
      await this.sendMessage(chatId, "✅ *Prompt Reset*\n\nYour bot has returned to its normal (default) medical mode.", "Markdown");
      return;
    }

    if (this.userStates.get(chatId) === 'WAITING_FOR_PROMPT') {
      this.customSystemPrompts.set(chatId, text);
      this.userStates.delete(chatId);
      await this.sendMessage(chatId, `✅ *Custom prompt updated!*\n\nYour new prompt:\n_${text}_\n\nTo revert, send /resetprompt`, "Markdown");
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

      // Send to Telegram without sub buttons
      await this.sendMessage(chatId, reply, "Markdown");
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
    // 1. Check if user is requesting an interactive quiz (prompted with the word "quiz" or "quizzes")
    const isQuizPrompt = /\bquiz(?:zes)?\b/i.test(prompt) || prompt.trim().startsWith("/quiz");
    if (isQuizPrompt && (!attachments || attachments.length === 0)) {
      const { quizzes, textSummary, latencyMs, count, topic } = await this.generateInteractiveQuizzes(prompt);

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
        quiz: quizzes[0],
        quizzes,
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
      this.getSystemPrompt(chatId),
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
