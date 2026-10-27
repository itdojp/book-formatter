import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Deliberately small DOM adapter, not an HTML renderer: any dynamic HTML sink
// fails. npm run test:shared-dom-browser also exercises native DOM behavior.
class Element {
  constructor(tagName = '', text = '') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.value = '';
    this.text = text;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classes = new Set();
    const classes = this.classes;
    this.classList = {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value)
    };
  }
  get className() { return [...this.classes].join(' '); }
  set className(value) {
    this.classes.clear();
    String(value).split(/[\t\n\f\r ]+/).filter(Boolean).forEach((name) => this.classes.add(name));
  }
  set innerHTML(_value) { throw new Error('HTML reinterpretation is forbidden'); }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  appendChild(child) {
    if (child.tagName === 'FRAGMENT') {
      for (const node of [...child.children]) this.appendChild(node);
      child.children = [];
    } else {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }
  replaceChildren() { this.children = []; this.text = ''; }
  remove() { this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
  setAttribute(key, value) { this.attributes[key] = value; }
  hasAttribute(key) { return key in this.attributes; }
  matches(selector) {
    return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(selector.split(',').some((part) => child.matches(part.trim())) ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  addEventListener(event, callback) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), callback]);
  }
  removeEventListener(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) this.listeners.set(event, callbacks.filter((fn) => fn !== callback));
  }
  emit(event, data = {}) {
    for (const callback of this.listeners.get(event) || []) callback.call(this, { target: this, ...data });
  }
  scrollIntoView() { this.scrolled = true; }
  blur() { this.blurred = true; }
}

test('bounded test DOM removal of an unregistered event or callback is a no-op', () => {
  const element = new Element('div');
  let count = 0;
  const active = () => { count++; };
  const unknown = () => {};
  element.removeEventListener('keydown', unknown);
  assert.equal(element.listeners.has('keydown'), false);
  element.addEventListener('keydown', active);
  element.removeEventListener('keydown', unknown);
  element.emit('keydown');
  assert.equal(count, 1);
  element.removeEventListener('keydown', active);
  element.removeEventListener('keydown', active);
  element.emit('keydown');
  assert.equal(count, 1);
});

test('test DOM class selectors share className/classList token state', () => {
  const element = new Element('div');
  element.className = 'first second';
  assert.equal(element.matches('.first'), true);
  assert.equal(element.classList.contains('second'), true);
  element.classList.add('third');
  assert.equal(element.matches('.third'), true);
  assert.equal(element.className, 'first second third');
  element.classList.remove('first');
  assert.equal(element.matches('.first'), false);
  element.className = 'replacement';
  assert.equal(element.matches('.third'), false);
  assert.equal(element.matches('.replacement'), true);
});

function fixture(script, texts = [], prepare = () => {}) {
  const document = new Element('document');
  document.readyState = 'complete';
  document.head = new Element('head');
  document.head.insertAdjacentHTML = (_position, value) => {
    assert.ok(value.trim().startsWith('<style>'), 'only existing static styles are injected');
  };
  document.body = new Element('body');
  const input = new Element('input');
  const results = new Element('div');
  const content = new Element('div');
  texts.forEach((text) => content.appendChild(new Element('p', text)));
  document.getElementById = (id) => ({ 'search-input': input, 'search-results': results })[id];
  document.querySelector = (selector) => selector === '.page-content' ? content : null;
  document.querySelectorAll = (selector) => selector === '.page-content img' ? content.querySelectorAll('img') : [];
  document.createElement = (tag) => new Element(tag);
  document.createTextNode = (text) => new Element('', text);
  document.createDocumentFragment = () => new Element('fragment');
  const timers = new Map();
  let timerId = 0;
  const context = {
    document, console: { warn: (...args) => { throw new Error(args.join(' ')); } },
    window: { addEventListener() {}, location: { hostname: 'lab.example' } },
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id)
  };
  prepare({ document, context });
  vm.runInNewContext(readFileSync(new URL(`../shared/assets/js/${script}`, import.meta.url), 'utf8'), context);
  const flush = () => {
    const callbacks = [...timers.values()]; timers.clear();
    callbacks.forEach((fn) => fn());
  };
  return {
    document, input, results, content, flush,
    search(query) { input.value = query; input.emit('input'); flush(); }
  };
}

test('search: DOM-derived markup and query remain literal text, with safe mark nodes', () => {
  const text = '<img src="offline.invalid" data-sentinel="literal"> & 日本語 [test]';
  const f = fixture('search.js', [text]);
  f.search('img');
  assert.equal(f.results.querySelector('.search-result-snippet').textContent, text);
  assert.deepEqual(f.results.querySelectorAll('mark').map((node) => node.textContent), ['img', 'img']);
  assert.equal(f.results.querySelectorAll('img').length, 0);
  assert.ok(f.results.classList.contains('active'));
  f.search('<not-found>');
  assert.equal(f.results.querySelector('p').textContent, '「<not-found>」に一致する結果が見つかりませんでした。');
  assert.equal(f.results.querySelectorAll('not-found').length, 0);
});

for (const query of ['[test]', 'a+b', 'x.y', '(ok)', 'a\\b', '${x}', 'x|y', '^x', 'a*', 'x?', 'A$', '日本語', 'mixed']) {
  test(`search: literal highlight ${JSON.stringify(query)}`, () => {
    const text = `before ${query} MiXeD ${query} after`;
    const f = fixture('search.js', [text]);
    f.search(query);
    const snippet = f.results.querySelector('.search-result-snippet');
    assert.equal(snippet.textContent, text);
    assert.ok(snippet.querySelectorAll('mark').length >= 2);
    snippet.querySelectorAll('mark').forEach((node) => assert.equal(node.textContent.toLowerCase(), query.toLowerCase()));
  });
}

test('search: ten-result limit, replacement, click, highlight timeout and dismissal remain functional', () => {
  const f = fixture('search.js', Array.from({ length: 12 }, (_, i) => `match ${i}`));
  f.search('match');
  assert.equal(f.results.querySelectorAll('.search-result-item').length, 10);
  assert.equal(f.results.querySelector('.search-more').textContent, '他 2 件の結果');
  f.results.emit('click', { target: f.results.querySelector('mark') });
  assert.equal(f.content.children[0].scrolled, true);
  assert.ok(f.content.children[0].classList.contains('search-highlight'));
  assert.equal(f.input.value, '');
  f.flush();
  assert.equal(f.content.children[0].classList.contains('search-highlight'), false);
  f.search('match 11');
  assert.equal(f.results.querySelectorAll('.search-result-item').length, 1);
  f.input.emit('keydown', { key: 'Escape' });
  assert.equal(f.results.classList.contains('active'), false);
  assert.equal(f.input.blurred, true);
  f.search('m');
  assert.equal(f.results.classList.contains('active'), false);
});

for (const query of ['m', '', '   ', ' m ', '\t\n']) {
  test(`search: short normalized query ${JSON.stringify(query)} cannot refocus stale results`, () => {
    const f = fixture('search.js', ['match synthetic fixture']);
    f.search('match');
    assert.equal(f.results.querySelectorAll('.search-result-item').length, 1);
    f.input.value = query;
    f.input.emit('input');
    assert.equal(f.results.classList.contains('active'), false, 'short input hides immediately');
    assert.equal(f.results.children.length, 0, 'short input clears the old query');
    f.input.blur();
    f.input.emit('focus');
    f.flush();
    assert.equal(f.results.classList.contains('active'), false, 'focus/debounce must remain hidden');
    assert.equal(f.results.children.length, 0);
  });
}

test('search: focus recomputes the current valid query before its debounce', () => {
  const f = fixture('search.js', ['match synthetic fixture', 'other synthetic fixture']);
  f.search('match');
  f.input.value = '  other  ';
  f.input.emit('input');
  assert.equal(f.results.classList.contains('active'), false, 'old results are hidden while pending');
  f.input.emit('focus');
  assert.equal(f.results.querySelectorAll('.search-result-item').length, 1);
  assert.equal(f.results.querySelector('.search-result-snippet').textContent, 'other synthetic fixture');
  f.flush();
  assert.equal(f.results.querySelector('.search-result-snippet').textContent, 'other synthetic fixture');
});

test('search: programmatic short value on focus uses the same normalized threshold', () => {
  const f = fixture('search.js', ['match synthetic fixture']);
  f.search('match');
  f.input.value = ' m ';
  f.input.emit('focus');
  assert.equal(f.results.classList.contains('active'), false);
  assert.equal(f.results.children.length, 0);
  f.input.value = ' ma ';
  f.input.emit('focus');
  assert.equal(f.results.classList.contains('active'), true);
  assert.equal(f.results.querySelectorAll('.search-result-item').length, 1);
});

for (const dismiss of ['button', 'backdrop', 'Escape']) {
  test(`image modal: literal src/alt, exact node inventory and ${dismiss} dismissal`, () => {
    const f = fixture('main.js');
    const img = new Element('img');
    img.src = 'https://assets.example/image.png?q=" data-sentinel="literal';
    img.alt = '" data-sentinel="literal"><em>not markup</em>';
    f.content.appendChild(img);
    f.flush();
    img.emit('click');
    const modal = f.document.body.querySelector('.image-modal');
    assert.ok(modal);
    const copy = modal.querySelector('img');
    assert.equal(copy.src, img.src);
    assert.equal(copy.alt, img.alt);
    assert.deepEqual(copy.attributes, {});
    assert.equal(modal.querySelectorAll('em').length, 0);
    assert.equal(modal.querySelectorAll('img').length, 1);
    assert.equal(modal.querySelector('button').textContent, '×');
    if (dismiss === 'button') modal.querySelector('button').emit('click');
    else if (dismiss === 'backdrop') modal.emit('click');
    else f.document.emit('keydown', { key: 'Escape' });
    assert.equal(f.document.body.querySelector('.image-modal'), null);
  });
}

for (const dismiss of ['button', 'backdrop', 'Escape']) {
  test(`image modal: repeated ${dismiss} teardown retains unrelated listeners`, () => {
    const f = fixture('main.js');
    const img = new Element('img');
    img.src = 'https://assets.example/image.png';
    f.content.appendChild(img);
    f.flush();
    let unrelatedCalls = 0;
    const unrelated = () => { unrelatedCalls++; };
    f.document.addEventListener('keydown', unrelated);
    for (let iteration = 0; iteration < 3; iteration++) {
      img.emit('click');
      const modal = f.document.body.querySelector('.image-modal');
      assert.equal(f.document.listeners.get('keydown').length, 2);
      // An ordinary key and a click inside the dialog must not dismiss it.
      f.document.emit('keydown', { key: 'a' });
      modal.emit('click', { target: modal.querySelector('img') });
      assert.equal(f.document.body.querySelector('.image-modal'), modal);
      if (dismiss === 'button') modal.querySelector('button').emit('click');
      else if (dismiss === 'backdrop') modal.emit('click');
      else f.document.emit('keydown', { key: 'Escape' });
      assert.equal(f.document.body.querySelector('.image-modal'), null);
      assert.deepEqual(f.document.listeners.get('keydown'), [unrelated]);
      // Repeat a stale close after reopening: it must not remove the new handler.
      img.emit('click');
      modal.querySelector('button').emit('click');
      assert.equal(f.document.listeners.get('keydown').length, 2);
      f.document.emit('keydown', { key: 'Escape' });
      assert.equal(f.document.body.querySelector('.image-modal'), null);
      assert.deepEqual(f.document.listeners.get('keydown'), [unrelated]);
    }
    assert.ok(unrelatedCalls >= 6);
  });
}


test('managed search fix has a discoverable assets/shared release version', () => {
  const version = JSON.parse(readFileSync(new URL('../shared/version.json', import.meta.url), 'utf8'));
  const newerThan323 = (value) => {
    const parts = value.split('.').map(Number);
    return parts[0] > 3 || (parts[0] === 3 && (parts[1] > 2 || (parts[1] === 2 && parts[2] > 3)));
  };
  assert.ok(newerThan323(version.version));
  assert.ok(newerThan323(version.components.assets.version));
  assert.ok(version.components.assets.files.includes('assets/js/search.js'));
});

const INITIALIZERS = [
  'addStyles', 'initSmoothScrolling', 'addHeadingIds',
  'generateTOC', 'handleExternalLinks', 'enhanceImages'
];

for (const readyState of ['loading', 'complete']) {
  for (const failed of [[], ...INITIALIZERS.map((name) => [name]), INITIALIZERS]) {
    test(`main: ${readyState} isolates synchronous initializer failures: ${failed.join(',') || 'none'}`, () => {
      const attempts = [];
      const warnings = [];
      const delays = [];
      const sentinel = 'synthetic reader input MUST NOT be logged';
      const observe = (name, run) => (...args) => {
        attempts.push(name);
        if (failed.includes(name)) throw new Error(sentinel);
        return run(...args);
      };
      const f = fixture('main.js', [], ({ document, context }) => {
        document.readyState = readyState;
        context.console.warn = (...args) => warnings.push(args);
        const later = context.setTimeout;
        context.setTimeout = (fn, delay) => { delays.push(delay); return later(fn); };
        document.head.insertAdjacentHTML = observe('addStyles', document.head.insertAdjacentHTML);
        const listen = document.addEventListener.bind(document);
        document.addEventListener = (event, fn) => event === 'click'
          ? observe('initSmoothScrolling', listen)(event, fn) : listen(event, fn);
        const one = document.querySelector;
        document.querySelector = (selector) => selector === '.page-toc'
          ? observe('generateTOC', one)(selector) : one(selector);
        const all = document.querySelectorAll;
        document.querySelectorAll = (selector) => {
          const name = {
            '.page-content h1, .page-content h2, .page-content h3, .page-content h4, .page-content h5, .page-content h6': 'addHeadingIds',
            'a[href^="http"]': 'handleExternalLinks',
            '.page-content img': 'enhanceImages'
          }[selector];
          return name ? observe(name, all)(selector) : all(selector);
        };
      });
      if (readyState === 'loading') {
        assert.deepEqual(attempts, [], 'wait for DOM readiness');
        f.document.emit('DOMContentLoaded');
      }
      assert.deepEqual(attempts, INITIALIZERS.slice(0, 2));
      assert.deepEqual(delays, [100, 200], 'preserve both scheduling delays');
      f.flush();
      assert.deepEqual(attempts, INITIALIZERS, 'every independent initializer runs once, in order');
      assert.deepEqual(warnings, failed.map((name) => [
        `[book-formatter/main] ${name}: optional initialization failed; continuing.`
      ]));
      assert.equal(JSON.stringify(warnings).includes(sentinel), false);
      assert.equal(f.document.listeners.get('click')?.length || 0,
        failed.includes('initSmoothScrolling') ? 0 : 1);
      f.flush();
      assert.deepEqual(attempts, INITIALIZERS, 'no retries or duplicate initialization');
    });
  }
}

test('main: optional legacy utility remains outside default layouts and managed sync', () => {
  const version = JSON.parse(readFileSync(new URL('../shared/version.json', import.meta.url), 'utf8'));
  assert.equal(version.components.assets.files.includes('assets/js/main.js'), false);
  for (const layout of ['book', 'default']) {
    const source = readFileSync(new URL(`../shared/layouts/${layout}.html`, import.meta.url), 'utf8');
    assert.equal(/<script[^>]+src=[^>]*assets\/js\/main\.js/u.test(source), false);
  }
});
