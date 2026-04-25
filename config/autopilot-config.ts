import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AutopilotPromptInjectionConfig {
  system?: string[];
  continuation?: string[];
  validation?: string[];
  compaction?: string[];
}

export interface AutopilotDirectiveRulesConfig {
  blockedPatterns?: string[];
  highImpactPatterns?: string[];
}

export interface AutopilotWorkflowConfig {
  active?: boolean;
  name?: string;
  phase?: string;
  goal?: string;
  doneCriteria?: string[];
  nextActions?: string[];
}

export interface AutopilotConfig {
  promptInjection?: AutopilotPromptInjectionConfig;
  directiveRules?: AutopilotDirectiveRulesConfig;
  workflow?: AutopilotWorkflowConfig;
}

const CONFIG_CANDIDATES = ["config.jsonc", "config.json"] as const;

function stripJsonComments(input: string): string {
  return input.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeConfig(raw: unknown): AutopilotConfig {
  const root = asObject(raw);
  if (!root) {
    return {};
  }

  const promptInjection = asObject(root.promptInjection);
  const directiveRules = asObject(root.directiveRules);
  const workflow = asObject(root.workflow);

  return {
    promptInjection: promptInjection
      ? {
          system: asStringArray(promptInjection.system),
          continuation: asStringArray(promptInjection.continuation),
          validation: asStringArray(promptInjection.validation),
          compaction: asStringArray(promptInjection.compaction),
        }
      : undefined,
    directiveRules: directiveRules
      ? {
          blockedPatterns: asStringArray(directiveRules.blockedPatterns),
          highImpactPatterns: asStringArray(directiveRules.highImpactPatterns),
        }
      : undefined,
    workflow: workflow
      ? {
          active: workflow.active !== false,
          name: typeof workflow.name === "string" ? workflow.name.trim() : undefined,
          phase: typeof workflow.phase === "string" ? workflow.phase.trim() : undefined,
          goal: typeof workflow.goal === "string" ? workflow.goal.trim() : undefined,
          doneCriteria: asStringArray(workflow.doneCriteria),
          nextActions: asStringArray(workflow.nextActions),
        }
      : undefined,
  };
}

export async function loadAutopilotConfig(directory: string): Promise<AutopilotConfig> {
  const configDir = join(directory, ".autopilot");

  for (const candidate of CONFIG_CANDIDATES) {
    const filePath = join(configDir, candidate);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(candidate.endsWith("jsonc") ? stripJsonComments(raw) : raw);
      return normalizeConfig(parsed);
    } catch {
      return {};
    }
  }

  return {};
}

export function summarizeWorkflow(config: AutopilotConfig): string[] {
  const workflow = config.workflow;
  if (!workflow || workflow.active === false) {
    return [];
  }

  const lines: string[] = [];
  if (workflow.name) {
    lines.push(`Active workflow: ${workflow.name}`);
  }
  if (workflow.phase) {
    lines.push(`Current phase: ${workflow.phase}`);
  }
  if (workflow.goal) {
    lines.push(`Workflow goal: ${workflow.goal}`);
  }
  if (workflow.doneCriteria && workflow.doneCriteria.length > 0) {
    lines.push(`Done criteria: ${workflow.doneCriteria.join("; ")}`);
  }
  if (workflow.nextActions && workflow.nextActions.length > 0) {
    lines.push(`Preferred next actions: ${workflow.nextActions.join("; ")}`);
  }
  return lines;
}
