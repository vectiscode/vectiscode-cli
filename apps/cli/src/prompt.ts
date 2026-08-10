import { createInterface } from "node:readline/promises";

export async function promptLine(question: string, defaultValue = ""): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return defaultValue;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = await readline.question(`${question}${suffix}: `);
    return answer.trim() || defaultValue;
  } finally {
    readline.close();
  }
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

export async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Interactive terminal required. Set the provider environment variable for non-interactive use.");
  }
  process.stdout.write(`${label}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string): void => {
      if (chunk === "\u0003") {
        cleanup();
        reject(new Error("Cancelled"));
        return;
      }
      if (chunk === "\r" || chunk === "\n") {
        cleanup();
        resolve(value.trim());
        return;
      }
      if (chunk === "\u007f" || chunk === "\b") {
        if (value) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (/^[\x20-\x7E]+$/.test(chunk)) {
        value += chunk;
        process.stdout.write("*".repeat(chunk.length));
      }
    };
    process.stdin.on("data", onData);
  });
}
