import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Public specification: .github Issue 2, request comment 6116850106.
// Proposed API: checkBody(body, templateText) -> { ok, problems: [{ heading, reason }] }.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repoRoot, 'scripts', 'check-pr-body.mjs');
const templateText = readFileSync(join(repoRoot, 'pull_request_template.md'), 'utf8');
const headings = templateText.split(/\r?\n/).filter(line => line.startsWith('## ')).map(line => line.slice(3));
let api;
let importError;
try {
  api = await import(new URL('../scripts/check-pr-body.mjs', import.meta.url));
} catch (error) {
  importError = error;
}

function check(body, template = templateText) {
  assert.equal(importError, undefined, `The specified API is unavailable: ${importError?.message}`);
  assert.equal(typeof api.checkBody, 'function', 'Export the specified checkBody function');
  return api.checkBody(body, template);
}

function section(heading, content = '合成データで確かめました。') {
  return `## ${heading}\n\n${content}\n`;
}

function fullBody(changes = new Map()) {
  return headings.map(heading => section(heading, changes.get(heading) ?? '合成データで確かめました。')).join('\n');
}

function expectProblems(body, problems, template = templateText) {
  const result = check(body, template);
  assert.equal(result.ok, problems.length === 0);
  const byHeading = (left, right) => left.heading.localeCompare(right.heading) || left.reason.localeCompare(right.reason);
  assert.deepEqual([...result.problems].sort(byHeading), [...problems].sort(byHeading));
}

function runCli(event, options = {}) {
  assert.equal(existsSync(scriptPath), true, 'Implement the specified command before checking its exit code');
  const scratch = mkdtempSync(join(tmpdir(), 'pr-body-spec-'));
  try {
    const eventPath = join(scratch, 'event.json');
    if (!options.missingFile) writeFileSync(eventPath, options.rawJson ?? JSON.stringify(event));
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: scratch,
      encoding: 'utf8',
      // No inherited credentials: the command needs only this event file.
      env: { GITHUB_EVENT_PATH: eventPath },
      timeout: 10000,
    });
    assert.equal(result.error, undefined, 'The command must start and terminate normally');
    assert.equal(result.signal, null);
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('all required headings with content pass', () => {
  expectProblems(fullBody(), []);
});

test('heading order is not required', () => {
  expectProblems([...headings].reverse().map(heading => section(heading)).join('\n'), []);
});

test('surrounding whitespace on exact heading lines is ignored', () => {
  const body = headings.map(heading => ` \t## ${heading} \t\n\n内容\n`).join('\n');
  expectProblems(body, []);
});

test('one missing heading produces one missing problem', () => {
  const omitted = headings[1];
  expectProblems(headings.filter(heading => heading !== omitted).map(heading => section(heading)).join('\n'),
    [{ heading: omitted, reason: 'missing' }]);
});

test('an untouched template has every section empty', () => {
  expectProblems(templateText, headings.map(heading => ({ heading, reason: 'empty' })));
});

test('null body has every heading missing', () => {
  expectProblems(null, headings.map(heading => ({ heading, reason: 'missing' })));
});

test('empty string has every heading missing', () => {
  expectProblems('', headings.map(heading => ({ heading, reason: 'missing' })));
});

test('a whitespace-only section is empty', () => {
  expectProblems(fullBody(new Map([[headings[0], ' \n\t\n ']])), [{ heading: headings[0], reason: 'empty' }]);
});

test('single-line HTML comment does not fill a section', () => {
  expectProblems(fullBody(new Map([[headings[0], '<!-- 合成データの説明 -->']])), [{ heading: headings[0], reason: 'empty' }]);
});

test('multiline HTML comments do not fill a section', () => {
  expectProblems(fullBody(new Map([[headings[0], '<!--\n合成データ\n--><!-- 別の説明 -->\n ']])), [{ heading: headings[0], reason: 'empty' }]);
});

test('real content next to HTML comments fills a section', () => {
  expectProblems(fullBody(new Map([[headings[0], '<!-- 説明 -->内容<!--\n説明\n-->']])), []);
});

test('template placeholder rows with surrounding spaces do not fill confirmation', () => {
  expectProblems(fullBody(new Map([['確認', '  - 試験:  \n\t- CI:\t\n']])), [{ heading: '確認', reason: 'empty' }]);
});

test('template placeholder rows do not fill impact', () => {
  expectProblems(fullBody(new Map([['影響範囲', '- 変わる:\n- 変わらない:']])), [{ heading: '影響範囲', reason: 'empty' }]);
});

test('a bare template bullet does not fill changes', () => {
  expectProblems(fullBody(new Map([['変更内容', '-']])), [{ heading: '変更内容', reason: 'empty' }]);
});

test('filled placeholder row counts as content', () => {
  expectProblems(fullBody(new Map([['確認', '- 試験: 合成ケース9件\n- CI: 未実行']])), []);
});

test('placeholder filtering is specific to its template section', () => {
  const template = '## Alpha\n- Alpha prompt:\n\n## Beta\n- Beta prompt:\n';
  expectProblems('## Alpha\n- Beta prompt:\n\n## Beta\n記入済み\n', [], template);
});

test('headings are derived from the supplied template, not Japanese constants', () => {
  const template = '## Alpha\n<!-- prompt -->\n-\n\n## Beta\n- detail:\n';
  expectProblems('## Beta\n回答\n\n## Alpha\n回答\n', [], template);
  expectProblems('## Alpha\n回答\n', [{ heading: 'Beta', reason: 'missing' }], template);
});

test('a heading present only in a fenced block is missing', () => {
  const omitted = headings[0];
  const body = `\`\`\`markdown\n${section(omitted)}\`\`\`\n` + headings.slice(1).map(heading => section(heading)).join('\n');
  expectProblems(body, [{ heading: omitted, reason: 'missing' }]);
});

test('a fenced duplicate does not replace a real heading', () => {
  expectProblems(`\`\`\`\n## 確認\nコード内の例\n\`\`\`\n${fullBody()}`, []);
});

test('extra characters on a required heading line do not match', () => {
  const body = fullBody().replace('## 確認\n', '## 確認（補足）\n');
  expectProblems(body, [{ heading: '確認', reason: 'missing' }]);
});

test('the next level-two heading ends the preceding section even if not required', () => {
  const body = fullBody(new Map([[headings[0], `<!-- 空 -->\n## 補足\n後の節の内容`]]));
  expectProblems(body, [{ heading: headings[0], reason: 'empty' }]);
});

test('multiple independent problems are reported once each', () => {
  const body = headings.filter(heading => heading !== headings[0])
    .map(heading => section(heading, heading === headings[1] ? '-' : '内容')).join('\n');
  expectProblems(body, [{ heading: headings[0], reason: 'missing' }, { heading: headings[1], reason: 'empty' }]);
});

test('CLI accepts a filled event body when run from a different directory', () => {
  const result = runCli({ pull_request: { body: fullBody() } });
  assert.equal(result.status, 0, result.stderr);
});

test('CLI rejects a missing heading and names it on standard error', () => {
  const omitted = headings[1];
  const body = headings.filter(heading => heading !== omitted).map(heading => section(heading)).join('\n');
  const result = runCli({ pull_request: { body } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(omitted));
});

test('CLI rejects an empty section and names it on standard error', () => {
  const result = runCli({ pull_request: { body: fullBody(new Map([['確認', '<!-- 空 -->\n- 試験:\n- CI:']])) } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /確認/);
});

test('CLI reports every empty template section exactly once', () => {
  const result = runCli({ pull_request: { body: templateText } });
  assert.equal(result.status, 1);
  const lines = result.stderr.trim().split(/\r?\n/);
  for (const heading of headings) assert.equal(lines.filter(line => line.includes(heading)).length, 1, result.stderr);
});

test('CLI treats null as an empty body', () => {
  const result = runCli({ pull_request: { body: null } });
  assert.equal(result.status, 1);
  for (const heading of headings) assert.ok(result.stderr.includes(heading), result.stderr);
});

test('CLI rejects malformed event JSON', () => {
  const result = runCli(null, { rawJson: '{invalid' });
  assert.notEqual(result.status, 0);
});

test('CLI rejects an unreadable event path', () => {
  const result = runCli(null, { missingFile: true });
  assert.notEqual(result.status, 0);
});

test('CRLF body with every required section filled passes', () => {
  expectProblems(fullBody().replaceAll('\n', '\r\n'), []);
});

test('CRLF untouched template body still has every section empty', () => {
  expectProblems(templateText.replaceAll('\n', '\r\n'),
    headings.map(heading => ({ heading, reason: 'empty' })));
});
