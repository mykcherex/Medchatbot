import { MessageSquare, Users, Clock, Radio, FileQuestion, Lightbulb, Stethoscope, Image, FileText } from 'lucide-react';
import { BotStatusResponse } from '../types';

interface MetricsCardsProps {
  status: BotStatusResponse | null;
}

export function MetricsCards({ status }: MetricsCardsProps) {
  const stats = status?.stats;
  const isOnline = status?.isOnline;
  const mode = status?.mode || 'polling';
  const examLevel = status?.config?.examLevel || 'USMLE Step 1 / 2 CK';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      {/* Bot Connection Card */}
      <div id="metric-card-status" className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-500 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Telegram Bot</span>
          <Radio className={`w-4 h-4 ${isOnline ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
        </div>
        <div className="mt-1">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <span className="text-lg sm:text-xl font-bold text-slate-900">
              {isOnline ? 'Active Online' : 'Offline'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 capitalize">
            Mode: <span className="font-semibold text-slate-700">{mode}</span> • Polling
          </p>
        </div>
      </div>

      {/* MCQs & Messages Handled */}
      <div id="metric-card-messages" className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-500 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Clinical MCQs</span>
          <FileQuestion className="w-4 h-4 text-teal-600" />
        </div>
        <div className="mt-1">
          <div className="text-lg sm:text-xl font-bold text-slate-900">
            {stats?.mcqsGenerated ?? 0}
          </div>
          <p className="text-xs text-teal-700 mt-1 font-medium flex items-center gap-1">
            <span>{stats?.totalMessages ?? 0} total interactions</span>
          </p>
        </div>
      </div>

      {/* Medical Vision & Docs Card */}
      <div id="metric-card-multimodal" className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-500 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Vision & Documents</span>
          <div className="flex items-center gap-1 text-cyan-600">
            <Image className="w-3.5 h-3.5" />
            <FileText className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-1">
          <div className="text-lg sm:text-xl font-bold text-slate-900">
            {(stats?.imagesProcessed ?? 0) + (stats?.documentsProcessed ?? 0)}
          </div>
          <p className="text-xs text-cyan-700 mt-1 font-medium flex items-center gap-2">
            <span>{stats?.imagesProcessed ?? 0} slides</span>
            <span>•</span>
            <span>{stats?.documentsProcessed ?? 0} PDFs</span>
          </p>
        </div>
      </div>

      {/* Average Latency Card */}
      <div id="metric-card-latency" className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-500 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Avg AI Latency</span>
          <Clock className="w-4 h-4 text-indigo-500" />
        </div>
        <div className="mt-1">
          <div className="text-lg sm:text-xl font-bold text-slate-900">
            {stats?.averageLatencyMs ? `${stats.averageLatencyMs} ms` : '—'}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Gemini 3.8 Flash • Multimodal
          </p>
        </div>
      </div>

      {/* Active Medical Chats */}
      <div id="metric-card-chats" className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs flex flex-col justify-between col-span-2 lg:col-span-1">
        <div className="flex items-center justify-between text-slate-500 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Students</span>
          <Users className="w-4 h-4 text-emerald-500" />
        </div>
        <div className="mt-1">
          <div className="text-lg sm:text-xl font-bold text-slate-900">
            {stats?.activeChatsCount ?? 0}
          </div>
          <p className="text-xs text-slate-500 mt-1 truncate" title={examLevel}>
            Target: <span className="font-semibold text-slate-700">{examLevel.split(' ')[0]}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
