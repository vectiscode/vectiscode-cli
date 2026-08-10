export interface TableRepair {
  header: RegExp;
  columns: string[];
  plainRowStart?: RegExp;
  parsePlainCell: (line: string, rowCells: string[]) => string[];
}

export const tableRepairs: TableRepair[] = [
  {
    header: /^Path\s+Class\s+Notes\s*$/i,
    columns: ["Path", "Class", "Notes"],
    plainRowStart: /^[A-Za-z][\w.-]*(?:\/[A-Za-z0-9_. -]+)+$/,
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^Field\s+Type\s+Default\s+Purpose\s*$/i,
    columns: ["Field", "Type", "Default", "Purpose"],
    parsePlainCell(line: string, rowCells: string[]) {
      if (rowCells.length === 0) {
        const match = line.match(/^([A-Za-z][\w-]*)\s+(number|boolean|string)\s*(.*)$/i);
        if (match) return [match[1], match[2], ...(match[3].trim() ? [match[3].trim()] : [])];
      }
      return [line];
    }
  },
  {
    header: /^Field\s+Start\s+Purpose\s*$/i,
    columns: ["Field", "Start", "Purpose"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^Object\s+Position\s+Description\s*$/i,
    columns: ["Object", "Position", "Description"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^Area\s+Current state\s+Priority\s*$/i,
    columns: ["Area", "Current state", "Priority"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^Priority\s+Area\s+Problem\s+Action\s*$/i,
    columns: ["Priority", "Area", "Problem", "Action"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^\|\s*Priority\s*\|\s*Area\s*\|\s*Problem\s*\|\s*Action\s*\|?\s*$/i,
    columns: ["Priority", "Area", "Problem", "Action"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^Priority\s+Area\s+Issue\s+Recommended\s+Action\s*$/i,
    columns: ["Priority", "Area", "Issue", "Recommended Action"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^\|\s*Priority\s*\|\s*Area\s*\|\s*Issue\s*\|\s*Recommended\s*Action\s*\|?\s*$/i,
    columns: ["Priority", "Area", "Issue", "Recommended Action"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^Priority\s+Area\s+Issue\s+Action\s*$/i,
    columns: ["Priority", "Area", "Issue", "Action"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^\|\s*Priority\s*\|\s*Area\s*\|\s*Issue\s*\|\s*Action\s*\|?\s*$/i,
    columns: ["Priority", "Area", "Issue", "Action"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^Priority\s+Area\s+Problem\s+Recommended\s+Action\s*$/i,
    columns: ["Priority", "Area", "Problem", "Recommended Action"],
    parsePlainCell(line: string) {
      return [line];
    }
  },
  {
    header: /^\|\s*Priority\s*\|\s*Area\s*\|\s*Problem\s*\|\s*Recommended\s*Action\s*\|?\s*$/i,
    columns: ["Priority", "Area", "Problem", "Recommended Action"],
    parsePlainCell(line: string) {
      return [line];
    }
  }
];

export const splitTableFragments = (
  line: string,
  parsePlainCell: (line: string, rowCells: string[]) => string[],
  rowCells: string[]
) => {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (trimmed.includes("|")) {
    return trimmed.split("|").map((cell) => cell.trim()).filter(Boolean);
  }
  if (trimmed.includes("\t")) {
    return trimmed.split(/\t+/).map((cell) => cell.trim()).filter(Boolean);
  }
  return parsePlainCell(trimmed, rowCells);
};

export const normalizeMalformedMarkdownTables = (content: string) => {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const stripped = line.trim().replace(/\|/g, " ").replace(/\s+/g, " ").trim();
    const repair = tableRepairs.find((candidate) => candidate.header.test(line.trim()) || candidate.header.test(stripped));
    if (!repair) {
      output.push(line);
      continue;
    }

    const rows: string[][] = [];
    let rowCells: string[] = [];
    let cursor = i + 1;
    for (; cursor < lines.length; cursor += 1) {
      const rawCandidate = lines[cursor];
      const candidate = rawCandidate.trim();
      if (!candidate) {
        if (rowCells.length === 0 || rows.length > 0) continue;
        break;
      }

      const atSectionBreak = /^#{1,6}\s/.test(candidate) || /^[-*]\s/.test(candidate) || /:\s*(?:-|$)/.test(candidate) || /^[A-Z][\w\s]+:$/.test(candidate);
      if (atSectionBreak) {
        break;
      }

      const plainRowStart = repair.plainRowStart;
      const startsPlainRow = plainRowStart instanceof RegExp && plainRowStart.test(candidate);
      if (rows.length > 0 && rowCells.length === 0 && !candidate.includes("|") && (plainRowStart && !startsPlainRow)) {
        break;
      }

      const fragments = splitTableFragments(rawCandidate, repair.parsePlainCell, rowCells);
      if (fragments.length === 0) continue;
      rowCells.push(...fragments);
      while (rowCells.length >= repair.columns.length) {
        rows.push(rowCells.slice(0, repair.columns.length));
        rowCells = rowCells.slice(repair.columns.length);
      }
    }

    if (rows.length === 0) {
      output.push(line);
      continue;
    }

    output.push(`| ${repair.columns.join(" | ")} |`);
    output.push(`| ${repair.columns.map(() => "---").join(" | ")} |`);
    rows.forEach((row) => output.push(`| ${row.join(" | ")} |`));
    output.push("");
    i = cursor - 1;
  }

  return output.join("\n");
};

export const stripHiddenThinkingBlocks = (content: string) => (
  content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
);

export const extractThinkingContent = (content: string): string | null => {
  if (!content) return null;
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  const raw = thinkMatch?.[1] || thinkingMatch?.[1];
  if (!raw) return null;
  let cleaned = raw.replace(/^\n+|\n+$/g, "").trim();
  // Strip corny reasoning headers from the beginning of the thinking block
  cleaned = cleaned.replace(/^(?:#{1,6}\s+|\*\*|)?(?:High-Level\s+)?(?:Reasoning|Thinking)\s+(?:Summary|Process)(?:\*\*|)?(?:\s*[-:]\s*|\s*\n+|$)/i, "");
  cleaned = cleaned.replace(/^\n+|\n+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
};

export interface ParsedStreamContent {
  thinking: string | null;
  contentBefore: string;
  contentAfter: string;
}

export const parseStreamingContent = (text: string): ParsedStreamContent => {
  if (!text) return { thinking: null, contentBefore: "", contentAfter: "" };

  const thinkStartMatch = text.match(/<(think|thinking)>/i);
  if (!thinkStartMatch) {
    return { thinking: null, contentBefore: text, contentAfter: "" };
  }

  const startIdx = thinkStartMatch.index!;
  const tagLength = thinkStartMatch[0].length;
  const tagName = thinkStartMatch[1];
  const endTag = `</${tagName}>`;

  const endTagMatch = text.match(new RegExp(`</${tagName}>`, "i"));

  if (endTagMatch) {
    const endIdx = endTagMatch.index!;
    const thinking = text.slice(startIdx + tagLength, endIdx);
    const contentBefore = text.slice(0, startIdx);
    const contentAfter = text.slice(endIdx + endTag.length);
    
    // Clean corny reasoning headers from the thinking block
    let cleanedThinking = thinking.trim();
    cleanedThinking = cleanedThinking.replace(/^(?:#{1,6}\s+|\*\*|)?(?:High-Level\s+)?(?:Reasoning|Thinking)\s+(?:Summary|Process)(?:\*\*|)?(?:\s*[-:]\s*|\s*\n+|$)/i, "");
    cleanedThinking = cleanedThinking.trim();

    return {
      thinking: cleanedThinking.length > 0 ? cleanedThinking : null,
      contentBefore,
      contentAfter
    };
  } else {
    const thinking = text.slice(startIdx + tagLength);
    const contentBefore = text.slice(0, startIdx);
    
    // Clean corny reasoning headers from the thinking block
    let cleanedThinking = thinking.trim();
    cleanedThinking = cleanedThinking.replace(/^(?:#{1,6}\s+|\*\*|)?(?:High-Level\s+)?(?:Reasoning|Thinking)\s+(?:Summary|Process)(?:\*\*|)?(?:\s*[-:]\s*|\s*\n+|$)/i, "");
    cleanedThinking = cleanedThinking.trim();

    return {
      thinking: cleanedThinking.length > 0 ? cleanedThinking : null,
      contentBefore,
      contentAfter: ""
    };
  }
};

export const cleanMessageContent = (content: string) => {
  if (!content) return "";
  let cleaned = stripHiddenThinkingBlocks(content);
  cleaned = cleaned.replace(/\n\nRouting note: this request was optimized to [\s\S]*?because the task looked routine\./g, "");
  cleaned = cleaned.replace(/\n\n\[MODEL_RECOMMENDATION:.*?\][\s\S]*?$/, "");
  cleaned = normalizeMalformedMarkdownTables(cleaned);
  cleaned = cleaned.replace(/(\|[^\n|]+(?:\|[^\n|]+)+\|?)\s+(\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?)\s+((?:\|\s*[^|\n]+(?:\|\s*[^|\n]+)+\|?\s*)+)/g, (_match, header, separator, rows) => {
    const cols = header.split("|").map((c: string) => c.trim()).filter(Boolean);
    const colsCount = cols.length;
    if (colsCount === 0) {
      return `${String(header).trim()}\n${String(separator).trim()}\n${String(rows).trim()}`;
    }

    // Split rows into individual lines
    const rowLines = String(rows).split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);

    // Check if every row already has the correct number of cells - if so, pass through unchanged
    const rowCellCounts = rowLines.map((line: string) => {
      const cells = line.split("|").map((c: string) => c.trim());
      if (cells.length > 0 && cells[0] === "") cells.shift();
      if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      return cells.length;
    });
    const allRowsValid = rowCellCounts.every((count: number) => count === colsCount);
    if (allRowsValid) {
      return `${String(header).trim()}\n${String(separator).trim()}\n${rowLines.join("\n")}`;
    }

    // Only re-chunk if rows have inconsistent cell counts (malformed table)
    const allParts: string[] = [];
    for (const rowLine of rowLines) {
      const cells = rowLine.split("|").map((c: string) => c.trim());
      if (cells.length > 0 && cells[0] === "") cells.shift();
      if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      allParts.push(...cells);
    }

    const chunkedRows: string[] = [];
    for (let i = 0; i < allParts.length; i += colsCount) {
      const chunk = allParts.slice(i, i + colsCount);
      while (chunk.length < colsCount) {
        chunk.push("");
      }
      chunkedRows.push(`| ${chunk.join(" | ")} |`);
    }

    return `${String(header).trim()}\n${String(separator).trim()}\n${chunkedRows.join("\n")}`;
  });
  // Ensure blank line between table rows and headings/lists so GFM parser
  // does not swallow the heading as a table continuation row
  cleaned = cleaned.replace(/(\|[^\n]*\|)\n(#{1,6}\s)/g, "$1\n\n$2");
  cleaned = cleaned.replace(/(\|[^\n]*\|)\n([-*]\s)/g, "$1\n\n$2");
  return cleaned.trim();
};

export interface ModelRecommendation {
  modelId: string;
  label: string;
  cost: string;
}

export const parseModelRecommendation = (content: string): ModelRecommendation | null => {
  if (!content) return null;
  const match = content.match(/\[MODEL_RECOMMENDATION:(.*?):(.*?):(.*?)\]/);
  if (!match) return null;
  return {
    modelId: match[1] ?? "",
    label: match[2] ?? "",
    cost: match[3] ?? ""
  };
};
