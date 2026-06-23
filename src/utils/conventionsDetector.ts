import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./pathValidator.js";

// ============================================================
// CONVENTIONS DETECTOR — Auto-detect project configuration
// ============================================================

export interface WorkspacePackage {
  path: string;            // relative to project root
  name: string;
  framework: string;
}

export interface ProjectConventions {
  framework: string;
  projectType: "web-app" | "backend" | "cli" | "mcp-server" | "library" | "unknown";
  testRunner: string;
  styling: string;
  importAlias?: string;
  lintRules: string[];
  packageManager: string;
  moduleSystem: "esm" | "cjs";
  language: "typescript" | "javascript";
  features: string[];
  isMonorepo: boolean;
  workspaces: WorkspacePackage[];
}

let cachedConventions: ProjectConventions | null = null;

export async function detectConventions(forceRescan = false): Promise<ProjectConventions> {
  if (cachedConventions && !forceRescan) {
    return cachedConventions;
  }

  const projectRoot = getProjectRoot();
  const workspaces = detectWorkspaces(projectRoot);

  const conventions: ProjectConventions = {
    framework: detectFramework(projectRoot),
    projectType: detectProjectType(projectRoot),
    testRunner: detectTestRunner(projectRoot),
    styling: detectStyling(projectRoot),
    importAlias: detectImportAlias(projectRoot),
    lintRules: detectLintRules(projectRoot),
    packageManager: detectPackageManager(),
    moduleSystem: detectModuleSystem(projectRoot),
    language: detectLanguage(projectRoot),
    features: detectFeatures(projectRoot),
    isMonorepo: workspaces.length > 0,
    workspaces,
  };

  cachedConventions = conventions;
  return conventions;
}

function detectFramework(root: string): string {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (pkg) {
    const pkgDeps = (pkg.dependencies ?? {}) as Record<string, string>;
    const pkgDevDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const deps: Record<string, string> = { ...pkgDeps, ...pkgDevDeps };

    // Web frameworks
    if (deps.next) return "Next.js";
    if (deps["@remix-run/react"]) return "Remix";
    if (deps.gatsby) return "Gatsby";
    if (deps.nuxt || deps["@nuxt/core"]) return "Nuxt.js";
    if (deps.vue) return "Vue";
    if (deps.react) return "React";
    if (deps.svelte) return "Svelte";
    if (deps.astro) return "Astro";
    if (deps.solid || deps["solid-js"]) return "SolidJS";
    if (deps.qwik || deps["@builder.io/qwik"]) return "Qwik";

    // Build tools (frontend)
    if (deps.vite) return "Vite";

    // Backend frameworks
    if (deps["@nestjs/core"]) return "NestJS";
    if (deps.fastify) return "Fastify";
    if (deps.express) return "Express";
    if (deps.koa) return "Koa";
    if (deps.hono) return "Hono";
    if (deps["@hapi/hapi"]) return "Hapi";

    // MCP / agent SDKs
    if (deps["@modelcontextprotocol/sdk"]) return "MCP Server";
    if (deps["@anthropic-ai/claude-agent-sdk"]) return "Claude Agent SDK";

    // CLI frameworks
    if (deps.commander) return "Commander CLI";
    if (deps.yargs) return "Yargs CLI";
    if (deps["@oclif/core"] || deps.oclif) return "Oclif CLI";
    if (deps.ink) return "Ink (React CLI)";

    if (pkg.bin) return "CLI Tool";
    if (pkg.main || pkg.exports) return "Library";
  }

  // Monorepo root fallback: scan sub-projects for framework detection
  const subFrameworks = scanSubProjectFrameworks(root);
  if (subFrameworks.length > 0) {
    // Return the most common framework among sub-projects
    const freq = new Map<string, number>();
    for (const fw of subFrameworks) {
      freq.set(fw, (freq.get(fw) ?? 0) + 1);
    }
    const [topFw] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (topFw) return `${topFw} (monorepo)`;
  }

  return "unknown";
}

/** Scan depth-1 sub-directories for package.json to detect monorepo sub-project frameworks */
function scanSubProjectFrameworks(root: string): string[] {
  const frameworks: string[] = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const subDir = path.join(root, entry.name);
      const subPkg = readJsonSafe(path.join(subDir, "package.json"));
      if (!subPkg) continue;
      const subDeps = { ...(subPkg.dependencies ?? {}), ...(subPkg.devDependencies ?? {}) } as Record<string, string>;
      if (subDeps.next) frameworks.push("Next.js");
      else if (subDeps.react) frameworks.push("React");
      else if (subDeps.vue) frameworks.push("Vue");
      else if (subDeps.svelte) frameworks.push("Svelte");
      else if (subDeps.astro) frameworks.push("Astro");
      else if (subDeps["@nestjs/core"]) frameworks.push("NestJS");
      else if (subDeps.express) frameworks.push("Express");
      else if (subDeps.hono) frameworks.push("Hono");
      else if (subDeps.vite) frameworks.push("Vite");
      else if (subDeps["@modelcontextprotocol/sdk"]) frameworks.push("MCP Server");
    }
  } catch {}
  return frameworks;
}

function detectProjectType(root: string): ProjectConventions["projectType"] {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (pkg) {
    const pkgDeps = (pkg.dependencies ?? {}) as Record<string, string>;
    const pkgDevDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const deps: Record<string, string> = { ...pkgDeps, ...pkgDevDeps };

    if (deps["@modelcontextprotocol/sdk"]) return "mcp-server";

    if (deps.next || deps.react || deps.vue || deps.svelte || deps.astro
        || deps.gatsby || deps.nuxt || deps["@remix-run/react"] || deps.solid) {
      return "web-app";
    }

    if (deps.express || deps.fastify || deps.koa || deps.hono
        || deps["@nestjs/core"] || deps["@hapi/hapi"]) {
      return "backend";
    }

    if (deps.commander || deps.yargs || deps["@oclif/core"] || deps.oclif || deps.ink) {
      return "cli";
    }

    if (pkg.bin) return "cli";
    if (pkg.main || pkg.exports) return "library";
  }

  // Monorepo root fallback: check sub-projects
  const subFrameworks = scanSubProjectFrameworks(root);
  if (subFrameworks.length > 0) return "web-app";

  return "unknown";
}

/**
 * Detects monorepo workspace packages (npm/yarn/pnpm/bun workspaces, Turborepo, Nx).
 * Scans common conventions (apps/*, packages/*, services/*) one level deep.
 */
function detectWorkspaces(root: string): WorkspacePackage[] {
  const results: WorkspacePackage[] = [];
  const pkg = readJsonSafe(path.join(root, "package.json"));
  const pnpmWorkspace = readYamlLite(path.join(root, "pnpm-workspace.yaml"));

  // Collect workspace patterns
  const patterns = new Set<string>();
  const pkgWorkspaces = pkg?.workspaces;
  if (Array.isArray(pkgWorkspaces)) {
    for (const p of pkgWorkspaces) if (typeof p === "string") patterns.add(p);
  } else if (pkgWorkspaces && typeof pkgWorkspaces === "object") {
    const packages = (pkgWorkspaces as Record<string, unknown>).packages;
    if (Array.isArray(packages)) {
      for (const p of packages) if (typeof p === "string") patterns.add(p);
    }
  }
  if (Array.isArray(pnpmWorkspace?.packages)) {
    for (const p of pnpmWorkspace.packages) if (typeof p === "string") patterns.add(p);
  }
  // Convention fallback even without explicit workspaces config
  patterns.add("apps/*");
  patterns.add("packages/*");
  patterns.add("services/*");

  for (const pattern of patterns) {
    // Only handle one-level glob like "apps/*" — keep it simple, no glob lib needed
    const match = pattern.match(/^([^*]+)\/\*$/);
    if (!match) continue;
    const dir = path.join(root, match[1]);
    if (!fs.existsSync(dir)) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const pkgPath = path.join(dir, entry.name, "package.json");
      const subPkg = readJsonSafe(pkgPath);
      if (!subPkg) continue;
      results.push({
        path: path.relative(root, path.join(dir, entry.name)),
        name: (subPkg.name as string) ?? entry.name,
        framework: detectFramework(path.join(dir, entry.name)),
      });
    }
  }

  // Dedup by path
  const seen = new Set<string>();
  return results.filter((w) => {
    if (seen.has(w.path)) return false;
    seen.add(w.path);
    return true;
  });
}

// Minimal YAML reader — supports the only shape we need: "packages:" list of strings.
// ponytail: doesn't need a YAML dep just for one file.
function readYamlLite(filePath: string): { packages?: string[] } | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, "utf-8");
    const packages: string[] = [];
    let inPackages = false;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/#.*$/, "").trimEnd();
      if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
        if (m) packages.push(m[1]);
        else if (/^\S/.test(line)) inPackages = false;
      }
    }
    return { packages };
  } catch {
    return null;
  }
}

function detectTestRunner(root: string): string {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg) return "unknown";

  const pkgDeps2 = (pkg.dependencies ?? {}) as Record<string, string>;
  const pkgDevDeps2 = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...pkgDeps2, ...pkgDevDeps2 };

  if (deps.vitest) return "Vitest";
  if (deps.jest) return "Jest";
  if (deps.mocha) return "Mocha";
  if (deps.ava) return "AVA";
  if (deps.cypress) return "Cypress";
  if (deps.playwright) return "Playwright";
  if (deps["@testing-library/react"]) return "React Testing Library";

  // Check for script patterns
  const scripts: Record<string, string> = (pkg.scripts ?? {}) as Record<string, string>;
  if (scripts.test) {
    if (scripts.test.includes("vitest")) return "Vitest";
    if (scripts.test.includes("jest")) return "Jest";
    if (scripts.test.includes("mocha")) return "Mocha";
  }

  return "unknown";
}

function detectStyling(root: string): string {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg) return "unknown";

  const pkgDeps3 = (pkg.dependencies ?? {}) as Record<string, string>;
  const pkgDevDeps3 = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...pkgDeps3, ...pkgDevDeps3 };

  if (deps.tailwindcss) return "Tailwind CSS";
  if (deps["styled-components"]) return "Styled Components";
  if (deps["@emotion/react"]) return "Emotion";
  if (deps.linaria) return "Linaria";
  if (deps.sass || deps["node-sass"]) return "SCSS";
  if (deps.less) return "Less";
  if (deps["@vanilla-extract/css"]) return "Vanilla Extract";
  if (deps.cssmodules || hasCSSModules(root)) return "CSS Modules";

  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    const cssFiles = findFiles(srcDir, [".css", ".scss", ".less"]);
    if (cssFiles.length > 0) return "Plain CSS/SCSS";
  }

  return "unknown";
}

function detectImportAlias(root: string): string | undefined {
  // Check tsconfig paths
  const tsconfig = readJsonSafe(path.join(root, "tsconfig.json"));
  const tsconfigPaths = (tsconfig as Record<string, unknown>)?.compilerOptions as Record<string, unknown> | undefined;
  if (tsconfigPaths?.paths) {
    const paths = tsconfigPaths.paths as Record<string, string[]>;
    const alias = Object.keys(paths)[0];
    if (alias) return alias.replace("/*", "");
  }

  // Check jsconfig
  const jsconfig = readJsonSafe(path.join(root, "jsconfig.json"));
  const jsconfigPaths = (jsconfig as Record<string, unknown>)?.compilerOptions as Record<string, unknown> | undefined;
  if (jsconfigPaths?.paths) {
    const paths = jsconfigPaths.paths as Record<string, string[]>;
    const alias = Object.keys(paths)[0];
    if (alias) return alias.replace("/*", "");
  }

  return undefined;
}

function detectLintRules(root: string): string[] {
  const rules: string[] = [];

  if (fs.existsSync(path.join(root, ".eslintrc"))) rules.push("ESLint (.eslintrc)");
  if (fs.existsSync(path.join(root, ".eslintrc.js"))) rules.push("ESLint (.eslintrc.js)");
  if (fs.existsSync(path.join(root, ".eslintrc.json"))) rules.push("ESLint (.eslintrc.json)");
  if (fs.existsSync(path.join(root, "eslint.config.js"))) rules.push("ESLint (flat config)");
  if (fs.existsSync(path.join(root, ".prettierrc"))) rules.push("Prettier");
  if (fs.existsSync(path.join(root, ".prettierrc.json"))) rules.push("Prettier");
  if (fs.existsSync(path.join(root, ".prettierrc.js"))) rules.push("Prettier");
  if (fs.existsSync(path.join(root, ".stylelintrc"))) rules.push("StyleLint");
  if (fs.existsSync(path.join(root, ".stylelintrc.json"))) rules.push("StyleLint");

  return rules;
}

function detectPackageManager(): string {
  const root = getProjectRoot();

  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "package-lock.json"))) return "npm";
  if (fs.existsSync(path.join(root, "bun.lockb"))) return "bun";

  return "npm"; // Default
}

function detectModuleSystem(root: string): "esm" | "cjs" {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (pkg?.type === "module") return "esm";

  // Check for import/export syntax in source files
  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    const tsFiles = findFiles(srcDir, [".ts", ".tsx", ".js", ".jsx", ".mjs"]);
    for (const file of tsFiles.slice(0, 20)) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        if (content.includes("import ") || content.includes("export ")) return "esm";
      } catch {
        continue;
      }
    }
  }

  return "cjs";
}

function detectLanguage(root: string): "typescript" | "javascript" {
  if (fs.existsSync(path.join(root, "tsconfig.json"))) return "typescript";

  // Check for .ts files
  const srcDir = path.join(root, "src");
  if (fs.existsSync(srcDir)) {
    const tsFiles = findFiles(srcDir, [".ts", ".tsx"]);
    if (tsFiles.length > 0) return "typescript";
  }

  return "javascript";
}

function detectFeatures(root: string): string[] {
  const features: string[] = [];
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg) return features;

  const pkgDeps4 = (pkg.dependencies ?? {}) as Record<string, string>;
  const pkgDevDeps4 = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...pkgDeps4, ...pkgDevDeps4 };

  if (deps["@prisma/client"] || deps.prisma) features.push("Prisma ORM");
  if (deps.typeorm) features.push("TypeORM");
  if (deps["drizzle-orm"]) features.push("Drizzle ORM");
  if (deps.graphql || deps["@graphql-tools"]) features.push("GraphQL");
  if (deps.trpc || deps["@trpc/client"]) features.push("tRPC");
  if (deps["socket.io"] || deps.ws) features.push("WebSockets");
  if (deps["@reduxjs/toolkit"] || deps.redux) features.push("Redux");
  if (deps.zustand) features.push("Zustand");
  if (deps["react-router"] || deps["react-router-dom"]) features.push("React Router");
  if (deps["next-auth"] || deps["next-auth/react"]) features.push("NextAuth");
  if (deps["@tanstack/react-query"]) features.push("React Query");
  if (deps.jest || deps.vitest) features.push("Unit Testing");
  if (deps.cypress || deps.playwright) features.push("E2E Testing");
  if (deps.storybook || deps["@storybook/react"]) features.push("Storybook");
  if (deps.i18next || deps["react-i18next"]) features.push("i18n");

  return features;
}

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // Ignore
  }
  return null;
}

function hasCSSModules(root: string): boolean {
  const srcDir = path.join(root, "src");
  if (!fs.existsSync(srcDir)) return false;

  const files = findFiles(srcDir, [".module.css", ".module.scss", ".module.less"]);
  return files.length > 0;
}

function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...findFiles(fullPath, extensions));
      } else if (entry.isFile()) {
        if (extensions.some((ext) => entry.name.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore
  }

  return results;
}
