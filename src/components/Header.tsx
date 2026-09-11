import { RefreshCw, ExternalLink, Bot, Zap, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { BotStatusResponse } from '../types';

interface HeaderProps {
  status: BotStatusResponse | null;
  loading: boolean;
  onRefresh: () => void;
  botActive: boolean;
  onToggleActive: (active: boolean) => void;
}

export function Header({ status, loading, onRefresh, botActive, onToggleActive }: HeaderProps) {
  const botInfo = status?.botInfo;
  const username = botInfo?.username;
  const isOnline = status?.isOnline;

  return (
    <header id="app-header" className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Left: Bot Branding */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-sm ring-1 ring-sky-500/20">
                <Bot className="w-5 h-5" />
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white ${
                  isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                }`}
                title={isOnline ? 'Telegram Bot Connected' : 'Disconnected'}
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                  {botInfo?.first_name || 'Gemini Telegram Bot'}
                </h1>
                {username && (
                  <a
                    id="telegram-bot-link"
                    href={`https://t.me/${username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 transition-colors border border-sky-200"
                  >
                    @{username}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1 font-medium text-indigo-600">
                  <Zap className="w-3 h-3" /> Powered by Gemini 3.8 Flash
                </span>
                <span className="text-slate-300">•</span>
                <span className="capitalize">{status?.mode || 'polling'} mode</span>
              </div>
            </div>
          </div>

          {/* Right: Actions & Status */}
          <div className="flex items-center gap-3">
            {/* Bot Active Switch */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <span className="text-slate-600 font-medium">AI Responding:</span>
              <button
                id="toggle-bot-active-btn"
                onClick={() => onToggleActive(!botActive)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                  botActive ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
                role="switch"
                aria-checked={botActive}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    botActive ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className={`font-semibold ${botActive ? 'text-emerald-700' : 'text-slate-500'}`}>
                {botActive ? 'Active' : 'Paused'}
              </span>
            </div>

            {/* Refresh Button */}
            <button
              id="refresh-status-btn"
              onClick={onRefresh}
              disabled={loading}
              className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh Bot Status"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-600' : ''}`} />
            </button>

            {/* Open in Telegram CTA */}
            {username && (
              <a
                id="cta-open-telegram-btn"
                href={`https://t.me/${username}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 active:bg-sky-700 rounded-lg shadow-xs transition-all"
              >
                <span className="hidden md:inline">Open in Telegram</span>
                <span className="md:hidden">Open</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
