import { useState } from 'react';
import { BotConfig, BotInfo } from '../types';
import {
  Settings,
  Save,
  Sliders,
  Radio,
  Check,
  Stethoscope,
  BookOpen,
  Brain,
  Pill,
  RotateCcw,
  Sparkles,
  Send,
  Loader2,
  FileQuestion,
  Lightbulb
} from 'lucide-react';
import { DEFAULT_MEDICAL_PROMPT } from '../../server/telegramBot';

interface BotSettingsProps {
  config: BotConfig;
  botInfo: BotInfo | null;
  appUrl: string;
  mode: string;
  onSaveConfig: (newConfig: Partial<BotConfig>) => Promise<void>;
  onSetWebhook: (url: string, remove?: boolean) => Promise<void>;
  onTogglePolling: (enabled: boolean) => Promise<void>;
}

const MEDICAL_SUBJECTS = [
  { id: 'Anatomy', label: 'Anatomy & Neuroanatomy', icon: '🫀' },
  { id: 'Physiology', label: 'Medical Physiology', icon: '⚡' },
  { id: 'Biochemistry', label: 'Biochemistry & Genetics', icon: '🧬' },
  { id: 'Microbiology', label: 'Microbiology & Immunology', icon: '🧫' },
  { id: 'Pathology', label: 'Pathology & Histopathology', icon: '🔬' },
  { id: 'Pharmacology', label: 'Pharmacology & Therapeutics', icon: '💊' },
];

const EXAM_LEVELS = [
  'USMLE Step 1 (Foundational Sciences)',
  'USMLE Step 2 CK (Clinical Management)',
  'NEET-PG / NEXT Medical Entrance',
  'PLAB / UKMLA Licensing',
  'Medical School Comprehensive Exams',
];

const MEDICAL_PERSONA_PRESETS = [
  {
    name: "USMLE & Board Exam Specialist",
    icon: Stethoscope,
    badge: "Highest Yield",
    desc: "Vignette-heavy MCQs, multi-step physiological reasoning, distractor breakdowns, and pearls.",
    prompt: `You are Medchat, a renowned Medical Sciences Professor and USMLE / Board Exam specialist powered by Google Gemini.
You specialize deeply in all foundational medical sciences: Gross Anatomy, Neuroanatomy, Physiology, Biochemistry, Microbiology, Pathology, and Pharmacology.

Your primary mission is training medical students to master board-level clinical vignettes and high-yield concepts:
1. When asked questions or for MCQs, generate authentic, realistic clinical cases (patient age/sex, vitals, exam signs, labs) with higher-order conceptual question stems.
2. Provide 4-5 options (A-E), followed by the correct answer, pathophysiological mechanism explanation, and distractor refutations explaining why each wrong answer is incorrect.
3. Include memorable high-yield clinical pearls and mnemonics.
4. Maintain a strictly medical domain focus—politely decline non-medical questions with a related clinical challenge.`,
  },
  {
    name: "Medical Sciences Professor",
    icon: BookOpen,
    badge: "Comprehensive",
    desc: "Rigorous academic coverage across Anatomy, Physio, Biochem, Micro, Path, and Pharm.",
    prompt: `You are Medchat, a distinguished Academic Professor of Medical Sciences.
You teach and examine across all core preclinical disciplines:
- Anatomy (vascular relations, innervation, fascial compartments, embryology)
- Physiology (cellular transport, hemodynamics, acid-base, neurophysiology)
- Biochemistry (glycolysis, TCA, urea cycle, lipid metabolism, inborn errors)
- Microbiology & Immunology (Gram stains, virulence factors, antimicrobials, hypersensitivities)
- Pathology (general injury, necrosis vs apoptosis, systemic organ pathology, histology clues)
- Pharmacology (mechanisms of action, pharmacokinetics, adverse effects, contraindications)

Provide clear, academic, and deeply structured medical explanations with bold headings, bullet points, and clinical correlations. Always be ready to generate practice questions and explain exam tips.`,
  },
  {
    name: "High-Yield Mnemonic & Recall Coach",
    icon: Brain,
    badge: "Memory & Tips",
    desc: "Focuses on rapid active recall, spaced repetition formulas, and high-yield clinical mnemonics.",
    prompt: `You are Medchat, a High-Yield Medical Board & Recall Coach.
You specialize in helping medical students memorize complex medical sciences through:
- High-yield mnemonics and memory palaces for Pharmacology drug classes and Pathology clues.
- Rapid active-recall drills and 2-step clinical reasoning tricks.
- Exam test-taking strategies: vignette parsing, buzzword identification, and trap avoidance.
- High-value practice MCQs emphasizing rapid elimination of distractors.
Keep answers sharp, memorable, high-yield, and bulleted.`,
  },
  {
    name: "Clinical Pharmacology Specialist",
    icon: Pill,
    badge: "Pharm Focus",
    desc: "Deep dive into drug mechanisms of action, receptors, adverse effects, and first-line regimens.",
    prompt: `You are Medchat, an expert Clinical Pharmacologist and Medical Educator.
You specialize in all aspects of Medical Pharmacology across all organ systems (cardiovascular, autonomic, CNS, antimicrobial, endocrine, chemo).
For every drug discussed, explain:
1. Exact molecular Mechanism of Action (receptors, enzymes, signaling cascades)
2. Clinical Indications & First-line guidelines
3. High-yield Adverse Drug Reactions & Black-box warnings
4. Notable Drug-Drug Interactions & Antidotes
5. Board-style Pharmacology clinical vignette MCQs with thorough distractor breakdowns.`,
  },
];

export function BotSettings({
  config,
  botInfo,
  appUrl,
  mode,
  onSaveConfig,
  onSetWebhook,
  onTogglePolling,
}: BotSettingsProps) {
  const [instruction, setInstruction] = useState(config.systemInstruction || DEFAULT_MEDICAL_PROMPT);
  const [temperature, setTemperature] = useState(config.temperature ?? 0.6);
  const [examLevel, setExamLevel] = useState(config.examLevel || EXAM_LEVELS[0]);
  const [activeSubjects, setActiveSubjects] = useState<string[]>(
    config.activeSubjects || ['Anatomy', 'Physiology', 'Biochemistry', 'Microbiology', 'Pathology', 'Pharmacology']
  );
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Live Prompt Test Sandbox
  const [testPrompt, setTestPrompt] = useState('Generate a high-yield clinical vignette MCQ on Renal Physiology & Pharmacology.');
  const [testingPrompt, setTestingPrompt] = useState(false);
  const [testResult, setTestResult] = useState<{ text?: string; latencyMs?: number; error?: string } | null>(null);

  const [customWebhookUrl, setCustomWebhookUrl] = useState(
    appUrl ? `${appUrl.replace(/\/$/, '')}/api/telegram/webhook` : ''
  );
  const [webhookActionLoading, setWebhookActionLoading] = useState(false);

  const toggleSubject = (subjectId: string) => {
    setActiveSubjects((prev) =>
      prev.includes(subjectId) ? prev.filter((s) => s !== subjectId) : [...prev, subjectId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveConfig({
        systemInstruction: instruction,
        temperature,
        examLevel,
        activeSubjects,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = () => {
    setInstruction(DEFAULT_MEDICAL_PROMPT);
  };

  const handleRunPromptTest = async () => {
    if (!testPrompt.trim() || testingPrompt) return;
    setTestingPrompt(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testPrompt }),
      });
      const data = await res.json();
      if (res.ok && data.reply) {
        setTestResult({ text: data.reply, latencyMs: data.latencyMs });
      } else {
        setTestResult({ error: data.error || 'Failed to generate test reply' });
      }
    } catch (err: any) {
      setTestResult({ error: err.message });
    } finally {
      setTestingPrompt(false);
    }
  };

  const handleRegisterWebhook = async () => {
    if (!customWebhookUrl) return;
    setWebhookActionLoading(true);
    try {
      await onSetWebhook(customWebhookUrl, false);
    } finally {
      setWebhookActionLoading(false);
    }
  };

  const handleDeleteWebhook = async () => {
    setWebhookActionLoading(true);
    try {
      await onSetWebhook('', true);
    } finally {
      setWebhookActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header and Save Bar */}
      <div id="bot-settings-card" className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Medical AI Persona & Prompt Customization</h3>
              <p className="text-xs text-slate-500">
                Configure your bot's medical specialization, prompt instructions, and exam difficulty
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetToDefault}
              type="button"
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              title="Reset prompt to default medical instruction"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Prompt</span>
            </button>

            <button
              id="save-settings-btn"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Medical Science Focus Subjects */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-800 block">
            Specialized Medical Science Disciplines
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {MEDICAL_SUBJECTS.map((sub) => {
              const active = activeSubjects.includes(sub.id);
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => toggleSubject(sub.id)}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                    active
                      ? 'bg-teal-50 border-teal-300 text-teal-900 shadow-2xs'
                      : 'bg-slate-50 border-slate-200 text-slate-400 opacity-60 hover:opacity-100'
                  }`}
                >
                  <span className="text-lg">{sub.icon}</span>
                  <span className="text-center line-clamp-1">{sub.id}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Target Medical Exam Level */}
        <div className="space-y-1.5">
          <label htmlFor="exam-level-select" className="text-xs font-semibold text-slate-800">
            Target Exam Level & Question Rigor
          </label>
          <select
            id="exam-level-select"
            value={examLevel}
            onChange={(e) => setExamLevel(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
          >
            {EXAM_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </div>

        {/* Preset Medical Personas */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-800">
            Quick Medical Persona Presets
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {MEDICAL_PERSONA_PRESETS.map((preset, idx) => {
              const Icon = preset.icon;
              const isSelected = instruction === preset.prompt;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setInstruction(preset.prompt)}
                  className={`p-3 text-left rounded-lg border text-xs transition-all flex flex-col justify-between cursor-pointer ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/50 text-indigo-950 ring-1 ring-indigo-500 shadow-2xs'
                      : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5 font-bold">
                        <Icon className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
                        <span className="truncate">{preset.name}</span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700 font-semibold flex-shrink-0">
                        {preset.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 line-clamp-2">{preset.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* System Instruction (Editable Prompt) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="system-instruction-textarea" className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>System Prompt (Gemini AI Medical Instructions)</span>
            </label>
            <span className="text-[11px] font-mono text-slate-500">
              {instruction.length} characters • Injected into all Telegram queries
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            You can modify this prompt freely. It instructs Gemini on clinical reasoning, tone, MCQ structure, and high-yield medical exam preparation.
          </p>
          <textarea
            id="system-instruction-textarea"
            rows={10}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Define how Gemini should behave when answering Telegram users..."
            className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all font-mono leading-relaxed"
          />
        </div>

        {/* Creativity / Temperature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="temperature-slider" className="text-xs font-semibold text-slate-800">
              Temperature (Clinical Precision): <span className="text-indigo-600 font-bold">{temperature}</span>
            </label>
            <span className="text-[11px] text-slate-500">
              0.2 = Highly deterministic & factual | 0.6 = Ideal for clinical vignettes & exam questions
            </span>
          </div>
          <input
            id="temperature-slider"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
        </div>

        {/* Live Prompt Testing Sandbox */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <FileQuestion className="w-3.5 h-3.5 text-indigo-600" />
                Live Prompt Verification Sandbox
              </h4>
              <p className="text-[11px] text-slate-500">
                Test how Gemini responds using your customized prompt before saving to Telegram
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTestPrompt('Generate a USMLE Step 1 Clinical Vignette MCQ testing Pharmacology mechanism of action.')}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium"
              >
                Sample: Pharm MCQ
              </button>
              <button
                type="button"
                onClick={() => setTestPrompt('Give me high-yield medical exam preparation tips and mnemonics for Pathology & Microbiology.')}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium"
              >
                Sample: Exam Tips
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Enter a prompt to test your system instructions..."
              className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
            <button
              type="button"
              onClick={handleRunPromptTest}
              disabled={testingPrompt || !testPrompt.trim()}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer flex-shrink-0"
            >
              {testingPrompt ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Evaluating...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Test Prompt</span>
                </>
              )}
            </button>
          </div>

          {testResult && (
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
              {testResult.error ? (
                <div className="text-rose-600 font-semibold">{testResult.error}</div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pb-2 border-b border-slate-200">
                    <span className="font-semibold text-emerald-700">Gemini Response Generated</span>
                    <span>Latency: {testResult.latencyMs}ms</span>
                  </div>
                  <div className="whitespace-pre-wrap font-sans text-slate-800 leading-relaxed max-h-72 overflow-y-auto">
                    {testResult.text}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Telegram Connection Protocol */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-sky-600" />
              Telegram Connection Protocol
            </h4>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 capitalize">
              Current Mode: {mode}
            </span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-800">Long Polling (Active & Recommended)</p>
                <p className="text-[11px] text-slate-500">
                  Continuous outgoing connection to Telegram API. Receives user questions and button taps instantly.
                </p>
              </div>
              <button
                id="enable-polling-btn"
                onClick={() => onTogglePolling(true)}
                disabled={mode === 'polling'}
                className={`px-3 py-1.5 rounded-md font-semibold transition-all ${
                  mode === 'polling'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {mode === 'polling' ? 'Active' : 'Switch to Polling'}
              </button>
            </div>

            <div className="pt-2 border-t border-slate-200/70">
              <p className="font-semibold text-slate-800 mb-1">Webhook Mode</p>
              <p className="text-[11px] text-slate-500 mb-2">
                Configure an HTTPS endpoint if you deploy behind a production domain.
              </p>
              <div className="flex items-center gap-2">
                <input
                  id="webhook-url-input"
                  type="text"
                  value={customWebhookUrl}
                  onChange={(e) => setCustomWebhookUrl(e.target.value)}
                  placeholder="https://your-domain.com/api/telegram/webhook"
                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
                />
                <button
                  id="register-webhook-btn"
                  onClick={handleRegisterWebhook}
                  disabled={webhookActionLoading || !customWebhookUrl}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Set Webhook
                </button>
                {mode === 'webhook' && (
                  <button
                    id="delete-webhook-btn"
                    onClick={handleDeleteWebhook}
                    disabled={webhookActionLoading}
                    className="px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-md text-xs font-semibold transition-colors"
                  >
                    Delete Webhook
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
