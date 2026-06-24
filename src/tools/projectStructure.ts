import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// PROJECT STRUCTURE — Tree view of project layout
// ============================================================

interface ProjectStructureParams {
  depth?: number;
  folderOnly?: boolean;
  includePattern?: string;
  excludePattern?: string;
}

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".kuma",
  ".agent-backups",
  "dist",
  ".next",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  ".nyc_output",
  "__pycache__",
  ".DS_Store",
  "*.log",
];

// Result cache: keyed by params hash
const treeCache = new Map<string, { result: string; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

export async function handleProjectStructure(params: ProjectStructureParams): Promise<string> {
  const {
    depth = 3,
    folderOnly = false,
    includePattern,
    excludePattern,
  } = params;

  const root = getProjectRoot();
  const clampedDepth = Math.max(1, Math.min(depth, 6));

  // Check cache
  const cacheKey = `${root}:${clampedDepth}:${folderOnly}:${includePattern ?? ""}:${excludePattern ?? ""}`;
  const cached = treeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    sessionMemory.recordToolCall("project_structure", { depth: clampedDepth, folderOnly, cached: true });
    return cached.result;
  }

  sessionMemory.recordToolCall("project_structure", { depth: clampedDepth, folderOnly });

  try {
    const tree = buildTree(root, root, clampedDepth, 0, folderOnly, includePattern, excludePattern);
    const projectName = path.basename(root);
    const lines: string[] = [
      "[Project Structure] - " + projectName,
      "Depth: " + clampedDepth + " | " + (folderOnly ? "Folders only" : "Files and folders"),
      "",
      projectName + "/",
      ...tree,
      "",
      "Increase depth (max 6) for deeper structure.",
      "Use folderOnly: true for high-level overview.",
    ];

    const result = lines.join("\n");
    treeCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (err) {
    return "Error building project structure: " + (err instanceof Error ? err.message : String(err));
  }
}

function buildTree(
  root: string,
  currentDir: string,
  maxDepth: number,
  currentDepth: number,
  folderOnly: boolean,
  includePattern?: string,
  excludePattern?: string,
): string[] {
  if (currentDepth >= maxDepth) return [];

  const lines: string[] = [];
  let entries: fs.Dirent[] = [];

  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return lines;
  }

  // Sort: directories first, then files, alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const relativeDir = path.relative(root, currentDir) || ".";
  const prefix = getPrefix(currentDepth);

  for (const entry of entries) {
    // Skip ignored
    if (shouldIgnore(entry.name, relativeDir, root)) continue;

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(root, fullPath);

    // Apply include/exclude patterns
    if (includePattern && !entry.name.includes(includePattern) && !relativePath.includes(includePattern)) {
      if (!entry.isDirectory()) continue;
    }
    if (excludePattern && (entry.name.includes(excludePattern) || relativePath.includes(excludePattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      lines.push(prefix + "[D] " + entry.name + "/");

      // Check if directory is empty
      let subEntries: fs.Dirent[] = [];
      try {
        subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      } catch {}
      const hasVisibleContent = subEntries.some(
        (e) => !shouldIgnore(e.name, path.relative(root, fullPath), root),
      );

      if (hasVisibleContent) {
        const subLines = buildTree(root, fullPath, maxDepth, currentDepth + 1, folderOnly, includePattern, excludePattern);
        lines.push(...subLines);
      } else {
        // Show empty indicator at max depth
        if (currentDepth + 1 < maxDepth) {
          const childPrefix = getPrefix(currentDepth + 1);
          lines.push(childPrefix + "(empty)");
        }
      }
    } else if (!folderOnly) {
      const size = getFileSize(fullPath);
      lines.push(prefix + "[F] " + entry.name + (size ? " (" + size + ")" : ""));
    }
  }

  return lines;
}

function shouldIgnore(name: string, _relativeDir: string, _root: string): boolean {
  if (name.startsWith(".") && name !== ".env" && name !== ".env.example") return true;
  if (DEFAULT_IGNORE.some((pattern) => {
    if (pattern.startsWith("*")) return name.endsWith(pattern.slice(1));
    return name === pattern;
  })) return true;
  return false;
}

function getPrefix(depth: number): string {
  return "  ".repeat(depth) + "|- ";
}

function getFileSize(fullPath: string): string | null {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size < 1024) return stat.size + "B";
    if (stat.size < 1024 * 1024) return (stat.size / 1024).toFixed(0) + "KB";
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    return sizeMB + "MB";
  } catch {
    return null;
  }
}
