import { useState } from 'react';
import { Send, MessageCircle, Terminal, HelpCircle, Copy, Check, ExternalLink, Stethoscope, Lightbulb, CheckCircle2 } from 'lucide-react';
import { BotInfo } from '../types';

interface TelegramGuideProps {
  botInfo: BotInfo | null;
}

export function TelegramGuide({ botInfo }: TelegramGuideProps) {
  const [testChatId, setTestChatId] = useState('');
  const [testMessage, setTestMessage] = useState('Doctor, here is your daily high-yield clinical pearl from Medchat!');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success?: boolean; text?: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const username = botInfo?.username;
  const botLink = username ? `https://t.me/${username}` : '';

  const handleSendDirect = async () => {
    if (!testChatId || !testMessage || sending) return;
    setSending(true);
    setSendResult(null);

    try {
      const res = await fetch('/api/telegram/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: testChatId, message: testMessage }),
      });
      const data = await res.json();
      if (data.ok) {
        setSendResult({ success: true, text: "Message delivered successfully to Telegram!" });
        setTestMessage('');
      } else {
        setSendResult({ success: false, text: "Failed to send message. Make sure the Chat ID has initiated /start with the bot." });
      }
    } catch (err: any) {
      setSendResult({ success: false, text: err.message });
    } finally {
      setSending(false);
    }
  };

  const copyLink = () => {
    if (!botLink) return;
    navigator.clipboard.writeText(botLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Card 1: How to Connect & Medical Commands & Buttons */}
      <div id="telegram-commands-guide-card" className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
            <Stethoscope className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">How to Use Medchat on Telegram</h3>
            <p className="text-xs text-slate-500">Interactive medical buttons & commands</p>
          </div>
        </div>

        {username && (
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-between gap-2">
            <div className="truncate">
              <span className="text-[11px] text-teal-700 font-semibold block uppercase tracking-wider">Direct Telegram Link</span>
              <span className="text-xs font-mono font-bold text-teal-950 truncate">{botLink}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={copyLink}
                className="p-1.5 bg-white hover:bg-teal-100 text-teal-700 rounded-md border border-teal-200 transition-colors cursor-pointer"
                title="Copy Link"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={botLink}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1.5 bg-teal-700 hover:bg-teal-600 text-white rounded-md text-xs font-semibold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
              >
                <span>Open in Telegram</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {/* Telegram Interactive Buttons Feature */}
        <div className="p-3 rounded-lg bg-indigo-50/70 border border-indigo-100 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-indigo-900">
            <Lightbulb className="w-3.5 h-3.5 text-indigo-600" />
            <span>Interactive Telegram Buttons Included</span>
          </div>
          <p className="text-slate-600 text-[11px] leading-relaxed">
            When users message <span className="font-semibold text-indigo-900">/start</span> or <span className="font-semibold text-indigo-900">/menu</span>, Medchat displays inline tap buttons and persistent reply keyboards:
          </p>
          <div className="grid grid-cols-2 gap-1.5 text-[11px] font-medium text-slate-700 pt-1">
            <div className="bg-white p-1.5 rounded border border-indigo-100 flex items-center gap-1">
              <span>📊</span> Interactive Quiz Poll
            </div>
            <div className="bg-white p-1.5 rounded border border-indigo-100 flex items-center gap-1">
              <span>🎯</span> Clinical Board MCQ
            </div>
            <div className="bg-white p-1.5 rounded border border-indigo-100 flex items-center gap-1">
              <span>📄</span> Export PDF Notes
            </div>
            <div className="bg-white p-1.5 rounded border border-indigo-100 flex items-center gap-1">
              <span>💡</span> Medical Exam Tips
            </div>
            <div className="bg-white p-1.5 rounded border border-indigo-100 flex items-center gap-1">
              <span>📸</span> Vision & Docs Guide
            </div>
            <div className="bg-white p-1.5 rounded border border-indigo-100 flex items-center gap-1">
              <span>💊</span> Pharmacology MCQ
            </div>
            <div className="bg-white p-1.5 rounded border border-indigo-100 flex items-center gap-1">
              <span>🫀</span> Anatomy & Physio
            </div>
            <div className="bg-white p-1.5 rounded border border-indigo-100 flex items-center gap-1">
              <span>🔬</span> Pathology & Micro
            </div>
          </div>
        </div>

        {/* Multimodal Feature Showcase */}
        <div className="p-3 rounded-lg bg-teal-50 border border-teal-200/80 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-teal-950">
            <span>🔬</span>
            <span>Medical Image Vision & Document Processing</span>
          </div>
          <div className="space-y-1.5 text-[11px] text-teal-900 leading-relaxed">
            <p>
              • <strong>Send Medical Photos:</strong> Upload micrographs (H&E, Gram stain), chest radiographs, CT/MRI scans, ECG rhythm strips, or anatomy diagrams directly into chat.
            </p>
            <p>
              • <strong>Send Documents / PDFs:</strong> Upload lecture handouts or guidelines. Medchat synthesizes key pathophysiology, first-line treatments, and active-recall MCQs.
            </p>
          </div>
        </div>

        {/* Commands List */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-slate-500" />
            Supported Chat Commands
          </h4>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/start</span>
              <span className="text-slate-600">Introduces the medical bot and opens the interactive quick action buttons.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/vision</span>
              <span className="text-slate-600">Displays complete instructions for histology, radiology, ECG, and pathology vision.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/quiz [count] [topic]</span>
              <span className="text-slate-600">Generates <strong>interactive Telegram Quiz Polls</strong> strictly honoring your prompt (e.g. <em>"30 quizzes on heart anatomy"</em> delivers 30 direct anatomy polls without unwanted clinical scenarios; asking for <em>"clinical case quiz"</em> adds patient vignettes).</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/mcq [topic]</span>
              <span className="text-slate-600">Generates a high-yield USMLE-style clinical vignette MCQ in <strong>raw formatted text</strong> with distractor rationale.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/pdf [topic]</span>
              <span className="text-slate-600">Converts your current medical discussion or topic into a <strong>downloadable PDF document</strong> directly in Telegram.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/examtips</span>
              <span className="text-slate-600">Provides tested medical exam strategies, active recall tips, and high-yield mnemonics.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/pharm</span>
              <span className="text-slate-600">Generates focused Pharmacology MCQs on mechanisms, adverse effects, and antidotes.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/anatomy</span>
              <span className="text-slate-600">Generates clinical Anatomy questions on relations, neuroanatomy, and embryology.</span>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="font-mono font-bold text-teal-700 flex-shrink-0">/clear</span>
              <span className="text-slate-600">Resets medical conversation context memory to start fresh.</span>
            </div>
          </div>

          {/* Admin Control Commands */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <h4 className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
              <span>👑</span>
              <span>Admin Access & Approval Commands (Option 3)</span>
            </h4>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50/60 border border-amber-200/70">
                <span className="font-mono font-bold text-amber-900 flex-shrink-0">/claimadmin [passcode]</span>
                <span className="text-slate-700">Activates administrator privileges on your Telegram account (Default: <code>medadmin2026</code>).</span>
              </div>
              <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="font-mono font-bold text-teal-700 flex-shrink-0">/approve @user</span>
                <span className="text-slate-600">Approves a student by @username or Telegram numeric Chat ID.</span>
              </div>
              <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="font-mono font-bold text-rose-700 flex-shrink-0">/revoke @user</span>
                <span className="text-slate-600">Instantly revokes a student's access.</span>
              </div>
              <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="font-mono font-bold text-slate-700 flex-shrink-0">/pending</span>
                <span className="text-slate-600">Lists pending student requests with 1-click [✅ Approve] buttons.</span>
              </div>
              <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="font-mono font-bold text-slate-700 flex-shrink-0">/broadcast [text]</span>
                <span className="text-slate-600">Broadcasts an announcement to all approved students.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card 2: Direct Broadcast / Test Messenger */}
      <div id="direct-message-test-card" className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <Send className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Send Direct Telegram Message</h3>
            <p className="text-xs text-slate-500">Broadcast a clinical tip or MCQ to a specific Telegram chat ID</p>
          </div>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Target Chat ID</label>
            <input
              id="direct-chat-id-input"
              type="text"
              value={testChatId}
              onChange={(e) => setTestChatId(e.target.value)}
              placeholder="e.g. 123456789 (User must have messaged bot once)"
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Message Content</label>
            <textarea
              id="direct-message-textarea"
              rows={4}
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Type your medical message or announcement..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          {sendResult && (
            <div
              className={`p-2.5 rounded-lg text-xs font-medium ${
                sendResult.success
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {sendResult.text}
            </div>
          )}

          <button
            id="send-direct-telegram-msg-btn"
            onClick={handleSendDirect}
            disabled={!testChatId.trim() || !testMessage.trim() || sending}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sending ? 'Sending to Telegram...' : 'Dispatch Medical Alert'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
