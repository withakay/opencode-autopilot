import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAutopilotConfig, summarizeWorkflow } from "../config/autopilot-config.ts";
import { buildContinuationPrompt, inferAutopilotDirective } from "../prompts/index.ts";
import { buildAutopilotSystemPrompt } from "../prompts/system-prompt.ts";

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "autopilot-config-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("autopilot config", () => {
  test("loads .autopilot/config.jsonc with comments", async () => {
    await withTempDir(async (dir) => {
      const configDir = join(dir, ".autopilot");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "config.jsonc"),
        `{
          // prompt hints
          "promptInjection": {
            "system": ["Follow the active spec."],
            "continuation": ["Do the next checklist item."],
            "validation": ["Check acceptance criteria before complete."],
            "compaction": ["Preserve workflow state."]
          },
          "directiveRules": {
            "blockedPatterns": ["missing acceptance criteria"],
            "highImpactPatterns": ["schema migration"]
          },
          "workflow": {
            "name": "SpecFlow",
            "phase": "implement",
            "goal": "Finish the feature",
            "doneCriteria": ["tests pass"],
            "nextActions": ["implement code", "run tests"]
          }
        }`,
      );

      const config = await loadAutopilotConfig(dir);
      expect(config.promptInjection?.system).toEqual(["Follow the active spec."]);
      expect(config.directiveRules?.blockedPatterns).toEqual(["missing acceptance criteria"]);
      expect(config.workflow?.phase).toBe("implement");
    });
  });

  test("prefers jsonc over json in .autopilot", async () => {
    await withTempDir(async (dir) => {
      const configDir = join(dir, ".autopilot");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "config.json"),
        JSON.stringify({ workflow: { name: "json" } }),
      );
      await writeFile(join(configDir, "config.jsonc"), `{ "workflow": { "name": "jsonc" } }`);

      const config = await loadAutopilotConfig(dir);
      expect(config.workflow?.name).toBe("jsonc");
    });
  });

  test("injects config hints into prompts", () => {
    const config = {
      promptInjection: {
        system: ["Stay aligned to the active spec phase."],
        continuation: ["Complete the next spec checklist item."],
        validation: ["Validate against acceptance criteria."],
      },
    };

    expect(buildAutopilotSystemPrompt("balanced", true, config)).toContain(
      "Stay aligned to the active spec phase.",
    );
    expect(
      buildContinuationPrompt({
        continueCount: 1,
        maxContinues: 3,
        task: "Implement feature",
        config,
      }),
    ).toContain("Complete the next spec checklist item.");
    expect(
      buildContinuationPrompt({
        continueCount: 1,
        maxContinues: 3,
        task: "Implement feature",
        isValidation: true,
        config,
      }),
    ).toContain("Validate against acceptance criteria.");
  });

  test("extends directive detection from config", () => {
    const config = {
      directiveRules: {
        blockedPatterns: ["missing acceptance criteria"],
        highImpactPatterns: ["schema migration"],
      },
    };

    expect(inferAutopilotDirective("I am blocked by missing acceptance criteria.", config)).toEqual(
      {
        status: "blocked",
        reason: "Assistant requested input or reported it could not continue.",
      },
    );
    expect(
      inferAutopilotDirective("The next step is schema migration. Should I proceed?", config),
    ).toEqual({
      status: "blocked",
      reason: "Assistant requested input for a high-impact decision.",
    });
  });

  test("summarizes active workflow metadata", () => {
    expect(
      summarizeWorkflow({
        workflow: {
          name: "SpecFlow",
          phase: "implement",
          goal: "Finish feature",
          doneCriteria: ["tests pass"],
          nextActions: ["write code"],
        },
      }),
    ).toEqual([
      "Active workflow: SpecFlow",
      "Current phase: implement",
      "Workflow goal: Finish feature",
      "Done criteria: tests pass",
      "Preferred next actions: write code",
    ]);
  });
});
