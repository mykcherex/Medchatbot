import { useState } from 'react';
import { MessageLog } from '../types';
import { MessageSquare, Clock, Search, Trash2, CheckCircle2, AlertCircle, ArrowUpRight, Filter, Image as ImageIcon, FileText } from 'lucide-react';

interface ActivityLogsProps {
  logs: MessageLog[];
  onClearLogs: () => void;
  loading: boolean;
}

export function ActivityLogs({ logs, onClearLogs, loading }: ActivityLogsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'telegram' | 'web_test'>('all');

  const filteredLogs = logs.filter((log) => {
    if (sourceFilter !== 'all' && log.source !== sourceFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.userMessage.toLowerCase().includes(q) ||
      log.aiResponse.toLowerCase().includes(q) ||
      log.userName.toLowerCase().includes(q) ||
      (log.userHandle && log.userHandle.toLowerCase().includes(q))
    );
  });

  return (
    <div id="activity-logs-card" className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-[520px]">
      {/* Header & Controls */}
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Message Activity Feed</h3>
            <p className="text-xs text-slate-500">Live Telegram & Gemini interactions</p>
          </div>
        </div>

        {/* Filter and Clear */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filter Pills */}
          <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-xs">
            <button
              onClick={() => setSourceFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                sourceFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({logs.length})
            </button>
            <button
              onClick={() => setSourceFilter('telegram')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                sourceFilter === 'telegram' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Telegram
            </button>
            <button
              onClick={() => setSourceFilter('web_test')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                sourceFilter === 'web_test' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Simulator
            </button>
          </div>

          <button
            id="clear-logs-btn"
            onClick={onClearLogs}
            disabled={logs.length === 0}
            className="p-1.5 text-slate-500 hover:text-rose-600 rounded-md hover:bg-slate-200/80 transition-colors disabled:opacity-40"
            title="Clear all logs"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-3 bg-white border-b border-slate-100">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            id="search-logs-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search questions, replies, or users..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
        </div>
      </div>

      {/* Feed Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 text-slate-400">
              <MessageSquare className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-700">No message activity yet</p>
            <p className="text-xs text-slate-500 max-w-xs mt-1">
              Send a message to the bot on Telegram or use the Live AI Simulator to see logs appear in real-time.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="p-3 hover:bg-slate-50/80 rounded-lg transition-colors space-y-2">
              {/* Log Header */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-slate-900">{log.userName}</span>
                  {log.userHandle && (
                    <span className="text-sky-600 font-medium">{log.userHandle}</span>
                  )}
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    {log.source === 'telegram' ? 'Telegram' : 'Simulator'}
                  </span>
                  {log.mediaType === 'image' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-100 text-cyan-800 border border-cyan-200 flex items-center gap-1">
                      <ImageIcon className="w-2.5 h-2.5" /> Image Slide
                    </span>
                  )}
                  {log.mediaType === 'document' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                      <FileText className="w-2.5 h-2.5" /> {log.fileName || 'Document PDF'}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                  {log.latencyMs > 0 && (
                    <span className="flex items-center gap-0.5 text-indigo-600 font-medium bg-indigo-50 px-1.5 py-0.5 rounded">
                      <Clock className="w-3 h-3" /> {log.latencyMs}ms
                    </span>
                  )}
                  <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
              </div>

              {/* User Message */}
              <div className="text-xs text-slate-800 bg-slate-100/80 p-2 rounded-md font-medium">
                <span className="text-slate-400 font-normal mr-1.5">User:</span>
                {log.userMessage}
              </div>

              {/* Gemini Response */}
              <div className="text-xs text-slate-700 bg-white border border-slate-200 p-2.5 rounded-md leading-relaxed whitespace-pre-wrap">
                <div className="flex items-center gap-1 text-[11px] font-semibold text-sky-700 mb-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  Gemini Reply:
                </div>
                {log.aiResponse}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
