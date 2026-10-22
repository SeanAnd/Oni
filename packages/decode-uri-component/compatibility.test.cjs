const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const query = require('query-string');
const decode = require('./index.cjs');

test('keeps the upstream security fix unchanged apart from its CommonJS export', () => {
  const source = readFileSync(require.resolve('./index.cjs'), 'utf8').replace('module.exports = function decodeUriComponent(', 'export default function decodeUriComponent(');
  const readme = readFileSync(require.resolve('./README.md'), 'utf8');
  assert.ok(readme.includes(createHash('sha256').update(source).digest('hex')));
});
test('the actual Router query-string consumer resolves the fixed decoder', () => {
  const consumerRequire = createRequire(require.resolve('query-string'));
  assert.equal(consumerRequire('decode-uri-component'), decode);
  assert.equal(query.parse('q=%F0%9F%94%92&label=hello+world').q, '🔒');
  assert.equal(query.stringify({q: 'a&b'}), 'q=a%26b');
});
test('malformed percent escapes terminate without recursion or loss of valid characters', () => {
  const hostile = '%E0%A4'.repeat(8000);
  assert.equal(decode(hostile), hostile);
  assert.equal(query.parse(`q=${hostile}`).q, hostile);
  assert.equal(decode('%41%GG%42'), 'A%GGB');
});
test('scoped UUID upgrade preserves xcode project identifier generation', () => {
  const project = require('xcode').project('/unused.pbxproj');
  project.hash = {project: {objects: {}}};
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
  assert.notEqual(project.generateUuid(), project.generateUuid());
});
