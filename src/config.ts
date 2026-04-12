import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import yaml from "js-yaml";

export interface WorkspaceConfig {
  name: string;
  root: string;
  knowledge: string;
}

export interface ConsoleConfig {
  workspaces: WorkspaceConfig[];
  port: number;
  demoOnly: boolean;
}

const CONFIG_PATH = join(homedir(), ".synthesis", "console.yaml");
const DEFAULT_PORT = 5555;
const DEMO_WORKSPACE_NAME = "demo";

function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function autoDetectWorkspaces(): WorkspaceConfig[] {
  const workspacesDir = join(homedir(), "workspaces");
  if (!existsSync(workspacesDir)) return [];

  const workspaces: WorkspaceConfig[] = [];
  const entries = readdirSync(workspacesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsRoot = join(workspacesDir, entry.name);
    const wsEntries = readdirSync(wsRoot, { withFileTypes: true });

    for (const wsEntry of wsEntries) {
      if (wsEntry.isDirectory() && wsEntry.name.startsWith("ai-knowledge-")) {
        const knowledgeName = wsEntry.name;
        const indexPath = join(wsRoot, knowledgeName, "projects", "index.yaml");
        if (existsSync(indexPath)) {
          workspaces.push({
            name: entry.name,
            root: wsRoot,
            knowledge: knowledgeName,
          });
        }
      }
    }
  }

  return workspaces;
}

function getDemoWorkspace(): WorkspaceConfig {
  const projectRoot = dirname(import.meta.dir);
  return {
    name: DEMO_WORKSPACE_NAME,
    root: join(projectRoot, "demo"),
    knowledge: "ai-knowledge-demo",
  };
}

export function loadConfig(options?: { demo?: boolean }): ConsoleConfig {
  const demoWs = getDemoWorkspace();

  // --demo flag: demo workspace only, no user data
  if (options?.demo) {
    return {
      workspaces: [demoWs],
      port: DEFAULT_PORT,
      demoOnly: true,
    };
  }

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown>;

      const workspaces: WorkspaceConfig[] = [];
      if (Array.isArray(parsed.workspaces)) {
        for (const ws of parsed.workspaces) {
          workspaces.push({
            name: ws.name,
            root: expandTilde(ws.root),
            knowledge: ws.knowledge,
          });
        }
      }

      // Always include demo workspace alongside real workspaces
      workspaces.push(demoWs);

      return {
        workspaces,
        port: (parsed.port as number) || DEFAULT_PORT,
        demoOnly: false,
      };
    } catch (err) {
      console.error(
        `  Failed to parse ${CONFIG_PATH}: ${err instanceof Error ? err.message : err}`
      );
      console.error("  Falling back to auto-detection.\n");
    }
  }

  // Auto-detect workspaces
  const workspaces = autoDetectWorkspaces();
  if (workspaces.length > 0) {
    workspaces.push(demoWs);
    return { workspaces, port: DEFAULT_PORT, demoOnly: false };
  }

  // No config, no auto-detected workspaces: demo only
  console.log("  No workspaces found. Starting with demo workspace only.");
  console.log("  Create ~/.synthesis/console.yaml to add your own data.\n");
  return { workspaces: [demoWs], port: DEFAULT_PORT, demoOnly: true };
}

export function isDemoWorkspace(ws: WorkspaceConfig): boolean {
  return ws.name === DEMO_WORKSPACE_NAME;
}

export function getKnowledgePath(ws: WorkspaceConfig): string {
  return join(ws.root, ws.knowledge);
}

export function getProjectsPath(ws: WorkspaceConfig): string {
  return join(ws.root, ws.knowledge, "projects");
}

export function getProjectPath(ws: WorkspaceConfig, projectId: string): string {
  return join(getProjectsPath(ws), projectId);
}

export function getLessonsPath(ws: WorkspaceConfig): string {
  return join(getProjectsPath(ws), "_lessons");
}

export function getPlansPath(ws: WorkspaceConfig): string {
  return join(getProjectsPath(ws), "_daily-plans");
}
