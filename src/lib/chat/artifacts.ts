/**
 * Artifacts are code blocks the model writes out deliberately, rather than
 * anything that merely looks like code in a reply. The fence carries a marker
 * so the UI can tell the two apart:
 *
 *     ```artifact lang=html title="หน้าแรก"
 *     <!doctype html>…
 *     ```
 *
 * Anything in a plain fence stays inline in the message.
 */
const FENCE = /^```artifact(?:\s+lang=([\w+-]+))?(?:\s+title="([^"]{0,120})")?\s*\n([\s\S]*?)^```\s*$/gm;

export type Artifact = {
  id: string;
  title: string | null;
  language: string;
  source: string;
};

let seq = 0;
const nextId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Splits a reply into plain prose and artifacts, in original order.
 *
 * Prose is returned as segments rather than one blob so the renderer can keep
 * the artifacts inline where the model put them.
 */
export function extractArtifacts(text: string): {
  segments: ({ type: 'text'; text: string } | { type: 'artifact'; artifact: Artifact })[];
} {
  const segments: ({ type: 'text'; text: string } | { type: 'artifact'; artifact: Artifact })[] = [];
  let cursor = 0;

  FENCE.lastIndex = 0;
  for (let match = FENCE.exec(text); match; match = FENCE.exec(text)) {
    const before = text.slice(cursor, match.index);
    if (before.trim()) segments.push({ type: 'text', text: before });

    segments.push({
      type: 'artifact',
      artifact: {
        id: nextId(),
        title: match[2] ?? null,
        language: (match[1] ?? 'text').toLowerCase(),
        source: match[3].trimEnd(),
      },
    });

    cursor = match.index + match[0].length;
  }

  const tail = text.slice(cursor);
  if (tail.trim()) segments.push({ type: 'text', text: tail });

  return { segments };
}

/**
 * Tells the model how to produce one.
 *
 * This used to be a tool. A tool costs a full round trip: the model stops,
 * emits a call, the server runs it, sends the result back, and the model picks
 * up where it left off. Two artifacts meant two of those, and a turn that used
 * one ran past two minutes — long enough to be cut off mid-sentence by the
 * function timeout. Writing a fenced block costs nothing: the text is already
 * streaming, and the fence is pulled out of it afterwards.
 *
 * The cost of losing the tool is that the model now chooses the fence rather
 * than deciding to open a panel, so there is no "render this separately" step
 * beyond the fence itself. That is the whole mechanism, and it is one regex.
 */
export const ARTIFACT_INSTRUCTIONS = `You can produce a standalone artifact — a rendered HTML page, an SVG chart, a diagram in mermaid, or a document — by writing it inside a fence marked with the word "artifact":

\`\`\`artifact lang=html title="optional title"
<!doctype html>…
\`\`\`

Rules:
- \`lang\` is one of html, svg, mermaid, markdown, md. \`title\` is optional, in double quotes.
- Put the complete artifact inside the fence — nothing may be left outside it.
- Use this only for content that should be rendered rather than read as prose. Ordinary answers and short code samples stay as plain text in normal code fences.
- Everything before and after the fence is shown to the user as ordinary prose.`;

/** Safe to render types. Anything else is shown as source, never executed. */
export const RENDERABLE = new Set(['html', 'svg', 'mermaid', 'markdown', 'md']);

export function isRenderable(language: string): boolean {
  return RENDERABLE.has(language.toLowerCase());
}