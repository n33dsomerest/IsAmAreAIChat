'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { cn } from '@/lib/utils';

/**
 * Renders a model's answer as Markdown.
 *
 * The transcript used to print the raw text, which left every answer that
 * leaned on structure — GFM tables above all — as pipe characters on screen.
 *
 * Raw HTML is deliberately not enabled (no `rehype-raw`): model output is
 * untrusted, and letting it through would put script tags on the page. Link
 * text is safe to render, so links get hardened attributes instead.
 */
const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,

  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-lg font-semibold first:mt-0 last:mb-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0 last:mb-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0 last:mb-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0 last:mb-0">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-muted-foreground mt-3 mb-1 text-xs font-medium tracking-wide uppercase first:mt-0 last:mb-0">
      {children}
    </h6>
  ),

  ul: ({ children, className }) => (
    <ul
      className={cn(
        'my-2 list-disc space-y-1 pl-5',
        // A GFM task list ships its own markers; a second one doubles them up.
        className?.includes('contains-task-list') && 'list-none pl-1',
        className,
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  // GFM task lists arrive as disabled checkboxes; the checked state is the only
  // thing that matters, and it must not be interactive.
  input: ({ checked, ...props }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      disabled
      className="accent-foreground mr-1.5 size-3.5 align-middle"
    />
  ),

  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="underline underline-offset-2 decoration-muted-foreground/50 hover:decoration-foreground"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,

  blockquote: ({ children }) => (
    <blockquote className="text-muted-foreground my-3 border-l-2 border-border pl-3">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,

  code: ({ children, className }) => {
    const text = String(children).replace(/\n$/, '');
    const isBlock = text.includes('\n') || !!className;
    if (!isBlock) {
      return <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
    }
    return (
      <code className={`font-mono ${className ?? ''}`} data-language={className?.replace(/^language-/, '') ?? undefined}>
        {text}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-muted/60 my-3 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed">
      {children}
    </pre>
  ),

  // The transcript column is narrow and GFM tables refuse to wrap, so the table
  // scrolls inside its own box instead of tearing the layout apart.
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/60 text-left [&_tr]:border-b [&_tr]:border-border">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="[&_tr:last-child]:border-0">{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top">{children}</td>,

  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ''} className="my-2 max-w-full rounded-lg border" loading="lazy" />
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('text-sm leading-relaxed break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}