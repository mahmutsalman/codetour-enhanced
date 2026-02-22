/**
 * Converts between Markdown and Quill Delta format.
 * Handles: bold, italic, code, headers, code blocks, lists, links, blockquotes.
 * Note: Color information is lost when converting Delta -> Markdown (lossy).
 */

interface DeltaOp {
  insert: string | { [key: string]: any };
  attributes?: { [key: string]: any };
}

interface Delta {
  ops: DeltaOp[];
}

/**
 * Converts a Markdown string to a Quill Delta object for editing.
 */
export function markdownToDelta(md: string): Delta {
  const ops: DeltaOp[] = [];
  const lines = md.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block (fenced)
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      ops.push({ insert: codeLines.join("\n") });
      ops.push({ insert: "\n", attributes: { "code-block": true } });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const text = line.slice(2);
      pushInlineOps(ops, text);
      ops.push({ insert: "\n", attributes: { blockquote: true } });
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      pushInlineOps(ops, headerMatch[2]);
      ops.push({ insert: "\n", attributes: { header: level } });
      continue;
    }

    // Unordered list
    if (line.match(/^[\-\*]\s+/)) {
      const text = line.replace(/^[\-\*]\s+/, "");
      pushInlineOps(ops, text);
      ops.push({ insert: "\n", attributes: { list: "bullet" } });
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      pushInlineOps(ops, olMatch[1]);
      ops.push({ insert: "\n", attributes: { list: "ordered" } });
      continue;
    }

    // Regular line with inline formatting
    pushInlineOps(ops, line);
    ops.push({ insert: "\n" });
  }

  // Ensure trailing newline
  if (ops.length === 0 || (ops[ops.length - 1].insert as string) !== "\n") {
    ops.push({ insert: "\n" });
  }

  return { ops };
}

/**
 * Parses inline markdown formatting and pushes Delta ops.
 */
function pushInlineOps(ops: DeltaOp[], text: string): void {
  if (!text) return;

  // Pattern: bold+italic, bold, italic, inline code, links, strikethrough
  const inlinePattern =
    /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)|~~(.+?)~~)/g;

  let lastIndex = 0;
  let match;

  while ((match = inlinePattern.exec(text)) !== null) {
    // Push plain text before this match
    if (match.index > lastIndex) {
      ops.push({ insert: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // Bold + italic
      ops.push({ insert: match[2], attributes: { bold: true, italic: true } });
    } else if (match[3]) {
      // Bold
      ops.push({ insert: match[3], attributes: { bold: true } });
    } else if (match[4]) {
      // Italic
      ops.push({ insert: match[4], attributes: { italic: true } });
    } else if (match[5]) {
      // Inline code
      ops.push({ insert: match[5], attributes: { code: true } });
    } else if (match[6] && match[7]) {
      // Link
      ops.push({ insert: match[6], attributes: { link: match[7] } });
    } else if (match[8]) {
      // Strikethrough
      ops.push({ insert: match[8], attributes: { strike: true } });
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining plain text
  if (lastIndex < text.length) {
    ops.push({ insert: text.slice(lastIndex) });
  }
}

/**
 * Converts a Quill Delta object back to Markdown.
 * Note: This is lossy - color/background-color info is dropped.
 */
export function deltaToMarkdown(delta: Delta): string {
  if (!delta || !delta.ops) return "";

  const lines: string[] = [];
  let currentLine = "";

  for (const op of delta.ops) {
    if (typeof op.insert === "string") {
      const parts = op.insert.split("\n");

      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          // Newline encountered - push current line with attributes from the newline op
          // But the attributes for the newline come from this op itself
          if (i === parts.length - 1 && op.attributes) {
            lines.push(formatLineWithAttributes(currentLine, op.attributes));
          } else {
            lines.push(currentLine);
          }
          currentLine = "";
        }

        currentLine += formatInlineText(parts[i], i === 0 ? op.attributes : undefined);
      }
    }
  }

  // Push any remaining content
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatInlineText(text: string, attributes?: { [key: string]: any }): string {
  if (!text || !attributes) return text;

  let result = text;

  if (attributes.code) {
    result = `\`${result}\``;
  }
  if (attributes.bold && attributes.italic) {
    result = `***${result}***`;
  } else if (attributes.bold) {
    result = `**${result}**`;
  } else if (attributes.italic) {
    result = `*${result}*`;
  }
  if (attributes.strike) {
    result = `~~${result}~~`;
  }
  if (attributes.link) {
    result = `[${result}](${attributes.link})`;
  }

  return result;
}

function formatLineWithAttributes(line: string, attributes: { [key: string]: any }): string {
  if (attributes.header) {
    const prefix = "#".repeat(attributes.header);
    return `${prefix} ${line}`;
  }
  if (attributes.blockquote) {
    return `> ${line}`;
  }
  if (attributes.list === "bullet") {
    return `- ${line}`;
  }
  if (attributes.list === "ordered") {
    return `1. ${line}`;
  }
  if (attributes["code-block"]) {
    return "```\n" + line + "\n```";
  }

  return line;
}
