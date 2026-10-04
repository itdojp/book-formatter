/**
 * Read-only, finite integration preflight for the shipped shared search asset.
 * Self-contained so a trusted browser harness can use page.evaluate(function).
 * This is not a renderer, visibility audit, or sandbox for untrusted pages.
 */
export function inspectSharedSearchDocument(document) {
  if (document?.nodeType !== 9 || typeof document.querySelectorAll !== 'function') {
    throw new TypeError('shared search preflight requires a real browser Document');
  }
  const contractVersion = '1.0.0';
  const minimumQueryLength = 2;
  const selectors = ['#search-input', '#search-results', '.page-content'];
  const selected = selectors.map(selector => [...document.querySelectorAll(selector)]);
  const selectorCounts = Object.fromEntries(selectors.map((selector, i) => [selector, selected[i].length]));
  const findings = [];
  const add = (code, selector, message) => findings.push({ code, selector, message });
  for (let i = 0; i < selectors.length; i++) {
    if (selected[i].length !== 1) {
      add('selector-count', selectors[i], 'exactly one element is required');
    }
  }
  if (findings.length === 0) {
    const [input, results, content] = selected.map(elements => elements[0]);
    if (input.tagName !== 'INPUT' || !['text', 'search'].includes(input.type)) {
      add('input-type', '#search-input', 'a text or search input is required');
    } else {
      if (input.matches(':disabled') || input.readOnly) {
        add('input-not-editable', '#search-input', 'the input must not be disabled or readonly');
      }
      if (!Number.isInteger(input.maxLength) ||
          (input.maxLength !== -1 && input.maxLength < minimumQueryLength)) {
        add('query-length', '#search-input', 'native maxLength must be unlimited or at least two');
      }
    }
    if (results.contains(input)) {
      add('results-remove-input', '#search-results', 'results must not equal or contain the required input');
    }
    if (results.contains(content)) {
      add('results-remove-content', '#search-results', 'results must not equal or contain the required content');
    }
  }
  return { contractVersion, minimumQueryLength, passed: findings.length === 0, selectorCounts, findings };
}
