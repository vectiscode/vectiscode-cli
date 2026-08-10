import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function isInside(root: string, candidate: string): boolean {
  const result = relative(root, candidate);
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}

function closestExistingParent(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function resolveWorkspacePath(cwd: string, requestedPath: string): string {
  const root = realpathSync(resolve(cwd));
  const candidate = resolve(root, requestedPath);
  if (!isInside(root, candidate)) throw new Error(`Path escapes the project root: ${requestedPath}`);

  const existingParent = closestExistingParent(candidate);
  const realParent = realpathSync(existingParent);
  if (!isInside(root, realParent)) throw new Error(`Path crosses a symlink outside the project root: ${requestedPath}`);
  if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
    const target = realpathSync(candidate);
    if (!isInside(root, target)) throw new Error(`Symlink target escapes the project root: ${requestedPath}`);
  }
  return candidate;
}
