export function costScore(value: number): number {
  if (value <= 2.0) return 1;
  if (value <= 3.0) return 1.5;
  if (value <= 4.5) return 2;
  if (value <= 6.0) return 2.5;
  if (value <= 7.5) return 3;
  if (value <= 9.0) return 3.5;
  if (value <= 11.0) return 4;
  if (value <= 14.0) return 4.5;
  return 5;
}

const costColors: Record<number, string> = {
  1: "#22c55e",
  1.5: "#22c55e",
  2: "#22c55e",
  2.5: "#22c55e",
  3: "#eab308",
  3.5: "#eab308",
  4: "#f97316",
  4.5: "#f97316",
  5: "#ef4444",
};

export function costColor(score: number): string {
  return costColors[score] ?? "var(--text-secondary)";
}
