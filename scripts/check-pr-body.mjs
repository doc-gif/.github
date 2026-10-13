// node scripts/check-pr-body.mjs: checks that a pull_request event's body fills every `## ` heading of
// pull_request_template.md (doc-gif/.github issue 2). Reads only GITHUB_EVENT_PATH; no network, no token.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEMPLATE_URL = new URL('../pull_request_template.md', import.meta.url);

function lines(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
}

// Sections keyed by exact heading text, outside fenced code blocks. Content runs to the next `## ` line.
function sections(text) {
  const result = new Map();
  let current = null;
  let fence = null;
  for (const line of lines(text)) {
    const trimmed = line.trim();
    const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fence) {
      // A closing fence is only the fence characters (CommonMark): ```js inside a block does not close it.
      const closing = /^(`{3,}|~{3,})\s*$/.exec(trimmed)?.[1];
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = null;
      if (current) current.push(line);
      continue;
    }
    if (marker) {
      fence = marker;
      if (current) current.push(line);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      const heading = trimmed.slice(3).trim();
      current = [];
      if (!result.has(heading)) result.set(heading, current);
      continue;
    }
    if (current) current.push(line);
  }
  return result;
}

export function checkBody(body, templateText) {
  const template = sections(templateText);
  const filled = sections(body ?? '');
  const problems = [];
  for (const [heading, templateLines] of template) {
    const content = filled.get(heading);
    if (content === undefined) {
      problems.push({ heading, reason: 'missing' });
      continue;
    }
    const placeholders = new Set(templateLines.map(line => line.trim()).filter(Boolean));
    const rest = content.map(line => line.trim()).filter(line => line && !placeholders.has(line));
    if (rest.length === 0) problems.push({ heading, reason: 'empty' });
  }
  return { ok: problems.length === 0, problems };
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const body = event?.pull_request?.body;
  if (body !== null && typeof body !== 'string') throw new Error('the event has no pull_request.body');
  const { ok, problems } = checkBody(body, readFileSync(TEMPLATE_URL, 'utf8'));
  for (const { heading, reason } of problems) {
    console.error(reason === 'missing' ? `missing heading: ## ${heading}` : `empty heading: ## ${heading}`);
  }
  return ok ? 0 : 1;
}

// Compare real paths: import.meta.url is resolved through symlinks (macOS /var), argv[1] is not.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
