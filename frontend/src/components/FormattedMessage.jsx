import React from "react";

function renderInline(text) {
  if (!text) return null;
  // Match bold **text** or *italic* or `code`
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={i} className="fmt-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return (
        <em key={i} className="fmt-italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code key={i} className="fmt-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function FormattedMessage({ content }) {
  if (!content) return null;

  // Split into block sections by double newlines
  const rawBlocks = content.split(/\n\s*\n/);

  return (
    <div className="formatted-markdown-body">
      {rawBlocks.map((block, bIdx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Headings: ###
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={bIdx} className="fmt-heading fmt-h4">
              {renderInline(trimmed.slice(4))}
            </h4>
          );
        }

        // Headings: ##
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={bIdx} className="fmt-heading fmt-h3">
              {renderInline(trimmed.slice(3))}
            </h3>
          );
        }

        // Check if block consists of list items (lines starting with •, -, *, or 1., 2.)
        const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every((line) =>
          /^(?:[•\-*]|\d+\.)\s+/.test(line)
        );

        if (isList) {
          const isOrdered = /^\d+\.\s+/.test(lines[0]);
          if (isOrdered) {
            return (
              <ol key={bIdx} className="fmt-list fmt-ol">
                {lines.map((line, lIdx) => {
                  const cleaned = line.replace(/^\d+\.\s+/, "");
                  return <li key={lIdx}>{renderInline(cleaned)}</li>;
                })}
              </ol>
            );
          } else {
            return (
              <ul key={bIdx} className="fmt-list fmt-ul">
                {lines.map((line, lIdx) => {
                  const cleaned = line.replace(/^(?:[•\-*])\s+/, "");
                  return <li key={lIdx}>{renderInline(cleaned)}</li>;
                })}
              </ul>
            );
          }
        }

        // Standard Paragraph with single line breaks preserved
        const pLines = trimmed.split("\n");
        return (
          <p key={bIdx} className="fmt-paragraph">
            {pLines.map((line, lIdx) => (
              <React.Fragment key={lIdx}>
                {lIdx > 0 && <br />}
                {renderInline(line)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
