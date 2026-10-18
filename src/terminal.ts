const ANSI = /\x1b\[[\d;]*m/g;
export const visible = (text: string) => text.replace(ANSI, "");

export function cells(text: string): number {
  return [...visible(text)].reduce((n, c) => n + (/\p{Mark}/u.test(c) ? 0 : /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(c) ? 2 : 1), 0);
}

// Leave one cell for the report's left gutter.
export const width = () => Math.max(16, Math.min(process.stdout.columns || Number(process.env.COLUMNS) || 100, 100) - 1);

export const paint = (code: string) => (text: string): string => {
  const color = !process.env.NO_COLOR && process.env.FORCE_COLOR !== "0" && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
  return color ? `\x1b[${code}m${text.replaceAll("\x1b[0m", `\x1b[0m\x1b[${code}m`)}\x1b[0m` : text;
};
export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const red = paint("31");
export const yellow = paint("33");
export const cyan = paint("36");
export const magenta = paint("35");
export const orange = paint("38;5;208");

export const pad = (text: string, size: number, right = false) => {
  const spaces = " ".repeat(Math.max(0, size - cells(text)));
  return right ? spaces + text : text + spaces;
};

/** Wrap styled text without counting SGR codes or splitting long identifiers off screen. */
export function wrap(text: string, indent = 0, first = " ".repeat(indent), columns = width()): string {
  const lines: string[] = [];
  let line = first;
  let start = cells(first);
  let spaces = "";
  const flush = () => { lines.push(line); line = " ".repeat(indent); start = indent; };
  // Keep month and day together when space permits.
  for (const word of text.replace(/\b([A-Z][a-z]{2}) (\d)/g, "$1 $2").match(/ +|[^ ]+/g) ?? []) {
    if (word.startsWith(" ")) { spaces += word; continue; }
    if (cells(line) > start && cells(line) + spaces.length + cells(word) > columns) {
      flush();
      spaces = "";
    }
    line += spaces;
    spaces = "";
    for (const part of word.match(/\x1b\[[\d;]*m|[^\x1b]/gu) ?? []) {
      if (cells(part) && cells(line) + cells(part) > columns) flush();
      line += part;
    }
  }
  lines.push(line);
  return lines.join("\n").replaceAll(" ", " ");
}

export const gutter = (text: string) => text.split("\n").map((line) => line ? ` ${line}` : "").join("\n");

export const tableLabelWidth = () => Math.max(12, Math.min(28, width() - 32));

export function tableHeader(label = ""): string {
  return `${pad(bold(label), tableLabelWidth() + 2)}${dim(pad("before", 10, true))}${dim(pad("after", 10, true))}`;
}

export function numbers(text: string): string {
  return text.replace(/<?\b\d[\d,]*(?:\.\d+)?(?:%|k\b|\s+units\b|\s+tokens\b)?/g, bold);
}
