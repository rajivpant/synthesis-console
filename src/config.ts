import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import yaml from "js-yaml";

export interface Source {
  name: string;
  display_name?: string;
  root: string;
  projects_dir?: string;
  lessons_dir?: string;
  plans_dir?: string;
  notes_dir?: string;
  default_active?: boolean;
  demo?: boolean;
}

export interface ConsoleConfig {
  sources: Source[];
  port: number;
  demoMode: boolean;
}

const CONFIG_PATH = join(homedir(), ".synthesis", "console.yaml");
const DEFAULT_PORT = 5555;
const BUILTIN_DEMO_NAME = "demo";

function expandTilde(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function hasProjectsIndex(p: string): boolean {
  return existsSync(join(p, "index.yaml"));
}

function detectContentDirs(root: string): Pick<Source, "projects_dir" | "lessons_dir" | "plans_dir" | "notes_dir"> {
  const out: Pick<Source, "projects_dir" | "lessons_dir" | "plans_dir" | "notes_dir"> = {};

  // New layout (preferred): top-level lessons/, daily-plans/
  if (isDirectory(join(root, "projects")) && hasProjectsIndex(join(root, "projects"))) {
    out.projects_dir = "projects";
  }
  if (isDirectory(join(root, "lessons"))) out.lessons_dir = "lessons";
  if (isDirectory(join(root, "daily-plans"))) out.plans_dir = "daily-plans";
  if (isDirectory(join(root, "notes"))) out.notes_dir = "notes";

  // Legacy layout fallback: projects/_lessons, projects/_daily-plans
  if (!out.lessons_dir && isDirectory(join(root, "projects", "_lessons"))) {
    out.lessons_dir = "projects/_lessons";
  }
  if (!out.plans_dir && isDirectory(join(root, "projects", "_daily-plans"))) {
    out.plans_dir = "projects/_daily-plans";
  }

  return out;
}

function autoDetectSources(): Source[] {
  const workspacesDir = join(homedir(), "workspaces");
  if (!existsSync(workspacesDir)) return [];

  const found: Source[] = [];
  const entries = readdirSync(workspacesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsRoot = join(workspacesDir, entry.name);
    let wsEntries: ReturnType<typeof readdirSync>;
    try {
      wsEntries = readdirSync(wsRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const wsEntry of wsEntries) {
      if (!wsEntry.isDirectory() || !wsEntry.name.startsWith("ai-knowledge-")) continue;

      const root = join(wsRoot, wsEntry.name);
      const dirs = detectContentDirs(root);
      if (!dirs.projects_dir && !dirs.lessons_dir && !dirs.plans_dir && !dirs.notes_dir) continue;

      const suffix = wsEntry.name.slice("ai-knowledge-".length);
      const name = suffix || entry.name;

      found.push({
        name,
        display_name: name.charAt(0).toUpperCase() + name.slice(1),
        root,
        ...dirs,
        default_active: entry.name === "rajiv",
      });
    }
  }

  return found;
}

function getBuiltInDemoSource(): Source {
  const projectRoot = dirname(import.meta.dir);
  return {
    name: BUILTIN_DEMO_NAME,
    display_name: "Demo",
    root: join(projectRoot, "demo", "ai-knowledge-demo"),
    projects_dir: "projects",
    lessons_dir: "lessons",
    plans_dir: "daily-plans",
    demo: true,
    default_active: false,
  };
}

function normalizeSource(raw: Record<string, unknown>): Source {
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error("Source is missing required field 'name'");
  }
  if (!raw.root || typeof raw.root !== "string") {
    throw new Error(`Source '${raw.name}' is missing required field 'root'`);
  }

  return {
    name: raw.name,
    display_name: typeof raw.display_name === "string" ? raw.display_name : undefined,
    root: expandTilde(raw.root),
    projects_dir: typeof raw.projects_dir === "string" ? raw.projects_dir : undefined,
    lessons_dir: typeof raw.lessons_dir === "string" ? raw.lessons_dir : undefined,
    plans_dir: typeof raw.plans_dir === "string" ? raw.plans_dir : undefined,
    notes_dir: typeof raw.notes_dir === "string" ? raw.notes_dir : undefined,
    default_active: raw.default_active === true,
    demo: raw.demo === true,
  };
}

export function loadConfig(options?: { demo?: boolean }): ConsoleConfig {
  const demoSource = getBuiltInDemoSource();

  if (options?.demo) {
    return { sources: [demoSource], port: DEFAULT_PORT, demoMode: true };
  }

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown>;

      if (parsed && "workspaces" in parsed && !("sources" in parsed)) {
        throw new Error(
          `Your ${CONFIG_PATH} uses the v0.1 'workspaces:' schema, which synthesis-console v0.2 no longer supports.\n\n` +
          `Migration:\n` +
          `  1. Rename 'workspaces:' to 'sources:'.\n` +
          `  2. For each entry, replace 'knowledge: <name>' with:\n` +
          `       root: <root>/<name>     (combine root + knowledge into one absolute path)\n` +
          `       projects_dir: projects\n` +
          `       lessons_dir: lessons      (if your layout has top-level lessons/)\n` +
          `       plans_dir: daily-plans    (if your layout has top-level daily-plans/)\n` +
          `  3. Mark one source with 'default_active: true' for first-run selection.\n\n` +
          `See console.yaml.example in the repo for the canonical shape, and docs/layouts.md\n` +
          `for alternative layouts.`
        );
      }

      const sources: Source[] = [];
      if (Array.isArray(parsed.sources)) {
        for (const raw of parsed.sources) {
          sources.push(normalizeSource(raw as Record<string, unknown>));
        }
      }

      if (sources.length === 0) {
        console.error("  No sources defined in config. Falling back to auto-detection.\n");
      }

      const names = new Set<string>();
      for (const s of sources) {
        if (names.has(s.name)) {
          throw new Error(`Duplicate source name '${s.name}' in ${CONFIG_PATH}`);
        }
        names.add(s.name);
      }

      if (!names.has(BUILTIN_DEMO_NAME)) sources.push(demoSource);

      return {
        sources,
        port: typeof parsed.port === "number" ? parsed.port : DEFAULT_PORT,
        demoMode: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Failed to load ${CONFIG_PATH}:\n\n${msg}\n`);
      process.exit(1);
    }
  }

  const detected = autoDetectSources();
  if (detected.length > 0) {
    detected.push(demoSource);
    return { sources: detected, port: DEFAULT_PORT, demoMode: false };
  }

  console.log("  No config file and no auto-detected sources. Starting with demo source only.");
  console.log("  Create ~/.synthesis/console.yaml to add your own content.\n");
  return { sources: [demoSource], port: DEFAULT_PORT, demoMode: true };
}

export function isDemoSource(src: Source): boolean {
  return src.demo === true;
}

export function getProjectsPath(src: Source): string | null {
  return src.projects_dir ? join(src.root, src.projects_dir) : null;
}

export function getProjectPath(src: Source, projectId: string): string | null {
  const projectsDir = getProjectsPath(src);
  return projectsDir ? join(projectsDir, projectId) : null;
}

export function getLessonsPath(src: Source): string | null {
  return src.lessons_dir ? join(src.root, src.lessons_dir) : null;
}

export function getPlansPath(src: Source): string | null {
  return src.plans_dir ? join(src.root, src.plans_dir) : null;
}

export function getNotesPath(src: Source): string | null {
  return src.notes_dir ? join(src.root, src.notes_dir) : null;
}

export function findSource(sources: Source[], name: string): Source | undefined {
  return sources.find((s) => s.name === name);
}

export function displayName(src: Source): string {
  return src.display_name || src.name;
}
