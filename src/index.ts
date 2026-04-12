import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createServer } from "net";
import { loadConfig } from "./config.js";
import { projectRoutes } from "./routes/projects.js";
import { lessonRoutes } from "./routes/lessons.js";
import { layout } from "./views/layout.js";
import pkg from "../package.json";

const args = process.argv.slice(2);
const isDemoFlag = args.includes("--demo");

const config = loadConfig({ demo: isDemoFlag });

if (config.workspaces.length === 0) {
  console.error(
    "No workspaces found and demo data not available. Create ~/.synthesis/console.yaml."
  );
  process.exit(1);
}

const app = new Hono();

// Static files
app.use("/style.css", serveStatic({ root: "./public" }));

// Root redirect
app.get("/", (c) => {
  const ws = config.workspaces[0].name;
  return c.redirect(`/projects?ws=${ws}`);
});

// Mount routes
app.route("/", projectRoutes(config));
app.route("/", lessonRoutes(config));

// 404 fallback
app.notFound((c) => {
  return c.html(
    layout({
      title: "Not Found",
      content: `<h1>404 — Not Found</h1><p>The page you're looking for doesn't exist.</p><p><a href="/">Go to dashboard</a></p>`,
      workspaces: config.workspaces,
      currentWorkspace: config.workspaces[0].name,
      demoMode: config.demoMode,
    }),
    404
  );
});

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return 0;
}

const preferredPort = config.port;
const port = await findAvailablePort(preferredPort);

if (port !== preferredPort) {
  console.log(`  Port ${preferredPort} is in use, using ${port} instead.\n`);
}

const modeLabel = config.demoMode ? " [DEMO]" : "";

console.log(`  Synthesis Console v${pkg.version}${modeLabel}
  ========================
  http://localhost:${port}
  Workspaces: ${config.workspaces.map((w) => w.name).join(", ")}
`);

export default {
  port,
  fetch: app.fetch,
};
