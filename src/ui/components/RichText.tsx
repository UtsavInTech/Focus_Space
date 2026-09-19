/** Plain text with paragraphs, **bold**, `code` and ``` blocks. Never HTML. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/```[\w-]*\n?([\s\S]*?)```/g);
  const inline = (line: string, key: string) =>
    line.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((chunk, i) =>
      chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4 ? (
        <strong key={`${key}-${i}`}>{chunk.slice(2, -2)}</strong>
      ) : chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2 ? (
        <code key={`${key}-${i}`}>{chunk.slice(1, -1)}</code>
      ) : (
        chunk
      ),
    );
  return (
    <div className="fs-answer-text">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i}>
            <code>{part.trimEnd()}</code>
          </pre>
        ) : (
          part
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((p, j) => <p key={`${i}-${j}`}>{inline(p.trim().replace(/^#{1,4}\s+/gm, ''), `${i}-${j}`)}</p>)
        ),
      )}
    </div>
  );
}
