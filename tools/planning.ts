import { access } from "node:fs/promises";
import { join } from "node:path";

export interface PlanningContext {
  planSource?: string;
  planningFramework?: string;
}

const ARTIFACTS = [
  { path: ".ito", framework: "Ito" },
  { path: "openspec", framework: "OpenSpec" },
  { path: ".openspec", framework: "OpenSpec" },
  { path: ".specify", framework: "SpecKit" },
  { path: "specs", framework: "SpecKit/specs" },
  { path: "PLAN.md", framework: "Markdown plan" },
  { path: "plan.md", framework: "Markdown plan" },
];

async function exists(root: string, relativePath: string): Promise<boolean> {
  try {
    await access(join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function inferFrameworkFromText(text: string): string | undefined {
  const lowered = text.toLowerCase();
  if (/\bito\b|\.ito/.test(lowered)) return "Ito";
  if (/openspec|open spec/.test(lowered)) return "OpenSpec";
  if (/speckit|spec kit|\.specify/.test(lowered)) return "SpecKit";
  if (/codex.*plan|plan mode.*codex/.test(lowered)) return "Codex planning";
  if (/opencode.*plan|plan mode.*opencode/.test(lowered)) return "OpenCode planning";
  if (/copilot.*plan|plan mode.*copilot/.test(lowered)) return "Copilot planning";
  if (/claude.*plan|plan mode.*claude/.test(lowered)) return "Claude Code planning";
  if (/superpower skills?/.test(lowered)) return "Superpower Skills";
  if (/matt pocock|total typescript/.test(lowered)) return "Matt Pocock/Total TypeScript";
  if (/grill me/.test(lowered)) return "Grill Me";
  if (/swarm/.test(lowered)) return "Swarm task planning";
  if (/\b(spec|specification|proposal|change|feature|accepted plan|plan)\b/.test(lowered)) {
    return "Repository planning/spec workflow";
  }
  return undefined;
}

function inferSourceFromText(text: string): string | undefined {
  const match = text.match(
    /(?:^|\s)([\w./-]*(?:PLAN|plan|spec|specs|change|proposal|feature)[\w./-]*\.(?:md|mdx|txt|json|ya?ml|toml))/,
  );
  return match?.[1];
}

export async function inferPlanningContext(options: {
  root: string;
  objective: string;
  planText?: string;
}): Promise<PlanningContext> {
  const text = `${options.objective}\n${options.planText ?? ""}`;
  const frameworkFromText = inferFrameworkFromText(text);
  const sourceFromText = inferSourceFromText(text);
  const detected: string[] = [];
  let frameworkFromArtifact: string | undefined;

  for (const artifact of ARTIFACTS) {
    if (await exists(options.root, artifact.path)) {
      detected.push(artifact.path);
      frameworkFromArtifact ??= artifact.framework;
    }
  }

  return {
    planSource: options.planText?.trim()
      ? "inline plan"
      : sourceFromText || (detected.length > 0 ? detected.join(", ") : undefined),
    planningFramework: frameworkFromText || frameworkFromArtifact,
  };
}
