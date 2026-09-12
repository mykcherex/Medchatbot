/**
 * Medical Text & Symbol Formatting Engine
 * Converts raw LaTeX notation, math syntax, and raw characters into clean,
 * publication-grade Unicode symbols, superscripts, subscripts, arrows, and emojis.
 * Also standardizes bold formatting (avoiding ALL-CAPS shouting) and optimizes vertical spacing.
 */

// Mapping of numbers & signs to Unicode superscripts
const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ', 'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ',
  'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ',
  'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ',
  'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ',
  'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
};

// Mapping of numbers & letters to Unicode subscripts
const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
  'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
  'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
  'v': 'ᵥ', 'x': 'ₓ',
};

function toSuperscript(str: string): string {
  return str.split('').map(c => SUPERSCRIPT_MAP[c] || c).join('');
}

function toSubscript(str: string): string {
  return str.split('').map(c => SUBSCRIPT_MAP[c] || c).join('');
}

/**
 * Converts raw LaTeX expressions, chemical notations, and math characters into clean Unicode
 */
export function formatMedicalSymbols(raw: string): string {
  if (!raw) return "";

  let text = raw;

  // 1. Common medical ion & molecule shortcuts
  text = text
    .replace(/\\text\{Ca\}\^\{?2\+\}?/gi, 'Ca²⁺')
    .replace(/\\text\{Na\}\^\{?\+?\}?/gi, 'Na⁺')
    .replace(/\\text\{K\}\^\{?\+?\}?/gi, 'K⁺')
    .replace(/\\text\{Cl\}\^\{?\-?\}?/gi, 'Cl⁻')
    .replace(/\\text\{Mg\}\^\{?2\+\}?/gi, 'Mg²⁺')
    .replace(/\\text\{H\}\^\{?\+?\}?/gi, 'H⁺')
    .replace(/\\text\{HCO\}_?3\^\{?\-?\}?/gi, 'HCO₃⁻')
    .replace(/\\text\{PO\}_?4\^\{?3\-\}?/gi, 'PO₄³⁻')
    .replace(/\\text\{O\}_?2/gi, 'O₂')
    .replace(/\\text\{CO\}_?2/gi, 'CO₂')
    .replace(/\bCa\^\{?2\+\}?/g, 'Ca²⁺')
    .replace(/\bNa\^\{?\+\}?/g, 'Na⁺')
    .replace(/\bK\^\{?\+\}?/g, 'K⁺')
    .replace(/\bCl\^\{?\-\}?/g, 'Cl⁻')
    .replace(/\bMg\^\{?2\+\}?/g, 'Mg²⁺')
    .replace(/\bH\^\{?\+\}?/g, 'H⁺')
    .replace(/\bHCO_?3\^\{?\-?\}?/g, 'HCO₃⁻')
    .replace(/\bPO_?4\^\{?3\-\}?/g, 'PO₄³⁻')
    .replace(/\bO_?2\b/g, 'O₂')
    .replace(/\bCO_?2\b/g, 'CO₂')
    .replace(/\$I_f\$/gi, 'If')
    .replace(/\$I_\{?f\}?\$/gi, 'If')
    .replace(/\$I_\{?Kr\}?\$/gi, 'IKr')
    .replace(/\$I_\{?Ks\}?\$/gi, 'IKs')
    .replace(/\$I_\{?to\}?\$/gi, 'Ito')
    .replace(/\$I_\{?Ca,L\}?\$/gi, 'ICa-L')
    .replace(/\$I_\{?Ca,T\}?\$/gi, 'ICa-T');

  // 2. LaTeX Arrow Replacements
  text = text
    .replace(/\$(?:\\uparrow|\\Uparrow|\\up)\$/gi, '↑')
    .replace(/\\uparrow|\\Uparrow/gi, '↑')
    .replace(/\$(?:\\downarrow|\\Downarrow|\\down)\$/gi, '↓')
    .replace(/\\downarrow|\\Downarrow/gi, '↓')
    .replace(/\$(?:\\rightarrow|\\Rightarrow|\\to)\$/gi, '→')
    .replace(/\\rightarrow|\\Rightarrow|\\to\b/gi, '→')
    .replace(/\$(?:\\leftarrow|\\Leftarrow|\\gets)\$/gi, '←')
    .replace(/\\leftarrow|\\Leftarrow|\\gets\b/gi, '←')
    .replace(/\$(?:\\leftrightarrow|\\Leftrightarrow|\\rightleftharpoons)\$/gi, '↔')
    .replace(/\\leftrightarrow|\\Leftrightarrow|\\rightleftharpoons/gi, '↔');

  // 3. LaTeX Greek letters & Math symbols
  text = text
    .replace(/\\alpha\b/gi, 'α')
    .replace(/\\beta\b/gi, 'β')
    .replace(/\\gamma\b/gi, 'γ')
    .replace(/\\delta\b/gi, 'δ')
    .replace(/\\Delta\b/g, 'Δ')
    .replace(/\\epsilon\b/gi, 'ε')
    .replace(/\\theta\b/gi, 'θ')
    .replace(/\\lambda\b/gi, 'λ')
    .replace(/\\mu\b/gi, 'μ')
    .replace(/\\pi\b/gi, 'π')
    .replace(/\\sigma\b/gi, 'σ')
    .replace(/\\tau\b/gi, 'τ')
    .replace(/\\phi\b/gi, 'φ')
    .replace(/\\omega\b/gi, 'ω')
    .replace(/\\Omega\b/g, 'Ω')
    .replace(/\\pm\b/gi, '±')
    .replace(/\\mp\b/gi, '∓')
    .replace(/\\approx\b/gi, '≈')
    .replace(/\\neq\b/gi, '≠')
    .replace(/\\le\b|\\leq\b/gi, '≤')
    .replace(/\\ge\b|\\geq\b/gi, '≥')
    .replace(/\\times\b/gi, '×')
    .replace(/\\cdot\b/gi, '·')
    .replace(/\\div\b/gi, '÷')
    .replace(/\\infty\b/gi, '∞')
    .replace(/\\degree\b|\^\{\\circ\}|\\circ\b/gi, '°');

  // 4. Clean LaTeX \text{...}, \mathrm{...}, \mathbf{...}, \mathit{...}
  text = text.replace(/\\(?:text|mathrm|mathbf|mathit|textbf)\{([^}]+)\}/g, '$1');

  // 5. Convert generic LaTeX superscripts and subscripts
  // Superscripts like ^{2+}, ^{3-}, ^+, ^-, ^2, ^{abc}
  text = text.replace(/\^\{([^}]+)\}/g, (_, inner) => toSuperscript(inner));
  text = text.replace(/\^([0-9\+\-a-zA-Z])/g, (_, char) => toSuperscript(char));

  // Subscripts like _{2}, _{3}, _f, _t, _{max}
  text = text.replace(/_\{([^}]+)\}/g, (_, inner) => toSubscript(inner));
  text = text.replace(/_([0-9a-zA-Z])/g, (match, char) => {
    // Only convert single character subscripts if reasonable
    const sub = toSubscript(char);
    return sub !== char ? sub : match;
  });

  // 6. Strip remaining math dollar signs: $...$ -> ...
  text = text.replace(/\$([^\$]+)\$/g, '$1');
  text = text.replace(/\$\$/g, '');
  text = text.replace(/\\/g, ''); // Clean any stray trailing backslashes

  // 7. Ensure space between arrows and following chemical names / words: e.g. "↑Ca²⁺" -> "↑ Ca²⁺"
  text = text.replace(/([↑↓→←↔])([a-zA-Z0-9])/g, '$1 $2');
  text = text.replace(/([a-zA-Z0-9])([↑↓→←↔])/g, '$1 $2');

  return text.trim();
}

/**
 * Converts ALL CAPS headers / phrases into clean, elegant Title Case / Sentence Case with *bold* formatting.
 * Preserves standard medical abbreviations (e.g. USMLE, ECG, MRI, CT, CKD, COPD, DNA, RNA, ATP, ACE, ARB, ICU, ED).
 */
export function formatMedicalCaseAndBold(text: string): string {
  if (!text) return "";

  const ACRONYMS = new Set([
    'USMLE', 'ECG', 'EKG', 'MRI', 'CT', 'CKD', 'COPD', 'DNA', 'RNA', 'ATP',
    'ACE', 'ARB', 'ICU', 'ED', 'ER', 'IV', 'IM', 'PO', 'PRN', 'QID', 'TID', 'BID',
    'QD', 'CBC', 'BMP', 'CMP', 'LFT', 'ABG', 'CXR', 'CPR', 'BLS', 'ACLS', 'ATLS',
    'GCS', 'CSF', 'RBC', 'WBC', 'PLT', 'INR', 'PT', 'PTT', 'aPTT', 'BUN', 'Cr',
    'GFR', 'Na', 'K', 'Ca', 'Mg', 'Cl', 'HCO3', 'PO4', 'O2', 'CO2', 'PaO2', 'PaCO2',
    'SpO2', 'FiO2', 'STEMI', 'NSTEMI', 'CAD', 'CHF', 'HFrEF', 'HFpEF', 'DVT', 'PE',
    'PAD', 'AAA', 'TIA', 'CVA', 'SAH', 'ICH', 'SDH', 'EDH', 'ICP', 'CPP', 'MAP',
    'SBP', 'DBP', 'HR', 'RR', 'BP', 'BMI', 'BSA', 'DM', 'T1D', 'T2D', 'DKA', 'HHS',
    'GERD', 'IBD', 'IBS', 'UC', 'CD', 'PUD', 'GI', 'GU', 'GYN', 'OB', 'NICU', 'PICU',
    'UTI', 'AKI', 'ESRD', 'HIV', 'AIDS', 'HBV', 'HCV', 'HPV', 'HSV', 'EBV', 'CMV',
    'VZV', 'RSV', 'TB', 'PCP', 'MRSA', 'VRE', 'ESBL', 'CRE', 'CDI', 'C. diff', 'MCQ',
  ]);

  const lines = text.split('\n');
  const processedLines: string[] = [];

  for (let line of lines) {
    const trimmed = line.trim();

    // Check if line is an all-caps heading or bullet (e.g., "# 1. 🫀 ANATOMICAL & STRUCTURAL IDENTIFICATION" or "**PATHOPHYSIOLOGY MECHANISM:**")
    // Match header lines or bold sections that have >= 4 uppercase characters without lowercase
    const isHeaderLine = /^(?:#+\s*|\*\*\s*|\*\s*|\d+\.\s*|[A-Z]\)\s*|[•\-]\s*)?[A-Z0-9\s,&:\/\-\(\)\u2190-\u2193\u2700-\u27BF\uE000-\uF8FF\uD83C-\uDBFF\uDC00-\uDFFF]{6,}(?:\*\*|\*)?:?$/.test(trimmed);

    if (isHeaderLine && /[A-Z]{4,}/.test(trimmed)) {
      // Convert words while preserving acronyms
      const converted = trimmed.replace(/([A-Z]{2,}|[A-Za-z]+)/g, (word) => {
        const upper = word.toUpperCase();
        if (ACRONYMS.has(upper)) {
          return upper;
        }
        // Capitalize first letter, lowercase rest
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      });

      // Ensure proper bold formatting instead of raw uppercase
      let formattedHeader = converted;
      if (!formattedHeader.startsWith('#') && !formattedHeader.startsWith('**') && !formattedHeader.startsWith('*')) {
        // If it was a header-like line without bold markers, wrap it in bold
        if (/^[0-9•\-\*]/.test(formattedHeader)) {
          formattedHeader = formattedHeader.replace(/^([0-9]+\.\s*|[•\-]\s*)(.*)$/, '$1**$2**');
        } else {
          formattedHeader = `**${formattedHeader}**`;
        }
      }
      processedLines.push(formattedHeader);
    } else {
      processedLines.push(line);
    }
  }

  return processedLines.join('\n');
}

/**
 * Optimizes vertical spacing for crystal-clear readability on mobile and web:
 * - Ensures generous double-line spacing between sections, paragraphs, and list blocks.
 * - Cleans excessive trailing spaces or 3+ consecutive newlines into exactly 2 newlines.
 */
export function optimizeMedicalSpacing(text: string): string {
  if (!text) return "";

  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, ''); // remove trailing whitespace per line

  // Add spacing before headers if missing
  cleaned = cleaned.replace(/([^\n])\n(#{1,4}\s+)/g, '$1\n\n$2');
  cleaned = cleaned.replace(/([^\n])\n(\*\*[A-Z][^\*\n]+\*\*:?)/g, '$1\n\n$2');

  // Add spacing around tables
  cleaned = cleaned.replace(/([^\n])\n(\|.+\|\n\|[-:\s|]+\|)/g, '$1\n\n$2');

  // Collapse 3 or more blank lines down to 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Comprehensive medical text formatting pipeline:
 * 1. Formats LaTeX, math, chemical formulas, arrows, superscripts & subscripts
 * 2. Formats case & applies elegant bolding instead of all-caps
 * 3. Optimizes spacing for readability
 */
export function cleanAndFormatMedicalText(text: string): string {
  if (!text) return "";
  const withSymbols = formatMedicalSymbols(text);
  const withCase = formatMedicalCaseAndBold(withSymbols);
  const withSpacing = optimizeMedicalSpacing(withCase);
  return withSpacing;
}
