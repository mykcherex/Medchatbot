import { useState, useEffect } from 'react';
import { BotConfig } from '../types';
import {
  Sparkles,
  Save,
  RotateCcw,
  Check,
  AlertCircle,
  Stethoscope,
  BookOpen,
  Brain,
  Pill,
  Copy,
  Sliders,
  Zap,
  Info
} from 'lucide-react';
import { DEFAULT_MEDICAL_PROMPT } from '../../server/telegramBot';

interface InstructionEditorProps {
  config: BotConfig;
  onSaveConfig: (newConfig: Partial<BotConfig>) => Promise<void>;
}

const PERSONA_PRESETS = [
  {
    name: "Clinical Board & High-Yield",
    badge: "Recommended",
    icon: Stethoscope,
    desc: "Rigorous scientific depth, high-yield clinical pearls, only generates MCQs when requested.",
    prompt: `You are Medchat, an expert Medical Sciences Professor & Board Exam specialist powered by Google Gemini.
You deeply master: Gross Anatomy, Neuroanatomy, Medical Physiology, Biochemistry, Microbiology, Pathology, and Pharmacology.

CRITICAL OPERATIONAL RULES:
1. IMAGE RETRIEVAL: When the user asks for images (e.g. "heart image", "send kidney images"), high-yield diagrams (2-5 images) are provided. Explain visible anatomical landmarks, vascular relations, and board associations.
2. QUESTION GENERATION: DO NOT automatically generate multiple-choice questions (MCQs) for every message. Only generate clinical MCQs when the user explicitly asks for them (e.g. "/mcq", "give me a quiz", "test me on cardiology").
3. CLINICAL EXPLANATIONS: Provide structured, academic breakdowns with bold headings, pathophysiology mechanisms, and high-yield board pearls.
4. TONE: Scholarly, encouraging, and authoritative. Politely redirect non-medical questions back to medical science.`,
  },
  {
    name: "Academic Medical Professor",
    badge: "Comprehensive",
    icon: BookOpen,
    desc: "Deep systematic breakdown across organ systems, biochemistry cycles, and disease etiologies.",
    prompt: `You are Medchat, a distinguished University Professor of Preclinical & Paraclinical Medical Sciences.
You teach across Anatomy, Physiology, Biochemistry, Microbiology, Pathology, and Pharmacology.

INSTRUCTIONAL PRINCIPLES:
- Thoroughly break down disease mechanisms, receptor actions, and physiological feedback loops.
- Explain histological hallmarks and diagnostic criteria clearly.
- Only generate assessment questions or MCQs when the user specifically requests them.
- Support multimodal image requests with anatomical relations and vascular supply details.`,
  },
  {
    name: "High-Yield Mnemonic & Recall Coach",
    badge: "Rapid Recall",
    icon: Brain,
    desc: "Focuses on rapid active-recall mnemonics, buzzword associations, and memory palaces.",
    prompt: `You are Medchat, a high-yield medical recall coach.
Your mission is to help medical students remember complex pharmacological mechanisms, biochemical pathways, and microbiological organisms.
- Provide memorable clinical mnemonics, phonetic associations, and table summaries.
- Keep explanations punchy and high-yield.
- Generate quiz questions only when explicitly asked.`,
  },
  {
    name: "Clinical Pharmacology Specialist",
    badge: "Pharm Focus",
    icon: Pill,
    desc: "Deep focus on drug targets, receptors, adverse effects, first-line regimens, and contraindications.",
    prompt: `You are Medchat, a Clinical Pharmacologist and Board Review Educator.
For every pharmacological topic:
- Detail exact mechanism of action, receptor subtype, and secondary messengers.
- Detail high-yield adverse reactions, black box warnings, and CYP450 interactions.
- Provide first-line clinical guidelines.
- Do not append unsolicited questions unless requested.`,
  },
];

const DIRECTIVE_SNIPPETS = [
  {
    label: "No Unsolicited MCQs",
    text: "\n- RULE: Never generate MCQs or quizzes unless the user explicitly asks for them (e.g. '/mcq' or 'question on...').",
  },
  {
    label: "2-5 Images on Demand",
    text: "\n- RULE: When requested for images (e.g. 'heart image'), 2-5 clinical diagrams are retrieved. Describe key anatomical landmarks and relations.",
  },
  {
    label: "High-Yield Board Pearls",
    text: "\n- Always include 1-2 bulleted 'High-Yield Board Pearls' summarizing classic associations.",
  },
  {
    label: "Distractor Refutations",
    text: "\n- When MCQs are requested, provide detailed explanations for why each distractor option (A-E) is incorrect.",
  },
];

export function InstructionEditor({ config, onSaveConfig }: InstructionEditorProps) {
  const [instruction, setInstruction] = useState(config.systemInstruction || DEFAULT_MEDICAL_PROMPT);
  const [temperature, setTemperature] = useState(config.temperature ?? 0.4);
  const [examLevel, setExamLevel] = useState(config.examLevel || 'USMLE Step 1 (Foundational Sciences)');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sync state if config updates externally
  useEffect(() => {
    if (config.systemInstruction) {
      setInstruction(config.systemInstruction);
    }
    if (config.temperature !== undefined) {
      setTemperature(config.temperature);
    }
    if (config.examLevel) {
      setExamLevel(config.examLevel);
    }
  }, [config.systemInstruction, config.temperature, config.examLevel]);

  const hasUnsavedChanges =
    instruction !== (config.systemInstruction || DEFAULT_MEDICAL_PROMPT) ||
    temperature !== (config.temperature ?? 0.4) ||
    examLevel !== (config.examLevel || 'USMLE Step 1 (Foundational Sciences)');

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveConfig({
        systemInstruction: instruction,
        temperature,
        examLevel,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to update instructions:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm("Reset instructions back to the default Medchat Medical prompt?")) {
      setInstruction(DEFAULT_MEDICAL_PROMPT);
      setTemperature(0.4);
    }
  };

  const handleAppendSnippet = (snippetText: string) => {
    setInstruction((prev) => {
      if (prev.includes(snippetText.trim())) return prev;
      return prev.trimEnd() + snippetText;
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(instruction);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="instruction-updating-area" className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Instruction Updating Area</h2>
                {hasUnsavedChanges ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                    Unsaved Changes
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Live & Synced
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Update the bot&apos;s core system prompt in real-time. Instructions are directly injected into every Telegram and Web consultation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Copy current instructions"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>

            <button
              id="save-instructions-btn"
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
                savedSuccess
                  ? 'bg-emerald-600 text-white'
                  : hasUnsavedChanges
                  ? 'bg-teal-600 hover:bg-teal-700 text-white ring-2 ring-teal-300 ring-offset-1'
                  : 'bg-slate-800 hover:bg-slate-900 text-white'
              }`}
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span>Applying...</span>
                </>
              ) : savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Instructions Updated!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Update Instructions</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Preset Personas Picker */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Load Persona Blueprint</span>
          </label>
          <span className="text-[11px] text-slate-400">Click to instantly populate prompt</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PERSONA_PRESETS.map((p, idx) => {
            const Icon = p.icon;
            const isMatch = instruction === p.prompt;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setInstruction(p.prompt)}
                className={`p-3 rounded-xl border text-left text-xs transition-all flex flex-col justify-between cursor-pointer ${
                  isMatch
                    ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-500 text-teal-950 shadow-2xs'
                    : 'border-slate-200 bg-slate-50/40 hover:bg-slate-100/80 text-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5 text-teal-600" />
                      {p.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-teal-100 text-teal-800 font-semibold">
                      {p.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-2">{p.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Instruction Editor Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <label htmlFor="system-instruction-main" className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <span>System Prompt & Reasoning Directives</span>
            </label>
            <p className="text-[11px] text-slate-500 mt-0.5">
              This prompt governs the Gemini AI behavior. Use it to specify tone, image behaviors, question constraints, and explanation formats.
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md self-start sm:self-auto">
            <span>{instruction.length} chars</span>
            <span>•</span>
            <span>{instruction.trim().split(/\s+/).filter(Boolean).length} words</span>
          </div>
        </div>

        {/* Quick Insert Snippet Chips */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 mr-1">
            <Info className="w-3 h-3" /> Quick Add:
          </span>
          {DIRECTIVE_SNIPPETS.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleAppendSnippet(chip.text)}
              className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-teal-50 hover:text-teal-800 hover:border-teal-200 border border-slate-200 text-slate-700 text-[11px] font-medium transition-colors cursor-pointer"
            >
              + {chip.label}
            </button>
          ))}
        </div>

        {/* Textarea */}
        <div className="relative">
          <textarea
            id="system-instruction-main"
            rows={14}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Type your system instructions for the AI medical professor..."
            className="w-full p-3.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-500 focus:bg-white transition-all font-mono leading-relaxed text-slate-800"
          />
        </div>

        {/* Supporting Parameters: Temperature & Exam Focus */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="instruction-temperature" className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 text-teal-600" />
                <span>Temperature (Reasoning Randomness):</span>
                <span className="text-teal-700 font-bold ml-1">{temperature}</span>
              </label>
              <span className="text-[10px] text-slate-400">0.0 (Strict) - 1.0 (Creative)</span>
            </div>
            <input
              id="instruction-temperature"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
            />
            <p className="text-[11px] text-slate-500">
              {temperature <= 0.3
                ? "🎯 Highly factual and deterministic medical references."
                : temperature <= 0.6
                ? "⚖️ Balanced: Recommended for clinical case reasoning & exam vignettes."
                : "💡 Higher variability, useful for creative mnemonics and diverse cases."}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="instruction-exam-level" className="text-xs font-bold text-slate-800">
              Exam Benchmark Level
            </label>
            <select
              id="instruction-exam-level"
              value={examLevel}
              onChange={(e) => setExamLevel(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-500 font-medium text-slate-800"
            >
              <option value="USMLE Step 1 (Foundational Sciences)">USMLE Step 1 (Foundational Sciences)</option>
              <option value="USMLE Step 2 CK (Clinical Management)">USMLE Step 2 CK (Clinical Management)</option>
              <option value="NEET-PG / NEXT Medical Entrance">NEET-PG / NEXT Medical Entrance</option>
              <option value="PLAB / UKMLA Licensing">PLAB / UKMLA Licensing</option>
              <option value="Medical School Comprehensive Exams">Medical School Comprehensive Exams</option>
            </select>
            <p className="text-[11px] text-slate-500">
              Sets baseline clinical rigor and guideline conventions across all queries.
            </p>
          </div>
        </div>

        {/* Footer update action */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <Info className="w-3.5 h-3.5 text-teal-600" />
            <span>Changes take effect immediately on next message sent via Telegram or Simulator.</span>
          </p>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
              savedSuccess
                ? 'bg-emerald-600 text-white'
                : hasUnsavedChanges
                ? 'bg-teal-600 hover:bg-teal-700 text-white ring-2 ring-teal-300'
                : 'bg-slate-800 hover:bg-slate-900 text-white'
            }`}
          >
            {saving ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : savedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Saved & Live!</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Instructions</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
