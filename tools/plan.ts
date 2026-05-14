import type { PlanStep } from "../types/index.ts";

type RawPlanStep = string | { title?: unknown; description?: unknown };

function cleanStepText(text: string): string {
  return text
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function parseTextPlan(trimmed: string): PlanStep[] {
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  const hasExplicitSteps = lines.some((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line));
  if (!hasExplicitSteps) {
    return lines.map((line, index) => {
      const title = cleanStepText(line);
      return {
        id: `step-${index + 1}`,
        title,
        description: title,
        status: "pending",
      };
    });
  }

  const steps: Array<{ title: string; details: string[] }> = [];
  for (const line of lines) {
    const match = line.match(/^(\s*)(?:[-*]|\d+[.)])\s+(.+)$/);
    if (match && (match[1]?.length ?? 0) === 0) {
      steps.push({ title: cleanStepText(match[2] ?? ""), details: [] });
      continue;
    }

    const current = steps.at(-1);
    if (current) {
      current.details.push(cleanStepText(line));
      continue;
    }

    steps.push({ title: cleanStepText(line), details: [] });
  }

  return steps
    .filter((step) => step.title)
    .map((step, index) => ({
      id: `step-${index + 1}`,
      title: step.title,
      description: [step.title, ...step.details].filter(Boolean).join("\n"),
      status: "pending",
    }));
}

function createStep(raw: RawPlanStep, index: number): PlanStep | undefined {
  if (typeof raw === "string") {
    const title = cleanStepText(raw);
    if (!title) return undefined;
    return {
      id: `step-${index + 1}`,
      title,
      description: title,
      status: "pending",
    };
  }

  const title = typeof raw.title === "string" ? cleanStepText(raw.title) : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : title;
  if (!title && !description) return undefined;

  return {
    id: `step-${index + 1}`,
    title: title || description,
    description: description || title,
    status: "pending",
  };
}

export function parsePlan(planText: string | undefined): PlanStep[] {
  const trimmed = planText?.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item, index) => {
        const step = createStep(item as RawPlanStep, index);
        return step ? [step] : [];
      });
    }
  } catch {
    // Fall back to plain-text plan parsing below.
  }

  return parseTextPlan(trimmed);
}
