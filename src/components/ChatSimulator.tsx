import { useState, useRef, useEffect, ChangeEvent, DragEvent } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  Trash2,
  Clock,
  Check,
  Copy,
  Stethoscope,
  Lightbulb,
  HelpCircle,
  Paperclip,
  FileText,
  X,
  UploadCloud,
  FileDown,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Timer,
  Zap,
  AlertCircle
} from 'lucide-react';
import { MediaAttachment, QuizPollData } from '../types';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  latencyMs?: number;
  imageUrl?: string;
  images?: Array<{
    url: string;
    title: string;
    source: string;
    description?: string;
  }>;
  attachment?: {
    name: string;
    mimeType: string;
    previewUrl?: string;
  };
  quiz?: QuizPollData;
  quizzes?: QuizPollData[];
}

interface ChatSimulatorProps {
  onMessageSent?: () => void;
}

const SAMPLE_PROMPTS = [
  "⚡️ rapidfire 5 pharmacology 15s",
  "⚡️ /rapidfire 10 cardiology",
  "📊 5 quizzes on heart anatomy",
  "🎯 mcq on renal pathology",
  "🫀 heart image",
  "📄 download pdf notes on Asthma",
  "⏱️ /timer 20",
];

function InteractiveQuizWidget({
  quiz,
  onDownloadPdf,
  quizNumber,
  totalQuizzes,
}: {
  quiz: QuizPollData;
  onDownloadPdf: () => void;
  quizNumber?: number;
  totalQuizzes?: number;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [showRationale, setShowRationale] = useState(false);
  const initialSeconds = quiz.countdownSeconds || (quiz.isRapidFire ? 30 : null);
  const [timeLeft, setTimeLeft] = useState<number | null>(initialSeconds);
  const [timeExpired, setTimeExpired] = useState(false);

  useEffect(() => {
    if (timeLeft === null || selectedIdx !== null || timeExpired) return;

    if (timeLeft <= 0) {
      setTimeExpired(true);
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          setTimeExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, selectedIdx, timeExpired]);

  const isAnswered = selectedIdx !== null || timeExpired;

  const isRapid = quiz.isRapidFire || (quiz.countdownSeconds && quiz.countdownSeconds > 0);

  return (
    <div className={`mt-2.5 p-3.5 rounded-xl border transition-all text-slate-800 space-y-3 ${
      isRapid
        ? 'border-amber-300 bg-gradient-to-b from-amber-50/80 via-white to-amber-50/30'
        : 'border-teal-200 bg-gradient-to-b from-teal-50/70 to-slate-50'
    }`}>
      {/* Header Badge */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold shadow-2xs ${
            isRapid
              ? 'bg-amber-600 text-white'
              : 'bg-teal-700 text-white'
          }`}>
            <span>{isRapid ? '⚡️' : '📊'}</span>
            {quizNumber && totalQuizzes && totalQuizzes > 1
              ? `${isRapid ? 'Rapid-Fire' : 'Quiz Poll'} ${quizNumber} of ${totalQuizzes}`
              : isRapid ? 'Rapid-Fire Timed Poll' : 'Interactive Quiz Poll'}
          </span>

          {timeLeft !== null && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono font-bold border transition-colors ${
              timeExpired
                ? 'bg-rose-100 text-rose-800 border-rose-300'
                : timeLeft <= 5
                ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse'
                : 'bg-amber-100 text-amber-900 border-amber-300'
            }`}>
              <Timer className="w-3.5 h-3.5" />
              <span>{timeExpired ? 'Time Expired!' : `${timeLeft}s`}</span>
            </span>
          )}
        </div>

        <button
          onClick={onDownloadPdf}
          className="text-xs text-slate-700 hover:text-slate-950 font-medium inline-flex items-center gap-1 bg-white border border-slate-200 hover:border-slate-300 px-2 py-1 rounded-md shadow-2xs transition-colors cursor-pointer"
          title="Download this quiz and rationale as a PDF"
        >
          <FileDown className="w-3.5 h-3.5 text-slate-600" />
          <span>Save PDF</span>
        </button>
      </div>

      {/* Countdown Progress Bar */}
      {initialSeconds && initialSeconds > 0 && !isAnswered && (
        <div className="w-full bg-slate-200/80 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ease-linear ${
              (timeLeft || 0) <= 5 ? 'bg-rose-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.max(0, Math.min(100, (((timeLeft || 0) / initialSeconds) * 100)))}%` }}
          />
        </div>
      )}

      {/* Scenario if present */}
      {quiz.scenario && (
        <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs sm:text-sm text-slate-700 leading-relaxed">
          <span className="font-bold text-slate-900 block mb-1">📋 Clinical Scenario:</span>
          {quiz.scenario}
        </div>
      )}

      {/* Question Stem */}
      <div className="font-semibold text-xs sm:text-sm text-slate-900">
        ❓ {quiz.question}
      </div>

      {/* Options List */}
      <div className="space-y-1.5">
        {quiz.options.map((opt, idx) => {
          const isSelected = selectedIdx === idx;
          const isCorrect = idx === quiz.correctOptionId;

          let btnClass = "bg-white border-slate-200 hover:border-amber-400 text-slate-800 hover:bg-amber-50/40";
          if (isAnswered) {
            if (isCorrect) {
              btnClass = "bg-emerald-50 border-emerald-500 text-emerald-950 font-semibold shadow-xs";
            } else if (isSelected) {
              btnClass = "bg-rose-50 border-rose-400 text-rose-950";
            } else {
              btnClass = "bg-slate-50 border-slate-200 text-slate-400 opacity-60";
            }
          }

          return (
            <button
              key={idx}
              disabled={isAnswered}
              onClick={() => setSelectedIdx(idx)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-xs sm:text-sm flex items-center justify-between gap-2 transition-all cursor-pointer disabled:cursor-default ${btnClass}`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    isAnswered && isCorrect
                      ? 'bg-emerald-600 text-white'
                      : isAnswered && isSelected
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {String.fromCharCode(65 + idx)}
                </span>
                <span>{opt}</span>
              </div>

              {isAnswered && (
                <div>
                  {isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  {isSelected && !isCorrect && <XCircle className="w-4 h-4 text-rose-500" />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Post-Answer Feedback */}
      {isAnswered && (
        <div className="space-y-2 pt-1">
          {/* Result Alert */}
          <div
            className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
              timeExpired && selectedIdx === null
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : selectedIdx === quiz.correctOptionId
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <span className="text-base">
              {timeExpired && selectedIdx === null
                ? '⏱️'
                : selectedIdx === quiz.correctOptionId
                ? '🎉'
                : '❌'}
            </span>
            <div>
              <p className="font-bold">
                {timeExpired && selectedIdx === null
                  ? `Time Expired! Auto-locked. Correct Answer is Option ${String.fromCharCode(65 + quiz.correctOptionId)}:`
                  : selectedIdx === quiz.correctOptionId
                  ? 'Correct! High-Yield Clinical Explanation:'
                  : `Incorrect (Correct is ${String.fromCharCode(65 + quiz.correctOptionId)}):`}
              </p>
              <p className="mt-0.5 leading-relaxed">{quiz.explanation}</p>
            </div>
          </div>

          {/* Toggle Full Rationale */}
          {quiz.fullRationale && (
            <div className="pt-1">
              <button
                onClick={() => setShowRationale(!showRationale)}
                className="text-xs font-semibold text-slate-700 hover:text-slate-950 flex items-center gap-1 cursor-pointer"
              >
                <span>{showRationale ? 'Hide Detailed Rationale' : '📖 View Detailed Clinical Rationale & Board Pearls'}</span>
                {showRationale ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showRationale && (
                <div className="mt-2 p-3 bg-white border border-slate-200 rounded-lg text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                  {quiz.fullRationale}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatSimulator({ onMessageSent }: ChatSimulatorProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: "🩺 Hello Doctor / Medical Student! I am Medchat, your specialized Medical Sciences & Board Exam AI.\n\nI specialize in Anatomy, Physiology, Biochemistry, Microbiology, Pathology, and Pharmacology.\n\n✨ Multimodal Capabilities & On-Demand Image Search:\n• 📸 Ask for images on demand (e.g. `heart image`, `send kidney image`)\n• 🔬 Upload histology micrographs, X-rays, ECGs, and clinical photos for precise breakdown\n• 📄 Upload PDF lecture notes or guidelines for high-yield summaries\n• 🎯 MCQs & practice quizzes are generated strictly when requested!",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    mimeType: string;
    data: string;
    previewUrl?: string;
    sizeKb: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const downloadPdf = async (content: string, id: string, title?: string) => {
    if (!content || downloadingPdfId) return;
    setDownloadingPdfId(id);
    try {
      const res = await fetch('/api/download-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: content,
          title: title || 'Medchat Clinical Notes',
          topic: 'High-Yield Medical Review',
        }),
      });
      if (!res.ok) throw new Error('PDF download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(title || 'Medchat_Clinical_Notes').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('[PDF Download Error]', err);
      alert('Could not download PDF. Please try again.');
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const processSelectedFile = (file: File) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      alert("File size exceeds 20MB limit.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1] || '';
      const isImg = file.type.startsWith('image/');
      const previewUrl = isImg ? URL.createObjectURL(file) : undefined;

      setAttachedFile({
        name: file.name,
        mimeType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
        data: base64Data,
        previewUrl,
        sizeKb: Math.round(file.size / 1024),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const removeAttachment = () => {
    if (attachedFile?.previewUrl) {
      URL.revokeObjectURL(attachedFile.previewUrl);
    }
    setAttachedFile(null);
  };

  const handleSend = async (textToSend?: string) => {
    const promptText = (textToSend || input).trim();
    if ((!promptText && !attachedFile) || loading) return;

    const currentAttachment = attachedFile;
    const isImage = currentAttachment?.mimeType.startsWith('image/');

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: promptText || (isImage ? 'Analyze this medical image with clinical precision.' : `Analyze document: ${currentAttachment?.name}`),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      attachment: currentAttachment ? {
        name: currentAttachment.name,
        mimeType: currentAttachment.mimeType,
        previewUrl: currentAttachment.previewUrl,
      } : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput('');
    setAttachedFile(null);
    setLoading(true);

    try {
      const attachmentsPayload: MediaAttachment[] = currentAttachment ? [{
        mimeType: currentAttachment.mimeType,
        data: currentAttachment.data,
        fileName: currentAttachment.name,
      }] : [];

      const res = await fetch('/api/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: promptText,
          attachments: attachmentsPayload,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        const botMsg: ChatMessage = {
          id: `bot-${Date.now()}`,
          sender: 'bot',
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          latencyMs: data.latencyMs,
          imageUrl: data.imageUrl,
          images: data.images,
          quiz: data.quiz,
          quizzes: data.quizzes,
        };
        setMessages((prev) => [...prev, botMsg]);
        onMessageSent?.();
      } else {
        const errorMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          sender: 'bot',
          text: `⚠️ Error: ${data.error || 'Failed to generate response'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'bot',
        text: `⚠️ Connection error: ${err.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      id="chat-simulator-card"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`bg-white rounded-xl border ${isDragging ? 'border-teal-500 ring-2 ring-teal-200' : 'border-slate-200'} shadow-2xs flex flex-col h-[580px] overflow-hidden relative transition-all`}
    >
      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-teal-900/40 backdrop-blur-xs flex flex-col items-center justify-center text-white pointer-events-none">
          <UploadCloud className="w-12 h-12 mb-2 animate-bounce" />
          <p className="text-sm font-bold">Drop medical image or document here</p>
          <p className="text-xs text-teal-100">Supports JPEG, PNG, PDF, TXT</p>
        </div>
      )}

      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
            <Stethoscope className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Medical AI Simulator</h3>
            <p className="text-xs text-slate-500">Multimodal Gemini 3.8 Flash • Text, Images & Documents</p>
          </div>
        </div>

        <button
          onClick={() =>
            setMessages([
              {
                id: 'welcome-reset',
                sender: 'bot',
                text: "🩺 Medical simulator memory cleared. Ready for new clinical queries, slides, or documents!",
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              },
            ])
          }
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-200 transition-colors cursor-pointer"
          title="Clear Simulator History"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-2.5 max-w-[88%] ${msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
          >
            {/* Avatar */}
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 shadow-2xs ${
                msg.sender === 'user' ? 'bg-indigo-600 text-white' : 'bg-teal-700 text-white'
              }`}
            >
              {msg.sender === 'user' ? <User className="w-3.5 h-3.5" /> : <Stethoscope className="w-3.5 h-3.5" />}
            </div>

            {/* Content */}
            <div className={`space-y-1 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`p-3 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.sender === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-none shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-2xs'
                }`}
              >
                {/* Attached File Preview inside Message */}
                {msg.attachment && (
                  <div className={`mb-2 p-2 rounded-lg border ${msg.sender === 'user' ? 'bg-indigo-700/60 border-indigo-400/40 text-white' : 'bg-slate-100 border-slate-200 text-slate-800'}`}>
                    {msg.attachment.previewUrl ? (
                      <div className="space-y-1">
                        <img
                          src={msg.attachment.previewUrl}
                          alt={msg.attachment.name}
                          className="max-h-40 rounded object-contain bg-black/10"
                          referrerPolicy="no-referrer"
                        />
                        <p className="text-[11px] font-mono truncate">{msg.attachment.name}</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <FileText className="w-4 h-4 text-teal-300" />
                        <span className="truncate">{msg.attachment.name}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Retrieved Medical Images (2-5 diagrams on demand) */}
                {msg.images && msg.images.length > 0 ? (
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1.5 px-1">
                      <span className="text-xs font-bold text-teal-800 flex items-center gap-1.5">
                        📸 Retrieved Medical Images ({msg.images.length} diagrams)
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">Google / Wikimedia Commons</span>
                    </div>
                    <div className={`grid gap-2 ${msg.images.length === 2 ? 'grid-cols-2' : msg.images.length >= 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'}`}>
                      {msg.images.map((img, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shadow-2xs hover:border-teal-400 transition-all flex flex-col"
                        >
                          <div className="relative group bg-white h-28 sm:h-32 flex items-center justify-center p-1.5 overflow-hidden">
                            <img
                              src={img.url}
                              alt={img.title}
                              className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform"
                              referrerPolicy="no-referrer"
                              loading="lazy"
                            />
                            <a
                              href={img.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute inset-0 bg-teal-900/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-semibold gap-1 transition-opacity"
                            >
                              Full Image ↗
                            </a>
                          </div>
                          <div className="p-2 text-left bg-slate-50 border-t border-slate-100 flex flex-col flex-1 justify-between">
                            <p className="font-semibold text-slate-800 text-[11px] line-clamp-1" title={img.title}>
                              {img.title}
                            </p>
                            <span className="text-[10px] text-slate-400 mt-0.5 truncate">{img.source}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : msg.imageUrl ? (
                  <div className="mb-2.5 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shadow-2xs">
                    <img
                      src={msg.imageUrl}
                      alt="Retrieved medical diagram or illustration"
                      className="max-h-60 w-full object-contain bg-white"
                      referrerPolicy="no-referrer"
                    />
                    <div className="px-2.5 py-1 text-[11px] text-slate-500 bg-slate-100 border-t border-slate-200 flex items-center justify-between">
                      <span className="font-medium text-teal-800">📸 Medical Image Retrieved</span>
                      <a
                        href={msg.imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-700 hover:underline inline-flex items-center gap-0.5 font-medium"
                      >
                        Full image ↗
                      </a>
                    </div>
                  </div>
                ) : null}

                {msg.text}

                {/* Interactive Telegram Quiz Poll Widget(s) */}
                {msg.quizzes && msg.quizzes.length > 1 ? (
                  <div className="space-y-3 mt-3">
                    <div className="text-xs font-semibold text-teal-900 bg-teal-50 px-3 py-1.5 rounded-lg border border-teal-200 flex items-center justify-between">
                      <span>📊 Interactive Quiz Polls ({msg.quizzes.length} Questions Generated)</span>
                      <button
                        onClick={() => downloadPdf(msg.text, msg.id, `Medchat_${msg.quizzes![0].topic || 'Quiz_Set'}`)}
                        className="text-teal-800 hover:text-teal-950 font-medium inline-flex items-center gap-1 text-[11px] cursor-pointer"
                        title="Download all quizzes as PDF"
                      >
                        <FileDown className="w-3 h-3 text-teal-700" />
                        Download All (PDF)
                      </button>
                    </div>
                    {msg.quizzes.map((qItem, qIdx) => (
                      <div key={qIdx}>
                        <InteractiveQuizWidget
                          quiz={qItem}
                          quizNumber={qIdx + 1}
                          totalQuizzes={msg.quizzes!.length}
                          onDownloadPdf={() => downloadPdf(
                            `${qItem.scenario ? `*Clinical Scenario:*\n${qItem.scenario}\n\n` : ''}*Question ${qIdx + 1}:* ${qItem.question}\n\n${qItem.options.map((o, idx) => `${String.fromCharCode(65 + idx)}) ${o}`).join('\n')}\n\n✅ *Answer:* ${String.fromCharCode(65 + qItem.correctOptionId)}) ${qItem.options[qItem.correctOptionId]}\n\n💡 *Explanation:* ${qItem.explanation}\n\n${qItem.fullRationale ? `📖 *Detailed Rationale:*\n${qItem.fullRationale}` : ''}`,
                            `${msg.id}-${qIdx}`,
                            `Medchat_Quiz_${qIdx + 1}`
                          )}
                        />
                      </div>
                    ))}
                  </div>
                ) : msg.quiz ? (
                  <InteractiveQuizWidget
                    quiz={msg.quiz}
                    onDownloadPdf={() => downloadPdf(msg.text, msg.id, `Medchat_Quiz_${msg.quiz?.question.slice(0, 20)}`)}
                  />
                ) : null}
              </div>

              <div className="flex items-center gap-2 px-1 text-[11px] text-slate-400">
                <span>{msg.timestamp}</span>
                {msg.latencyMs && (
                  <span className="flex items-center gap-0.5 text-teal-700 font-medium">
                    <Clock className="w-3 h-3" /> {msg.latencyMs}ms
                  </span>
                )}
                {msg.sender === 'bot' && (
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => downloadPdf(msg.text, msg.id, 'Medchat_Clinical_Notes')}
                      disabled={downloadingPdfId === msg.id}
                      className="hover:text-teal-700 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 text-slate-400"
                      title="Download as PDF notes"
                    >
                      {downloadingPdfId === msg.id ? (
                        <Loader2 className="w-3 h-3 animate-spin text-teal-600" />
                      ) : (
                        <FileDown className="w-3 h-3" />
                      )}
                      <span className="text-[10px] hidden sm:inline">PDF</span>
                    </button>
                    <button
                      onClick={() => copyToClipboard(msg.text, msg.id)}
                      className="hover:text-slate-600 transition-colors cursor-pointer"
                      title="Copy message"
                    >
                      {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-2.5 max-w-[85%]">
            <div className="w-7 h-7 rounded-full bg-teal-700 text-white flex items-center justify-center text-xs shadow-xs">
              <Stethoscope className="w-3.5 h-3.5" />
            </div>
            <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none shadow-2xs flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              <span className="text-xs text-slate-600 ml-1 font-medium">Medchat AI is diagnosing, reading & reasoning...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachment Preview Bar (above input) */}
      {attachedFile && (
        <div className="px-3 py-2 bg-teal-50 border-t border-teal-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 truncate">
            {attachedFile.previewUrl ? (
              <img
                src={attachedFile.previewUrl}
                alt="Thumbnail"
                className="w-7 h-7 object-cover rounded border border-teal-200"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-7 h-7 bg-teal-200 text-teal-800 rounded flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4" />
              </div>
            )}
            <div className="truncate">
              <p className="font-semibold text-teal-900 truncate">{attachedFile.name}</p>
              <p className="text-[10px] text-teal-700">{attachedFile.sizeKb} KB • {attachedFile.mimeType.startsWith('image/') ? 'Medical Image' : 'Medical Document'}</p>
            </div>
          </div>
          <button
            onClick={removeAttachment}
            className="p-1 hover:bg-teal-200 text-teal-700 rounded transition-colors cursor-pointer"
            title="Remove attachment"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input Box with File Upload & Quick Action Chips */}
      <div className="p-3 bg-white border-t border-slate-200 space-y-2">
        {/* Quick prompt chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 text-[11px]">
          <span className="text-slate-400 font-medium whitespace-nowrap flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-teal-600" />
            Try:
          </span>
          {SAMPLE_PROMPTS.map((sample, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSend(sample)}
              disabled={loading}
              className="px-2 py-1 rounded-full bg-slate-100 hover:bg-teal-50 hover:text-teal-800 text-slate-600 border border-slate-200 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {sample}
            </button>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown"
          onChange={handleFileChange}
          className="hidden"
          id="simulator-file-input"
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          {/* File Upload Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-teal-700 hover:bg-teal-50 border border-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            title="Upload medical image (histology, radiology, ECG) or document (PDF, notes)"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <input
            id="simulator-input-field"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={attachedFile ? "Add an optional medical query or instruction..." : "Type 'quiz' for interactive poll, 'mcq' for raw text, or /pdf..."}
            disabled={loading}
            className="flex-1 px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-500 focus:bg-white transition-all disabled:opacity-60"
          />

          <button
            id="simulator-send-btn"
            type="submit"
            disabled={(!input.trim() && !attachedFile) || loading}
            className="px-4 py-2 bg-teal-700 hover:bg-teal-600 active:bg-teal-800 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5 shadow-xs transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            <span>Ask</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
