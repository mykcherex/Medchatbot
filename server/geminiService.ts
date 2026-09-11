import { GoogleGenAI } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY environment variable is not set. Using fallback or awaiting injection.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || "",
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
}

export interface MediaAttachment {
  mimeType: string;
  data: string; // base64 string
  fileName?: string;
}

const CANDIDATE_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "gemini-3.1-pro-preview",
];

// Track models that have exceeded quota so we don't waste time trying them repeatedly
const modelExhaustedCooldowns = new Map<string, number>();

export async function generateGeminiReply(
  prompt: string,
  history: ConversationTurn[] = [],
  systemInstruction: string = "You are Medchat, a specialized Medical Sciences Professor and Board-Examiner.",
  temperature: number = 0.6,
  attachments: MediaAttachment[] = [],
  preferredModel?: string
): Promise<{ text: string; latencyMs: number; modelUsed?: string }> {
  const startTime = Date.now();
  const ai = getGeminiClient();

  // Format contents for multi-turn history
  const contents: Array<{ role?: string; parts: Array<any> }> = [];

  for (const turn of history.slice(-8)) {
    contents.push({
      role: turn.role,
      parts: [{ text: turn.text }],
    });
  }

  // Construct parts for current turn (including inlineData for images or documents)
  const currentTurnParts: Array<any> = [];

  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.data && att.mimeType) {
        currentTurnParts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.data,
          },
        });
      }
    }
  }

  currentTurnParts.push({ text: prompt });

  contents.push({
    role: 'user',
    parts: currentTurnParts,
  });

  // Prepare ordered list of candidate models:
  // 1. Preferred model (if not currently exhausted)
  // 2. Active candidate models (not on cooldown)
  // 3. Models on cooldown (as absolute last resort)
  const now = Date.now();
  const candidatePool = preferredModel && CANDIDATE_MODELS.includes(preferredModel)
    ? [preferredModel, ...CANDIDATE_MODELS.filter((m) => m !== preferredModel)]
    : [...CANDIDATE_MODELS];

  const availableModels = candidatePool.filter((m) => {
    const cooldownUntil = modelExhaustedCooldowns.get(m);
    return !cooldownUntil || now > cooldownUntil;
  });

  // If all models are on cooldown, try them anyway as cooldown might have passed on provider side
  const modelsToTry = availableModels.length > 0 ? availableModels : candidatePool;

  let lastError: any = null;

  for (const modelName of modelsToTry) {
    const maxRetries = 3; 
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction,
            temperature,
          },
        });

        const latencyMs = Date.now() - startTime;
        const text = response.text || "(No response generated)";
        return { text, latencyMs, modelUsed: modelName };
      } catch (error: any) {
        lastError = error;
        const errorMsg = error?.message || String(error);

        const isQuotaExceeded =
          errorMsg.includes("You exceeded your current quota") ||
          errorMsg.includes("quota") ||
          (errorMsg.includes("429") && errorMsg.includes("billing"));

        const isTransientBusy =
          errorMsg.includes("503") ||
          errorMsg.includes("UNAVAILABLE") ||
          errorMsg.includes("high demand") ||
          (errorMsg.includes("429") && !isQuotaExceeded);

        if (isQuotaExceeded) {
          // Model quota is exhausted. Mark model on a 5-minute cooldown and immediately try next model.
          modelExhaustedCooldowns.set(modelName, Date.now() + 5 * 60 * 1000);
          console.warn(`[Gemini API] ${modelName} quota exhausted. Immediately falling back to next candidate model...`);
          break; // Do not retry the same model, go to next
        } else if (isTransientBusy) {
          console.warn(`[Gemini API] ${modelName} transient busy state (attempt ${attempt}/${maxRetries}): ${errorMsg.slice(0, 90)}...`);
          if (attempt < maxRetries) {
            // Wait with exponential backoff (e.g., 2s, 4s) before retrying the same model
            const delayMs = Math.pow(2, attempt) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue; // Retry the same model
          } else {
            break; // Max retries reached, fallback to next candidate model
          }
        } else {
          // Other error (model not found, bad request, etc.), move to next model
          break;
        }
      }
    }
  }

  const latencyMs = Date.now() - startTime;
  const isAllQuota = String(lastError?.message || "").includes("quota");
  const friendlyError = isAllQuota
    ? "Gemini API quota is currently exceeded on this API key. Please check your billing or plan in Google AI Studio Settings."
    : (lastError?.message || "Failed to generate AI response from Gemini");

  console.error("Gemini API Error after fallbacks:", friendlyError);
  throw new Error(friendlyError);
}
