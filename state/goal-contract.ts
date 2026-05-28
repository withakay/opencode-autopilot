import type { Checkpoint, GoalContract, GoalCriterion, PlanStep } from "../types/index.ts";

function splitCriteria(text: string | undefined): string[] {
  const trimmed = text?.trim();
  if (!trimmed) return [];

  return trimmed
    .split(/\r?\n|;|\s+and\s+/i)
    .map((item) =>
      item
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

function sourceFromObjective(objective: string): string[] {
  const sources = new Set<string>();
  const regex = /(?:^|\s)([\w./-]+\.(?:md|mdx|txt|json|ya?ml|toml)|#[0-9]+)(?=\s|$|[.,;:])/gi;
  let match = regex.exec(objective);
  while (match) {
    const source = match[1]?.trim();
    if (source) sources.add(source);
    match = regex.exec(objective);
  }
  return [...sources];
}

function normalizePlanSource(planSource: string | undefined): string[] {
  if (!planSource || planSource === "inline plan") return [];
  return planSource
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createCriteria(options: {
  doneWhen?: string;
  verifyWith?: string;
  plan?: PlanStep[];
}): GoalCriterion[] {
  const criteria = splitCriteria(options.doneWhen).map((text, index) => ({
    id: `criterion-${index + 1}`,
    text,
    status: "pending" as const,
  }));

  if (options.verifyWith?.trim()) {
    criteria.push({
      id: `criterion-${criteria.length + 1}`,
      text: `Verification command passes: ${options.verifyWith.trim()}`,
      status: "pending",
    });
  }

  if (criteria.length === 0 && options.plan && options.plan.length > 0) {
    criteria.push({
      id: "criterion-1",
      text: `All ${options.plan.length} plan steps are complete and validated`,
      status: "pending",
    });
  }

  return criteria;
}

export function createGoalContract(options: {
  objective: string;
  doneWhen?: string;
  verifyWith?: string;
  planSource?: string;
  planningFramework?: string;
  plan?: PlanStep[];
}): GoalContract {
  const objective = options.objective.trim();
  const criteria = createCriteria(options);
  const requiredSources = [
    ...new Set([...sourceFromObjective(objective), ...normalizePlanSource(options.planSource)]),
  ];
  const hasExplicitStop = Boolean(options.doneWhen?.trim() || options.verifyWith?.trim());
  const hasUntilStop = /\b(until|done when|stop when|without stopping until)\b/i.test(objective);
  const hasPlan = (options.plan?.length ?? 0) > 0;
  const quality =
    hasExplicitStop || hasUntilStop || hasPlan
      ? "strong"
      : options.planningFramework || options.planSource
        ? "inferred"
        : "weak";

  return {
    summary: objective || "Session-level autonomy defaults",
    quality,
    stop_condition: options.doneWhen?.trim() || (hasUntilStop ? objective : undefined),
    required_sources: requiredSources,
    constraints: [],
    criteria,
  };
}

export function createInitialCheckpoint(options: {
  objective: string;
  plan?: PlanStep[];
}): Checkpoint[] {
  const firstPlanStep = options.plan?.[0];
  if (firstPlanStep) {
    return [
      {
        id: "checkpoint-1",
        title: firstPlanStep.title,
        status: "active",
        evidence: [],
      },
    ];
  }

  if (!options.objective.trim()) return [];

  return [
    {
      id: "checkpoint-1",
      title: "Start objective run",
      status: "active",
      evidence: [],
    },
  ];
}

export function ensureGoalContract(state: {
  objective?: string;
  goal?: string;
  done_when?: string;
  verify_with?: string;
  plan_source?: string;
  planning_framework?: string;
  plan?: PlanStep[];
  goal_contract?: GoalContract;
  checkpoints?: Checkpoint[];
  current_checkpoint?: string;
}): void {
  const objective = state.objective || state.goal || "";
  if (!state.goal_contract) {
    state.goal_contract = createGoalContract({
      objective,
      doneWhen: state.done_when,
      verifyWith: state.verify_with,
      planSource: state.plan_source,
      planningFramework: state.planning_framework,
      plan: state.plan ?? [],
    });
  }

  if (!Array.isArray(state.checkpoints)) {
    state.checkpoints = createInitialCheckpoint({ objective, plan: state.plan ?? [] });
  }

  if (!state.current_checkpoint && state.checkpoints.length > 0) {
    state.current_checkpoint = state.checkpoints.find(
      (checkpoint) => checkpoint.status === "active",
    )?.id;
  }
}
