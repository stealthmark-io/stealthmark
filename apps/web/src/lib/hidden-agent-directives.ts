/** Phrases that address an AI agent rather than a human reader. */
const AGENT_DIRECTIVES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: '"ignore previous instructions"',
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions|prompts|directions|rules)\b/i,
  },
  { label: '"do not tell the user"', pattern: /\b(?:do\s+not|don't|never)\s+(?:tell|reveal|mention|disclose)\b[^.]{0,60}?\bthe\s+user\b/i },
  { label: '"you are an AI"', pattern: /\b(?:if\s+)?you\s+are\s+an?\s+(?:ai|llm|language\s+model|assistant|ai\s+agent)\b/i },
  { label: '"new instructions:"', pattern: /\bnew\s+instructions\s*:/i },
  { label: '"system prompt:"', pattern: /\bsystem\s+prompt\s*:/i },
];

const HIDING_ATTRIBUTE =
  /(?:^|\s)hidden(?=[\s=/]|$)|\baria-hidden\s*=\s*["']?true|\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d]))/i;

/** Longest attribute run handed to a regex, so one crafted tag cannot make the attribute regexes slow. */
const MAX_ATTRIBUTES = 2048;
const MAX_ELEMENT_TEXT = 2000;
const META_CONTENT = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * Text a browser does not show but an agent reading the HTML does, with where it came from.
 * One forward pass with indexOf: the page is attacker-controlled, so no regex runs over the whole document.
 */
function hiddenTexts(html: string): Array<{ where: string; text: string }> {
  const lower = html.toLowerCase();
  const comments: Array<{ where: string; text: string }> = [];
  const metas: Array<{ where: string; text: string }> = [];
  const jsonLd: Array<{ where: string; text: string }> = [];
  const elements: Array<{ where: string; text: string }> = [];
  let pos = 0;
  while (pos < html.length) {
    const open = html.indexOf('<', pos);
    if (open === -1) break;
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      if (close === -1) break;
      comments.push({ where: 'an HTML comment', text: html.slice(open + 4, close) });
      pos = close + 3;
      continue;
    }
    const name = /^[a-z][a-z0-9]*/.exec(lower.slice(open + 1, open + 33))?.[0];
    if (!name) {
      pos = open + 1;
      continue;
    }
    const gt = html.indexOf('>', open + 1 + name.length);
    if (gt === -1) break;
    const attributes = html.slice(open + 1 + name.length, Math.min(gt, open + 1 + name.length + MAX_ATTRIBUTES));
    pos = gt + 1;
    if (name === 'meta') {
      const m = META_CONTENT.exec(attributes);
      if (m) metas.push({ where: 'a meta tag', text: m[1] ?? m[2] ?? '' });
    }
    if (name === 'script' && attributes.toLowerCase().includes('application/ld+json')) {
      const end = lower.indexOf('</script', pos);
      if (end === -1) break;
      jsonLd.push({ where: 'a JSON-LD block', text: html.slice(pos, end) });
      pos = end;
      continue;
    }
    const next = html.indexOf('<', pos);
    const text = html.slice(pos, Math.min(next === -1 ? html.length : next, pos + MAX_ELEMENT_TEXT));
    if (text.length > 0 && HIDING_ATTRIBUTE.test(attributes)) elements.push({ where: 'a hidden element', text });
  }
  return [...comments, ...metas, ...jsonLd, ...elements];
}

/**
 * The first hidden context on a page whose text addresses an AI agent, described without echoing the page's text.
 * Returns null when no hidden context does.
 */
export function findHiddenAgentDirective(html: string): string | null {
  for (const { where, text } of hiddenTexts(html)) {
    const hit = AGENT_DIRECTIVES.find(({ pattern }) => pattern.test(text));
    if (hit) return `${where} contains text that addresses AI agents (${hit.label} pattern)`;
  }
  return null;
}
