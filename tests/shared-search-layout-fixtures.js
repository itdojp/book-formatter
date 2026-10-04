// Synthetic offline fragments, not copies of any consumer or private book.
const input = '<input id="search-input" type="search" aria-label="Search">';
const results = '<div id="search-results"></div>';
const content = '<main class="page-content"><h1>Alpha fixture</h1><p>Alpha evidence.</p></main>';
const sibling = attribute => input.replace('type="search"', `type="search" ${attribute}`) + results + content;

export const searchLayoutCases = [
  { id: 'siblings-unlimited', html: sibling(''), codes: [] },
  { id: 'siblings-maxlength2', html: sibling('maxlength="2"'), codes: [] },
  { id: 'siblings-maxlength64', html: sibling('maxlength="64"'), codes: [] },
  { id: 'text-input', html: sibling('').replace('type="search"', 'type="text"'), codes: [] },
  { id: 'results-ancestor', html: `<div id="search-results">${input}${content}</div>`, codes: ['results-remove-input', 'results-remove-content'], demonstration: 'removed-both' },
  { id: 'results-contain-input', html: `<div id="search-results">${input}</div>${content}`, codes: ['results-remove-input'] },
  { id: 'results-contain-content', html: `${input}<div id="search-results">${content}</div>`, codes: ['results-remove-content'] },
  { id: 'results-equal-content', html: `${input}<main id="search-results" class="page-content"><p>Alpha</p></main>`, codes: ['results-remove-content'] },
  { id: 'maxlength1', html: sibling('maxlength="1"'), codes: ['query-length'], demonstration: 'one-character' },
  { id: 'maxlength0', html: sibling('maxlength="0"'), codes: ['query-length'] },
  { id: 'missing-input', html: results + content, codes: ['selector-count'] },
  { id: 'missing-results', html: input + content, codes: ['selector-count'] },
  { id: 'missing-content', html: input + results, codes: ['selector-count'] },
  { id: 'duplicate-input', html: input + sibling(''), codes: ['selector-count'] },
  { id: 'duplicate-results', html: results + sibling(''), codes: ['selector-count'] },
  { id: 'duplicate-content', html: content + sibling(''), codes: ['selector-count'] },
  { id: 'wrong-input-type', html: sibling('').replace('type="search"', 'type="number"'), codes: ['input-type'] },
  { id: 'readonly', html: sibling('readonly'), codes: ['input-not-editable'] },
  { id: 'disabled-fieldset', html: `<fieldset disabled>${input}</fieldset>${results}${content}`, codes: ['input-not-editable'] }
];

export function searchLayoutPage(fragment) {
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'">' +
    '</head><body>' + fragment + '</body></html>';
}
