import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { telegramBot } from "./server/telegramBot";
import { generateMedicalPdf } from "./server/pdfService";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON middleware with support for document and image attachments (base64)
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  // Initialize Telegram Bot & Polling
  await telegramBot.initialize();

  // API Routes
  app.get("/api/status", (req, res) => {
    const host = req.get("host");
    const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const appUrl = process.env.APP_URL || `${protocol}://${host}`;
    res.json(telegramBot.getStatus(appUrl));
  });

  app.get("/api/logs", (req, res) => {
    res.json({ logs: telegramBot.getLogs() });
  });

  app.post("/api/logs/clear", (req, res) => {
    telegramBot.clearLogs();
    res.json({ ok: true });
  });

  app.post("/api/config", (req, res) => {
    try {
      const { systemInstruction, temperature, botActive, pollingEnabled, medicalSpecialty, examLevel, activeSubjects } = req.body;
      telegramBot.updateConfig({
        systemInstruction,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        botActive: typeof botActive === 'boolean' ? botActive : undefined,
        pollingEnabled: typeof pollingEnabled === 'boolean' ? pollingEnabled : undefined,
        medicalSpecialty,
        examLevel,
        activeSubjects,
      });
      res.json({ ok: true, status: telegramBot.getStatus() });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/generate-mcq", async (req, res) => {
    try {
      const { subject } = req.body;
      const result = await telegramBot.generateClinicalMcq(subject || "general");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to generate MCQ" });
    }
  });

  app.post("/api/generate-tips", async (req, res) => {
    try {
      const { topic } = req.body;
      const result = await telegramBot.generateExamTips(topic || "general");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to generate exam tips" });
    }
  });

  app.post("/api/generate-quiz", async (req, res) => {
    try {
      const { topic, count, prompt } = req.body;
      const userPrompt = prompt || topic || "general";
      const result = await telegramBot.generateInteractiveQuizzes(
        userPrompt,
        topic,
        typeof count === "number" ? count : undefined
      );
      res.json({
        quiz: result.quizzes[0],
        quizzes: result.quizzes,
        textSummary: result.textSummary,
        latencyMs: result.latencyMs,
        count: result.count,
        topic: result.topic,
        allowScenario: result.allowScenario,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to generate interactive quiz" });
    }
  });

  app.post("/api/download-pdf", async (req, res) => {
    try {
      const { text, title, topic } = req.body;
      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "Text content is required to generate PDF" });
      }
      const pdfBuffer = await generateMedicalPdf(text, {
        title: title || "Medchat Clinical Notes",
        topic: topic || "High-Yield Medical Review",
      });

      const safeTitle = (title || "Medchat_Clinical_Notes").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("[PDF Route] Failed to generate PDF:", err);
      res.status(500).json({ error: err.message || "Failed to generate PDF" });
    }
  });

  app.post("/api/test-chat", async (req, res) => {
    try {
      const { message, attachments } = req.body;
      const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
      if ((!message || typeof message !== 'string' || !message.trim()) && !hasAttachments) {
        return res.status(400).json({ error: "Message or media attachment is required" });
      }

      const promptText = message?.trim() || (hasAttachments && attachments[0]?.mimeType?.startsWith("image/")
        ? "Analyze this medical image with rigorous clinical precision. Identify anatomical landmarks, histopathological or radiological hallmarks, disease processes, and differential diagnosis. Provide structured clinical analysis without unsolicited quiz questions."
        : "Thoroughly analyze this medical document. Provide an executive clinical summary, high-yield pathophysiological or pharmacological mechanisms, and board exam pearls without unsolicited quiz questions.");

      const result = await telegramBot.testWebChat(promptText, attachments || []);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to generate AI response" });
    }
  });

  app.post("/api/telegram/toggle-polling", (req, res) => {
    const { enabled } = req.body;
    if (enabled) {
      telegramBot.startPolling();
    } else {
      telegramBot.stopPolling();
    }
    res.json({ ok: true, status: telegramBot.getStatus() });
  });

  app.post("/api/telegram/set-webhook", async (req, res) => {
    const { url, remove } = req.body;
    if (remove) {
      const result = await telegramBot.deleteWebhook();
      return res.json(result);
    }
    if (!url) {
      return res.status(400).json({ error: "Webhook URL is required" });
    }
    const result = await telegramBot.setWebhook(url);
    res.json(result);
  });

  app.post("/api/telegram/send-message", async (req, res) => {
    const { chatId, message } = req.body;
    if (!chatId || !message) {
      return res.status(400).json({ error: "Chat ID and message are required" });
    }
    const sent = await telegramBot.sendMessage(chatId, message);
    res.json({ ok: sent });
  });

  // Access Control & Whitelist API Routes
  app.get("/api/access-control", (req, res) => {
    res.json(telegramBot.getAccessControlStatus());
  });

  app.post("/api/access-control/approve", async (req, res) => {
    try {
      const { identifier, approvedBy } = req.body;
      if (!identifier) {
        return res.status(400).json({ error: "Identifier (Username or Chat ID) is required" });
      }
      const result = await telegramBot.approveUser(identifier, approvedBy || "Web Dashboard");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to approve user" });
    }
  });

  app.post("/api/access-control/revoke", async (req, res) => {
    try {
      const { identifier } = req.body;
      if (!identifier) {
        return res.status(400).json({ error: "Identifier (Username or Chat ID) is required" });
      }
      const result = await telegramBot.revokeUser(identifier);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to revoke user" });
    }
  });

  app.post("/api/access-control/toggle", (req, res) => {
    const { enabled } = req.body;
    telegramBot.setAccessControlEnabled(Boolean(enabled));
    res.json({ ok: true, status: telegramBot.getAccessControlStatus() });
  });

  app.post("/api/access-control/add-admin", (req, res) => {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: "Admin identifier is required" });
    }
    const ok = telegramBot.addAdmin(identifier);
    res.json({ ok, status: telegramBot.getAccessControlStatus() });
  });

  // Telegram incoming Webhook endpoint
  app.post("/api/telegram/webhook", async (req, res) => {
    // Acknowledge update immediately to Telegram (HTTP 200)
    res.sendStatus(200);
    try {
      await telegramBot.handleUpdate(req.body);
    } catch (err) {
      console.error("[Telegram Webhook] Error processing update:", err);
    }
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Gemini Telegram Bot backend running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
