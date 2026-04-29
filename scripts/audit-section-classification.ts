#!/usr/bin/env bun
/**
 * Audit the cockpit's section classifier against a directory of daily plans.
 *
 * The cockpit's parser is intentionally tolerant — it accepts a wide vocabulary
 * of H2 names mapped to canonical kinds (decisions / priority-tasks / drafts /
 * briefing / standup / sent-messages / waiting / pr-queue / sync-state /
 * completed) and falls everything else through to "other". That fallthrough
 * is the regression signal for vocabulary drift between the daily-rituals skill
 * (the producer that writes plans) and this console (the consumer that renders
 * them). When the producer adopts new section names that the consumer doesn't
 * recognize, the share classified as "other" rises.
 *
 * The contract between producer and consumer lives in two documents:
 *   - synthesis-skills/synthesis-daily-rituals/SKILL.md (vocabulary table)
 *   - synthesis-console/docs/cockpit-design.md (vocabulary table)
 * They must change together. This script is the regression check that tells
 * you when they have drifted.
 *
 * Usage:
 *   bun run scripts/audit-section-classification.ts [plansDir]
 *   bun run scripts/audit-section-classification.ts demo/ai-knowledge-demo/daily-plans
 *   bun run scripts/audit-section-classification.ts ~/workspaces/rajiv/ai-knowledge-rajiv/daily-plans
 *
 * Defaults to the bundled demo plans if no argument is given.
 *
 * Exit codes: always 0. This script reports; it doesn't fail. The judgment of
 * "is this drift acceptable?" is human.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, isAbsolute, resolve } from "path";
import { homedir } from "os";
import { findPlanSections } from "../src/parsers/plan-sections.js";
import type { SectionKind } from "../src/parsers/plan-sections.js";

interface AuditResult {
  filesScanned: number;
  totalH2: number;
  byKind: Map<SectionKind, number>;
  unrecognized: { heading: string; file: string; date: string }[];
}

const KIND_ORDER: SectionKind[] = [
  "header",
  "decisions",
  "priority-tasks",
  "drafts",
  "briefing",
  "standup",
  "sent-messages",
  "waiting",
  "pr-queue",
  "sync-state",
  "completed",
  "other",
];

function expandTilde(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function resolveInput(input: string): string {
  const expanded = expandTilde(input);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

function audit(plansDir: string): AuditResult {
  const result: AuditResult = {
    filesScanned: 0,
    totalH2: 0,
    byKind: new Map(),
    unrecognized: [],
  };

  if (!existsSync(plansDir)) {
    console.error(`Plans dir not found: ${plansDir}`);
    process.exit(1);
  }
  if (!statSync(plansDir).isDirectory()) {
    console.error(`Not a directory: ${plansDir}`);
    process.exit(1);
  }

  const files = readdirSync(plansDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();

  for (const f of files) {
    const filePath = join(plansDir, f);
    const date = f.replace(/\.md$/, "");
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    result.filesScanned++;
    const sections = findPlanSections(raw);
    for (const s of sections) {
      // Skip the synthetic "header" pre-section — it isn't an H2.
      if (s.kind === "header") continue;
      result.totalH2++;
      result.byKind.set(s.kind, (result.byKind.get(s.kind) || 0) + 1);
      if (s.kind === "other") {
        result.unrecognized.push({ heading: s.rawHeading, file: f, date });
      }
    }
  }

  return result;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function pct(n: number, total: number): string {
  if (total === 0) return "  0.0%";
  const v = (n / total) * 100;
  return `${v.toFixed(1).padStart(5, " ")}%`;
}

function printReport(plansDir: string, r: AuditResult): void {
  const lines: string[] = [];
  lines.push("Synthesis Console — section classification audit");
  lines.push("=================================================");
  lines.push(`Plans dir:        ${plansDir}`);
  lines.push(`Files scanned:    ${r.filesScanned}`);
  lines.push(`Total H2 seen:    ${r.totalH2}`);
  lines.push("");
  lines.push("Classification (excluding the synthetic 'header' pre-section):");
  lines.push("");

  const kindWidth = 16;
  const countWidth = 6;
  for (const kind of KIND_ORDER) {
    if (kind === "header") continue;
    const count = r.byKind.get(kind) || 0;
    const share = pct(count, r.totalH2);
    lines.push(
      `  ${pad(kind, kindWidth)} ${String(count).padStart(countWidth, " ")}   ${share}`
    );
  }

  lines.push("");
  const otherCount = r.byKind.get("other") || 0;
  const fallthroughPct = r.totalH2 > 0 ? (otherCount / r.totalH2) * 100 : 0;
  lines.push(
    `Fall-through to 'other': ${otherCount} / ${r.totalH2} (${fallthroughPct.toFixed(1)}%)`
  );
  lines.push("");

  if (r.unrecognized.length > 0) {
    // Group by heading text (case-insensitive, after stripping surrounding
    // whitespace) so frequent stragglers surface clearly.
    const groups = new Map<string, { heading: string; count: number; samples: string[] }>();
    for (const u of r.unrecognized) {
      const key = u.heading.trim().toLowerCase();
      const g = groups.get(key);
      if (g) {
        g.count++;
        if (g.samples.length < 3) g.samples.push(u.date);
      } else {
        groups.set(key, { heading: u.heading.trim(), count: 1, samples: [u.date] });
      }
    }
    const sorted = Array.from(groups.values()).sort((a, b) => b.count - a.count);

    lines.push(`Unrecognized H2 headings (${groups.size} distinct):`);
    lines.push("");
    const top = sorted.slice(0, 25);
    for (const g of top) {
      const sample = g.samples.join(", ");
      lines.push(`  [${String(g.count).padStart(3, " ")}x]  ${g.heading}`);
      lines.push(`         seen on: ${sample}${g.count > g.samples.length ? ", ..." : ""}`);
    }
    if (sorted.length > top.length) {
      lines.push("");
      lines.push(`  ... and ${sorted.length - top.length} more distinct unrecognized headings.`);
    }
    lines.push("");
    lines.push(
      "Drift signal: if the count above includes headings that are not catch-alls"
    );
    lines.push(
      "by design (e.g. \"Everything Else\", \"Background Agent Demo\"), the contract"
    );
    lines.push(
      "between synthesis-daily-rituals and synthesis-console has drifted. Add the"
    );
    lines.push(
      "vocabulary to docs/cockpit-design.md AND synthesis-daily-rituals/SKILL.md"
    );
    lines.push("in the same commit. See the producer-consumer contract preamble.");
  } else {
    lines.push("No unrecognized headings — the contract is clean.");
  }

  console.log(lines.join("\n"));
}

const arg = process.argv[2];
const plansDir = arg
  ? resolveInput(arg)
  : resolve(import.meta.dir, "..", "demo", "ai-knowledge-demo", "daily-plans");

const result = audit(plansDir);
printReport(plansDir, result);
