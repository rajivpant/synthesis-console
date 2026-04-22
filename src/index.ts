import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createServer } from "net";
import { loadConfig, displayName } from "./config.js";
import { projectRoutes } from "./routes/projects.js";
import { lessonRoutes } from "./routes/lessons.js";
import { planRoutes } from "./routes/plans.js";
import { layout } from "./views/layout.js";
import { activeSources } from "./active-sources.js";
import pkg from "../package.json";

const args = process.argv.slice(2);
const isDemoFlag = args.includes("--demo");

const config = loadConfig({ demo: isDemoFlag });

if (config.sources.length === 0) {
  console.error(
    "No sources configured and demo data not available. Create ~/.synthesis/console.yaml."
  );
  process.exit(1);
}

const app = new Hono();

app.use("/style.css", serveStatic({ root: "./public" }));

app.get("/", (c) => c.redirect("/projects"));

app.route("/", projectRoutes(config));
app.route("/", lessonRoutes(config));
app.route("/", planRoutes(config));

app.notFound((c) => {
  const active = activeSources(c, config);
  return c.html(
    layout({
      title: "Not Found",
      content: `<h1>404 — Not Found</h1><p>The page you're looking for doesn't exist.</p><p><a href="/">Go to projects</a></p>`,
      sources: config.sources,
      activeSourceNames: active.map((s) => s.name),
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

const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
const preferredPort = envPort && Number.isFinite(envPort) ? envPort : config.port;
const port = await findAvailablePort(preferredPort);

if (port !== preferredPort) {
  console.log(`  Port ${preferredPort} is in use, using ${port} instead.\n`);
}

const modeLabel = config.demoMode ? " [DEMO ONLY]" : "";
const defaultActiveNames = config.sources
  .filter((s) => s.default_active)
  .map((s) => displayName(s))
  .join(", ") || "none (first source used)";

console.log(`  Synthesis Console v${pkg.version}${modeLabel}
  ========================
  http://localhost:${port}
  Sources:          ${config.sources.map((s) => displayName(s)).join(", ")}
  Default-active:   ${defaultActiveNames}
`);

export default {
  port,
  fetch: app.fetch,
};
