import { useState, useEffect, useCallback } from 'react';
import { BotStatusResponse, MessageLog, BotConfig } from './types';
import { Header } from './components/Header';
import { MetricsCards } from './components/MetricsCards';
import { ChatSimulator } from './components/ChatSimulator';
import { ActivityLogs } from './components/ActivityLogs';
import { BotSettings } from './components/BotSettings';
import { InstructionEditor } from './components/InstructionEditor';
import { TelegramGuide } from './components/TelegramGuide';
import { AccessControlManager } from './components/AccessControlManager';
import { Activity, Settings, HelpCircle, AlertTriangle, RefreshCw, Send, Sparkles, ShieldCheck } from 'lucide-react';

export default function App() {
  const [status, setStatus] = useState<BotStatusResponse | null>(null);
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'monitor' | 'instructions' | 'access' | 'settings' | 'guide'>('monitor');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BotStatusResponse = await res.json();
      setStatus(data);
      setErrorMessage(null);
    } catch (err: any) {
      console.error('Failed to fetch status:', err);
      setErrorMessage('Could not connect to bot backend server.');
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchLogs()]);
    setLoading(false);
  }, [fetchStatus, fetchLogs]);

  // Initial fetch and auto-refresh loop
  useEffect(() => {
    refreshAll();
    const interval = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 4000);
    return () => clearInterval(interval);
  }, [refreshAll, fetchStatus, fetchLogs]);

  const handleToggleActive = async (botActive: boolean) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botActive }),
      });
      if (res.ok) {
        fetchStatus();
      }
    } catch (err) {
      console.error('Failed to toggle active state:', err);
    }
  };

  const handleSaveConfig = async (newConfig: Partial<BotConfig>) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      if (res.ok) {
        fetchStatus();
      }
    } catch (err) {
      console.error('Failed to update config:', err);
    }
  };

  const handleSetWebhook = async (url: string, remove?: boolean) => {
    try {
      const res = await fetch('/api/telegram/set-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, remove }),
      });
      if (res.ok) {
        fetchStatus();
      }
    } catch (err) {
      console.error('Failed to set webhook:', err);
    }
  };

  const handleTogglePolling = async (enabled: boolean) => {
    try {
      const res = await fetch('/api/telegram/toggle-polling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        fetchStatus();
      }
    } catch (err) {
      console.error('Failed to toggle polling:', err);
    }
  };

  const handleClearLogs = async () => {
    try {
      const res = await fetch('/api/logs/clear', { method: 'POST' });
      if (res.ok) {
        setLogs([]);
      }
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 flex flex-col font-sans antialiased">
      {/* Top Header */}
      <Header
        status={status}
        loading={loading}
        onRefresh={refreshAll}
        botActive={status?.config.botActive ?? true}
        onToggleActive={handleToggleActive}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Error Alert if any */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between text-xs sm:text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={refreshAll}
              className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 rounded-md font-semibold transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Top Key Metrics */}
        <MetricsCards status={status} />

        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <div className="flex items-center gap-2">
            <button
              id="tab-monitor-btn"
              onClick={() => setActiveTab('monitor')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'monitor'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Live Console & Activity</span>
            </button>

            <button
              id="tab-instructions-btn"
              onClick={() => setActiveTab('instructions')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'instructions'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Instruction Updating Area</span>
            </button>

            <button
              id="tab-access-btn"
              onClick={() => setActiveTab('access')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'access'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Access Control & Whitelist</span>
            </button>

            <button
              id="tab-settings-btn"
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Engine & Telegram Settings</span>
            </button>

            <button
              id="tab-guide-btn"
              onClick={() => setActiveTab('guide')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'guide'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <HelpCircle className="w-4 h-4" />
              <span>Telegram Guide</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-[11px] text-slate-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Auto-refreshing every 4s</span>
          </div>
        </div>

        {/* Tab 1: Live Monitor & Simulator */}
        {activeTab === 'monitor' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 xl:col-span-5">
              <ChatSimulator onMessageSent={fetchLogs} />
            </div>
            <div className="lg:col-span-6 xl:col-span-7">
              <ActivityLogs logs={logs} onClearLogs={handleClearLogs} loading={loading} />
            </div>
          </div>
        )}

        {/* Tab 2: Instruction Updating Area */}
        {activeTab === 'instructions' && status && (
          <InstructionEditor
            config={status.config}
            onSaveConfig={handleSaveConfig}
          />
        )}

        {/* Tab 3: Access Control & Whitelist (Option 3) */}
        {activeTab === 'access' && (
          <AccessControlManager />
        )}

        {/* Tab 4: Persona & Engine Settings */}
        {activeTab === 'settings' && status && (
          <BotSettings
            config={status.config}
            botInfo={status.botInfo}
            appUrl={status.appUrl}
            mode={status.mode}
            onSaveConfig={handleSaveConfig}
            onSetWebhook={handleSetWebhook}
            onTogglePolling={handleTogglePolling}
          />
        )}

        {/* Tab 3: Telegram Connection & Commands Guide */}
        {activeTab === 'guide' && (
          <TelegramGuide botInfo={status?.botInfo || null} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500 mt-auto">
        <p>
          Gemini Telegram Bot • Powered by <span className="font-semibold text-slate-700">Google Gemini 3.8 Flash</span> & Telegram Bot API
        </p>
      </footer>
    </div>
  );
}
