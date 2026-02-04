/**
 * Unicode 品質チェッカー
 *
 * 目的:
 * - 書籍の Markdown で混入しやすい「不可視文字」「互換漢字」「異体字セレクタ」等を検出し、
 *   誤字脱字や表示崩れの原因を早期に発見できるようにする。
 *
 * 注意:
 * - 「日本の漢字でない漢字（簡体字など）」の判定はUnicode範囲のみでは確定できないため、
 *   本チェッカーは確度の高いパターン（互換漢字/異体字セレクタ等）を中心に検出する。
 */

function normalizeCodepoint(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `U+${value.toString(16).toUpperCase().padStart(4, '0')}`;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // Accept "U+00A0", "00A0", "0x00A0"
  const upper = trimmed.toUpperCase();
  const match = upper.match(/^(?:U\+|0X)?([0-9A-F]{4,6})$/);
  if (!match) return null;
  return `U+${match[1].padStart(4, '0')}`;
}

function toCodepoint(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function normalizeAllowlist(raw) {
  const global = new Set();
  const files = new Map();

  if (!raw || typeof raw !== 'object') {
    return { global, files };
  }

  const globalList = Array.isArray(raw.global) ? raw.global : [];
  for (const entry of globalList) {
    const normalized = normalizeCodepoint(entry);
    if (normalized) global.add(normalized);
  }

  const fileMap = raw.files && typeof raw.files === 'object' ? raw.files : {};
  for (const [file, entries] of Object.entries(fileMap)) {
    if (!Array.isArray(entries)) continue;
    const set = new Set();
    for (const entry of entries) {
      const normalized = normalizeCodepoint(entry);
      if (normalized) set.add(normalized);
    }
    const normalizedFile = String(file).replace(/\\/g, '/');
    files.set(normalizedFile, set);
  }

  return { global, files };
}

function classifyCodepoint(cp) {
  // Error (invisible / control / replacement)
  if (cp === 0xfffd) {
    return {
      kind: 'replacement-character',
      severity: 'error',
      message: 'REPLACEMENT CHARACTER (U+FFFD) を検出しました（文字化け/欠落の可能性）'
    };
  }

  if (cp === 0x0000) {
    return {
      kind: 'null-character',
      severity: 'error',
      message: 'NULL文字 (U+0000) を検出しました（ファイル破損/処理系の不具合につながる可能性）'
    };
  }

  // C0 control chars (except tab/newline/CR) and DEL.
  if ((cp >= 0x00 && cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || cp === 0x7f) {
    return {
      kind: 'control-character',
      severity: 'error',
      message: '制御文字を検出しました（不可視/表示崩れの可能性）'
    };
  }

  // C1 control chars
  if (cp >= 0x80 && cp <= 0x9f) {
    return {
      kind: 'control-character',
      severity: 'error',
      message: '制御文字（C1）を検出しました（不可視/表示崩れの可能性）'
    };
  }

  // Common invisible/format characters that frequently slip in.
  // Note: ZWJ/ZWNJ can be valid in emoji sequences. Keep them as warning to avoid false positives.
  const invisible = new Map([
    [0x00a0, { severity: 'warning', message: 'NO-BREAK SPACE (U+00A0) を検出しました（通常の半角スペースへ置換推奨）' }],
    [0x00ad, { severity: 'warning', message: 'SOFT HYPHEN (U+00AD) を検出しました（不可視の改行制御の可能性）' }],
    [0x180e, { severity: 'error', message: 'MONGOLIAN VOWEL SEPARATOR (U+180E) を検出しました（不可視文字）' }],
    [0x200b, { severity: 'error', message: 'ZERO WIDTH SPACE (U+200B) を検出しました（不可視文字）' }],
    [0x200c, { severity: 'warning', message: 'ZERO WIDTH NON-JOINER (U+200C) を検出しました（不可視文字）' }],
    [0x200d, { severity: 'warning', message: 'ZERO WIDTH JOINER (U+200D) を検出しました（不可視文字）' }],
    [0x2060, { severity: 'error', message: 'WORD JOINER (U+2060) を検出しました（不可視文字）' }],
    [0xfeff, { severity: 'warning', message: 'ZERO WIDTH NO-BREAK SPACE / BOM (U+FEFF) を検出しました（不可視文字）' }],
    [0x2028, { severity: 'error', message: 'LINE SEPARATOR (U+2028) を検出しました（改行扱いで表示崩れの可能性）' }],
    [0x2029, { severity: 'error', message: 'PARAGRAPH SEPARATOR (U+2029) を検出しました（改行扱いで表示崩れの可能性）' }]
  ]);
  const invisibleRule = invisible.get(cp);
  if (invisibleRule) {
    return {
      kind: 'invisible-character',
      severity: invisibleRule.severity,
      message: invisibleRule.message
    };
  }

  // Warning (needs human judgment)
  // Variation Selector Supplement (VS17-256) is primarily used for ideograph variants.
  // VS1-16 (U+FE00..U+FE0F) is frequently used for emoji presentation (e.g. U+26A1 U+FE0F),
  // so it is intentionally excluded here to avoid noisy reports.
  if (cp >= 0xe0100 && cp <= 0xe01ef) {
    return {
      kind: 'variation-selector',
      severity: 'warning',
      message: '異体字セレクタ（Variation Selector）を検出しました（意図しない字形の可能性）'
    };
  }

  // CJK Compatibility Ideographs
  if ((cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f)) {
    return {
      kind: 'cjk-compatibility-ideograph',
      severity: 'warning',
      message: 'CJK互換漢字を検出しました（通常の漢字に置換できるか確認してください）'
    };
  }

  // Fullwidth alphanumerics
  const isFullwidthDigit = cp >= 0xff10 && cp <= 0xff19;
  const isFullwidthUpper = cp >= 0xff21 && cp <= 0xff3a;
  const isFullwidthLower = cp >= 0xff41 && cp <= 0xff5a;
  if (isFullwidthDigit || isFullwidthUpper || isFullwidthLower) {
    return {
      kind: 'fullwidth-alnum',
      severity: 'warning',
      message: '全角英数字を検出しました（半角への統一を推奨）'
    };
  }

  // Confusable punctuation (high-signal only)
  // U+2212 (MINUS SIGN) is frequently mixed with ASCII '-' in code/math contexts.
  if (cp === 0x2212) {
    return {
      kind: 'confusable-punctuation',
      severity: 'warning',
      message: '紛らわしいマイナス記号（U+2212）を検出しました（ASCII "-" と混同に注意）'
    };
  }

  return null;
}

export class UnicodeChecker {
  /**
   * @param {{ allowlist?: {global?: any[], files?: Record<string, any[]>} | null }} [options]
   */
  constructor(options = {}) {
    this.allowlist = normalizeAllowlist(options.allowlist);
  }

  /**
   * @param {string} relativeFile
   * @param {string} codepoint
   */
  isAllowed(relativeFile, codepoint) {
    if (!codepoint) return false;
    if (this.allowlist.global.has(codepoint)) return true;
    const key = String(relativeFile || '');
    const normalizedKey = key.replace(/\\/g, '/');
    const set = this.allowlist.files.get(normalizedKey) || this.allowlist.files.get(key);
    if (!set) return false;
    return set.has(codepoint);
  }

  /**
   * @param {string} text
   * @param {string} relativeFile
   * @returns {Array<{line:number,column:number,codepoint:string,char:string,kind:string,severity:'error'|'warning',message:string}>}
   */
  scanText(text, relativeFile = '') {
    const issues = [];

    let line = 1;
    let column = 1;

    for (let i = 0; i < text.length; ) {
      const cp = text.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      const startLine = line;
      const startColumn = column;

      // Normalize newlines for line/column tracking.
      if (ch === '\n') {
        line += 1;
        column = 1;
        i += 1;
        continue;
      }
      if (ch === '\r') {
        line += 1;
        column = 1;
        i += 1;
        if (text[i] === '\n') i += 1; // CRLF
        continue;
      }

      const classification = classifyCodepoint(cp);
      if (classification) {
        const codepoint = toCodepoint(cp);
        if (!this.isAllowed(relativeFile, codepoint)) {
          issues.push({
            line: startLine,
            column: startColumn,
            codepoint,
            char: ch,
            kind: classification.kind,
            severity: classification.severity,
            message: classification.message
          });
        }
      }

      column += 1;
      i += ch.length;
    }

    return issues;
  }
}

export { normalizeCodepoint };
