import type { ReactNode } from "react"

// Underscores only emphasise at word edges in any script, so identifiers like order_id stay literal.
const inline = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|(?<![\p{L}\p{M}\p{N}_])_[^_]+_(?![\p{L}\p{M}\p{N}_]))/gu

function renderInline(text: string): ReactNode[] {
  return text.split(inline).map((part, i) => {
    if (i % 2 === 0) return part
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
      return (
        <code key={i} className="rounded-sm bg-slate px-1 font-mono text-[0.85em] text-ink">
          {part.slice(1, -1)}
        </code>
      )
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3)
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    if (/^([*_]).+\1$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

/** Pack docs: paragraphs split on blank lines, with inline code, emphasis and strong. Nothing else. */
export function Markdown({ text, className }: { readonly text: string; readonly className?: string }) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim() !== "")
  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={i} className="mb-2 last:mb-0">
          {renderInline(p)}
        </p>
      ))}
    </div>
  )
}
