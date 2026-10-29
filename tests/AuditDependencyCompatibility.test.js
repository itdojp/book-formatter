import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ajvRequire = createRequire(require.resolve('ajv/package.json'));
const textlintRequire = createRequire(require.resolve('textlint/package.json'));
const uri = ajvRequire('fast-uri');
const { z } = textlintRequire('zod');

test('audited URI and Zod versions resolve through actual root callers', () => {
  assert.equal(ajvRequire('fast-uri/package.json').version, '3.1.9');
  assert.equal(textlintRequire('zod/package.json').version, '4.6.7');
  for (const name of ['@modelcontextprotocol/core', '@modelcontextprotocol/server']) {
    const caller = createRequire(require.resolve(name));
    assert.equal(caller('zod/package.json').version, '4.6.7');
  }
});

test('URI references retain relative meaning and never introduce a scheme', () => {
  assert.equal(uri.resolve('https://lab.example/a/b', '../c'), 'https://lab.example/c');
  assert.equal(uri.normalize('../chapter'), '../chapter');
  for (const input of ['./a:b', 'a/..//x']) {
    const result = uri.parse(uri.normalize(input));
    assert.equal(result.scheme, undefined);
    assert.equal(result.host, undefined);
  }
  assert.equal(uri.parse(uri.serialize({ scheme: 'x', path: 'a:b' }, { reference: 'suffix' })).scheme, undefined);
});

test('encoded schemes and malformed domain hosts fail closed', () => {
  assert.throws(() => uri.serialize({ scheme: '%68ttps', host: 'lab.example' }), /scheme is malformed/);
  assert.equal(uri.parse('https://lab\t.example/').error, 'URI host is malformed.');
  assert.equal(uri.parse('https://lab.example/').host, 'lab.example');
});

for (const kind of ['array', 'set', 'map']) {
  test(`Zod ${kind} size bound is checked before element refinements`, () => {
    let visits = 0;
    const element = z.string().refine(() => { visits++; return true; });
    const schema = kind === 'array' ? z.array(element).max(2)
      : kind === 'set' ? z.set(element).max(2) : z.map(z.string(), element).max(2);
    const value = (items) => kind === 'array' ? items : kind === 'set' ? new Set(items) : new Map(items.map((v, i) => [String(i), v]));
    const rejected = schema.safeParse(value(['a', 'b', 'c']));
    assert.equal(rejected.success, false);
    assert.deepEqual(rejected.error.issues.map(i => i.code), ['too_big']);
    assert.equal(visits, 0);
    assert.equal(schema.safeParse(value(['a', 'b'])).success, true);
    assert.equal(visits, 2);
  });
}
