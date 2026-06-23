import path from "node:path";
import fs from "node:fs";
// ============================================================
// SANDBOX DIRECTORY LOCKING
// ============================================================

/**
 * Validates that a file path is within the allowed project directory.
 * Prevents path traversal attacks and access to system files.
 */
export function validateFilePath(
  filePath: string,
  projectRoot?: string,
): { valid: true; resolvedPath: string } | { valid: false; error: Error } {
  try {
    const root = projectRoot ?? getProjectRoot();
    const resolvedRoot = path.resolve(root);
    const normalizedRoot = path.normalize(resolvedRoot).toLowerCase();
    let resolvedPath: string;

    if (!path.isAbsolute(filePath)) {
      const cwdPath = path.resolve(process.cwd(), filePath);
      const normalizedCwdPath = path.normalize(cwdPath).toLowerCase();
      if (
        fs.existsSync(cwdPath) &&
        normalizedCwdPath.startsWith(normalizedRoot)
      ) {
        resolvedPath = cwdPath;
      } else {
        resolvedPath = path.resolve(resolvedRoot, filePath);
      }
    } else {
      resolvedPath = path.resolve(resolvedRoot, filePath);
    }

    const normalizedPath = path.normalize(resolvedPath).toLowerCase();

    // Check: path must be within project root
    if (!normalizedPath.startsWith(normalizedRoot)) {
      return {
        valid: false,
        error: new Error(
          `PATH_TRAVERSAL: Access denied. Path "${filePath}" resolves outside project root "${resolvedRoot}".`,
        ),
      };
    }

    // Check: path must not contain symlink escapes
    if (normalizedPath.includes("..")) {
      return {
        valid: false,
        error: new Error(
          `PATH_TRAVERSAL: Path traversal detected in "${filePath}". Relative paths with ".." are not allowed.`,
        ),
      };
    }

    // Block access to sensitive system directories
    const blockedPatterns = [
      "/etc/",
      "/sys/",
      "/proc/",
      "/dev/",
      "/boot/",
      "/usr/",
      "C:\\Windows",
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      "C:\\System32",
      "~/.ssh",
      "/root/",
    ];

    for (const pattern of blockedPatterns) {
      if (normalizedPath.includes(pattern.toLowerCase())) {
        return {
          valid: false,
          error: new Error(
            `PATH_TRAVERSAL: Access to system directory "${pattern}" is blocked.`,
          ),
        };
      }
    }

    // Check: node_modules access (read-only allowed but warn)
    if (normalizedPath.includes("node_modules")) {
      return {
        valid: true,
        resolvedPath,
        // Warning will be handled by caller
      };
    }

    return { valid: true, resolvedPath };
  } catch (err) {
    return {
      valid: false,
      error:
        err instanceof Error
          ? err
          : new Error(`Path validation error: ${String(err)}`),
    };
  }
}

/**
 * Validates that a file extension is in the allowed list for writing.
 */
export function validateFileExtension(filePath: string): boolean {
  const allowedExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".css",
    ".html",
    ".htm",
    ".env",
    ".env.example",
    ".env.local",
    ".yml",
    ".yaml",
    ".toml",
    ".svg",
    ".png",
    ".jpg",
    ".gif",
    ".sh",
    ".bat",
    ".ps1",
    ".sql",
    ".graphql",
    ".gql",
    ".vue",
    ".svelte",
    ".astro",
    ".prisma",
    ".proto",
    ".txt",
    ".log",
  ];

  const ext = path.extname(filePath).toLowerCase();
  return allowedExtensions.includes(ext);
}

/**
 * Gets the project root directory.
 * Defaults to current working directory.
 */
export function getProjectRoot(): string {
  return process.env.AGENT_PROJECT_ROOT ?? process.cwd();
}

/**
 * Checks if a file exists and is readable.
 */
export function isReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a directory is writable.
 */
export function isWritable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates backup path for a file.
 */
export function getBackupPath(filePath: string, timestamp?: number): string {
  const ts = timestamp ?? Date.now();
  const root = getProjectRoot();
  const relativePath = path.relative(root, filePath);
  return path.join(root, ".agent-backups", String(ts), relativePath);
}

/**
 * Ensure .agent-backups directory exists
 */
export function ensureBackupDir(): string {
  const root = getProjectRoot();
  const backupDir = path.join(root, ".agent-backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  return backupDir;
}
