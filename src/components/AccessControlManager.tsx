import { useState, useEffect, useCallback } from 'react';
import { AccessControlStatus } from '../types';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserX,
  Clock,
  Key,
  UserPlus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Radio,
  Send,
  Trash2,
  Users
} from 'lucide-react';

export function AccessControlManager() {
  const [data, setData] = useState<AccessControlStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [targetIdentifier, setTargetIdentifier] = useState('');
  const [actionStatus, setActionStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [adminInput, setAdminInput] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/access-control');
      if (res.ok) {
        const json: AccessControlStatus = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch access control status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleToggle = async (enabled: boolean) => {
    try {
      const res = await fetch('/api/access-control/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.status);
        setActionStatus({
          type: 'success',
          message: enabled ? 'Private Access Mode Enabled (Admin Approval Required)' : 'Public Mode Enabled (Anyone can interact with Medchat)',
        });
      }
    } catch (err: any) {
      setActionStatus({ type: 'error', message: err.message || 'Failed to update access mode' });
    }
  };

  const handleApprove = async (identifier: string | number) => {
    if (!identifier) return;
    try {
      const res = await fetch('/api/access-control/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const json = await res.json();
      if (res.ok) {
        setActionStatus({ type: 'success', message: json.message || 'User approved successfully' });
        setTargetIdentifier('');
        fetchStatus();
      } else {
        setActionStatus({ type: 'error', message: json.error || 'Failed to approve user' });
      }
    } catch (err: any) {
      setActionStatus({ type: 'error', message: err.message || 'Network error' });
    }
  };

  const handleRevoke = async (identifier: string | number) => {
    if (!identifier) return;
    try {
      const res = await fetch('/api/access-control/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const json = await res.json();
      if (res.ok) {
        setActionStatus({ type: 'success', message: json.message || 'User access revoked' });
        fetchStatus();
      } else {
        setActionStatus({ type: 'error', message: json.error || 'Failed to revoke user' });
      }
    } catch (err: any) {
      setActionStatus({ type: 'error', message: err.message || 'Network error' });
    }
  };

  const handleAddAdmin = async () => {
    if (!adminInput.trim()) return;
    try {
      const res = await fetch('/api/access-control/add-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: adminInput.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setData(json.status);
        setAdminInput('');
        setActionStatus({ type: 'success', message: `Added ${adminInput} as bot admin` });
      }
    } catch (err: any) {
      setActionStatus({ type: 'error', message: err.message || 'Failed to add admin' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Notification Alert */}
      {actionStatus && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-xs sm:text-sm border transition-all ${
            actionStatus.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionStatus.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            )}
            <span>{actionStatus.message}</span>
          </div>
          <button
            onClick={() => setActionStatus(null)}
            className="text-xs opacity-70 hover:opacity-100 font-semibold ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Mode Toggle Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
              data?.accessControlEnabled ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
            }`}>
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Bot Access Control & Approval System (Option 3)
                </h2>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  data?.accessControlEnabled
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-slate-100 text-slate-700 border border-slate-300'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${data?.accessControlEnabled ? 'bg-emerald-600 animate-pulse' : 'bg-slate-400'}`} />
                  {data?.accessControlEnabled ? 'Private (Strict Whitelist)' : 'Public (Open Access)'}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-2xl">
                When enabled, random Telegram users cannot use your bot without your explicit approval.
                They receive a friendly access-request screen, and you receive real-time 1-click approval buttons in Telegram and here.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              onClick={() => handleToggle(!data?.accessControlEnabled)}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-xs ${
                data?.accessControlEnabled
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white'
              }`}
            >
              {data?.accessControlEnabled ? (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  <span>Disable Private Mode</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Enable Private Mode</span>
                </>
              )}
            </button>

            <button
              onClick={fetchStatus}
              disabled={loading}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Pending Requests & Pre-approval Form */}
        <div className="lg:col-span-7 space-y-6">
          {/* Pending Access Requests */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Pending Access Requests ({data?.pendingRequests.length || 0})
                </h3>
              </div>
              {data?.pendingRequests.length ? (
                <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  Awaiting Review
                </span>
              ) : null}
            </div>

            {(!data?.pendingRequests || data.pendingRequests.length === 0) ? (
              <div className="text-center py-8 px-4 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                <p className="text-xs font-semibold text-slate-800">No pending access requests</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  When new students message your bot, their approval request will appear here and in your Telegram chat.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.pendingRequests.map((req) => (
                  <div
                    key={req.chatId}
                    className="p-3.5 rounded-xl border border-amber-200/80 bg-amber-50/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{req.name || 'Anonymous Student'}</span>
                        {req.username ? (
                          <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                            {req.username.startsWith('@') ? req.username : `@${req.username}`}
                          </span>
                        ) : null}
                        <span className="text-[10px] text-slate-500 font-mono">ID: {req.chatId}</span>
                      </div>
                      {req.lastMessage && (
                        <p className="text-xs text-slate-600 italic bg-white/70 px-2 py-1 rounded border border-slate-200/60 max-w-md line-clamp-2">
                          "{req.lastMessage}"
                        </p>
                      )}
                      <div className="text-[10px] text-slate-500">
                        Requested: {new Date(req.requestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(req.requestedAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={() => handleApprove(req.username || req.chatId)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() => handleRevoke(req.chatId)}
                        className="px-2.5 py-1.5 bg-slate-200 hover:bg-rose-100 hover:text-rose-700 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                        title="Dismiss request"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pre-Approve Student Form */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="w-4 h-4 text-teal-700" />
              <h3 className="text-sm font-bold text-slate-900">Pre-Authorize a Telegram Username or ID</h3>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Authorize a student in advance. As soon as they open the bot and tap <b>/start</b>, they will be granted immediate access.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleApprove(targetIdentifier);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={targetIdentifier}
                onChange={(e) => setTargetIdentifier(e.target.value)}
                placeholder="e.g. @student_telegram or 123456789"
                className="flex-1 px-3.5 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-700 focus:bg-white text-slate-900"
              />
              <button
                type="submit"
                disabled={!targetIdentifier.trim()}
                className="px-4 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <UserCheck className="w-4 h-4" />
                <span>Grant Access</span>
              </button>
            </form>
          </div>

          {/* Active Whitelisted / Approved Users */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Approved Students & Whitelisted Users ({data?.approvedUsers.length || 0})
                </h3>
              </div>
            </div>

            {(!data?.approvedUsers || data.approvedUsers.length === 0) && (!data?.approvedUsernames || data.approvedUsernames.length === 0) ? (
              <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <p className="text-xs text-slate-500">No authorized students yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.approvedUsers.map((user) => (
                  <div
                    key={user.chatId}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs flex-shrink-0">
                        {user.name ? user.name[0]?.toUpperCase() : 'U'}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <span>{user.name}</span>
                          {user.username && (
                            <span className="text-teal-700 font-normal">
                              {user.username.startsWith('@') ? user.username : `@${user.username}`}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          Chat ID: {user.chatId} • Approved {new Date(user.approvedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRevoke(user.chatId)}
                      className="px-2.5 py-1 text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>Revoke</span>
                    </button>
                  </div>
                ))}

                {data.approvedUsernames.filter(u => !data.approvedUsers.some(au => au.username?.replace(/^@/, '').toLowerCase() === u.toLowerCase())).map((username) => (
                  <div
                    key={username}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-teal-800">@{username}</span>
                      <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">Pre-Authorized Username</span>
                    </div>
                    <button
                      onClick={() => handleRevoke(`@${username}`)}
                      className="px-2.5 py-1 text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>Revoke</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Telegram Admin Commands & How It Works */}
        <div className="lg:col-span-5 space-y-6">
          {/* Admin Activation Card */}
          <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">How to Claim Admin Access in Telegram</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              To control the bot directly inside Telegram, send this command from your Telegram account:
            </p>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-amber-300 flex items-center justify-between">
              <span>/claimadmin medadmin2026</span>
              <span className="text-[10px] text-slate-500 font-sans">Passcode</span>
            </div>

            <div className="text-xs text-slate-300 space-y-1.5 pt-1 border-t border-slate-800">
              <p className="font-semibold text-slate-200">Registered Admins ({data?.adminsCount || 0}):</p>
              {data?.admins && data.admins.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {data.admins.map((a, i) => (
                    <span key={i} className="px-2 py-0.5 bg-slate-800 rounded text-[11px] font-mono text-teal-300">
                      {a.value}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic">No admins registered yet. Use /claimadmin medadmin2026 in Telegram.</p>
              )}
            </div>

            {/* Quick Add Admin by username */}
            <div className="pt-2">
              <label className="block text-[11px] text-slate-400 mb-1">Add Admin Username/ID:</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={adminInput}
                  onChange={(e) => setAdminInput(e.target.value)}
                  placeholder="e.g. @my_username"
                  className="flex-1 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <button
                  onClick={handleAddAdmin}
                  disabled={!adminInput.trim()}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Telegram Admin Commands Cheat-Sheet */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-700" />
              <span>Telegram Admin Commands</span>
            </h3>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-mono font-bold text-teal-800">/approve @username</div>
                <div className="text-slate-600 text-[11px] mt-0.5">Grants access to a student via username or chat ID.</div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-mono font-bold text-rose-800">/revoke @username</div>
                <div className="text-slate-600 text-[11px] mt-0.5">Revokes a student's access instantly.</div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-mono font-bold text-slate-800">/pending</div>
                <div className="text-slate-600 text-[11px] mt-0.5">Shows all pending student requests with 1-click [✅ Approve] buttons.</div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-mono font-bold text-slate-800">/users</div>
                <div className="text-slate-600 text-[11px] mt-0.5">Lists all active authorized students and administrators.</div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-mono font-bold text-slate-800">/broadcast &lt;message&gt;</div>
                <div className="text-slate-600 text-[11px] mt-0.5">Sends an announcement to all approved students.</div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-mono font-bold text-slate-800">/toggleauth</div>
                <div className="text-slate-600 text-[11px] mt-0.5">Quickly switches between private mode and open public mode.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
