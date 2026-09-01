export const STANDARD_CALLOUT_TYPES = new Set([
  'note',
  'tip',
  'warning',
  'paid',
  'internal'
]);

export function detectStandardFenceOpen(line) {
  const match = String(line || '').match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;

  const infoString = String(match[2] || '').trim();
  const language = infoString.split(/\s+/).filter(Boolean)[0] || '';
  const markerChar = match[1][0];

  return {
    markerChar,
    markerLen: match[1].length,
    infoString,
    language: language.toLowerCase(),
    invalidInfoString: markerChar === '`' && infoString.includes('`')
  };
}

export function isStandardFenceClose(line, fence) {
  if (!fence) return false;
  const match = String(line || '').match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
  if (!match) return false;
  if (match[1][0] !== fence.markerChar) return false;
  return match[1].length >= fence.markerLen;
}

export function parseStandardCalloutDelimiter(line) {
  const source = String(line || '');
  const candidate = source.trimStart();
  if (!candidate.startsWith(':::')) return null;

  const indented = candidate !== source;
  if (/^:::\s*$/.test(candidate)) return { kind: 'close', indented };

  const opening = candidate.match(/^:::([a-z]+)\s*$/);
  if (opening) {
    return { kind: 'open', type: opening[1], indented };
  }

  return { kind: 'invalid', indented };
}
