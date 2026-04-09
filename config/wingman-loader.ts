import type { AutonomousStrength } from "../types/state.ts";

export interface WingmanModelConfig {
  provider: string;
  model: string;
}

export interface WingmanDefinition {
  description: string;
  model: WingmanModelConfig;
  strength: AutonomousStrength;
  roles: string[];
}

export interface RoutingRule {
  taskPattern: string;
  wingman: string;
}

export interface WingmanConfiguration {
  description?: string;
  wingmen: Record<string, WingmanDefinition>;
  routing: {
    default: string;
    rules: RoutingRule[];
  };
}

const DEFAULT_CONFIG: WingmanConfiguration = {
  wingmen: {
    "default-wingman": {
      description: "Default versatile worker",
      model: { provider: "github-copilot", model: "github-copilot/claude-sonnet-4" },
      strength: "balanced",
      roles: ["general"],
    },
  },
  routing: {
    default: "default-wingman",
    rules: [],
  },
};

let cachedConfig: WingmanConfiguration | null = null;
let configLoadTime = 0;
const CONFIG_CACHE_MS = 5000; // Reload every 5 seconds in dev

/**
 * Load wingman configuration from JSON file
 */
export async function loadWingmanConfig(configPath?: string): Promise<WingmanConfiguration> {
  const now = Date.now();

  // Return cached config if fresh
  if (cachedConfig && now - configLoadTime < CONFIG_CACHE_MS) {
    return cachedConfig;
  }

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Default path: .opencode/wingman-config.json
    const resolvedPath = configPath || path.join(process.cwd(), ".opencode", "wingman-config.json");

    const content = await fs.readFile(resolvedPath, "utf-8");
    const config = JSON.parse(content) as WingmanConfiguration;

    // Validate required fields
    if (!config.wingmen || Object.keys(config.wingmen).length === 0) {
      console.warn("[Wingman] Config has no wingmen defined, using default");
      return DEFAULT_CONFIG;
    }

    if (!config.routing?.default) {
      console.warn("[Wingman] Config missing routing.default, using first wingman");
      const firstKey = Object.keys(config.wingmen)[0];
      if (!firstKey) {
        return DEFAULT_CONFIG;
      }
      config.routing = {
        default: firstKey,
        rules: [],
      };
    }

    cachedConfig = config;
    configLoadTime = now;

    return config;
  } catch (error) {
    if (configPath) {
      console.warn(
        `[Wingman] Failed to load config from ${configPath}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return DEFAULT_CONFIG;
  }
}

/**
 * Clear the config cache (useful for testing)
 */
export function clearWingmanConfigCache(): void {
  cachedConfig = null;
  configLoadTime = 0;
}

/**
 * Get a specific wingman by name
 */
export async function getWingman(
  name: string,
  configPath?: string,
): Promise<WingmanDefinition | null> {
  const config = await loadWingmanConfig(configPath);
  return config.wingmen[name] || null;
}

/**
 * List all available wingmen
 */
export async function listWingmen(
  configPath?: string,
): Promise<Array<{ name: string; definition: WingmanDefinition }>> {
  const config = await loadWingmanConfig(configPath);
  return Object.entries(config.wingmen).map(([name, definition]) => ({
    name,
    definition,
  }));
}

/**
 * Route a task to the appropriate wingman based on routing rules
 */
export async function routeTask(
  task: string,
  configPath?: string,
): Promise<{ wingmanName: string; wingman: WingmanDefinition }> {
  const config = await loadWingmanConfig(configPath);
  const taskLower = task.toLowerCase();

  // Check routing rules in order
  for (const rule of config.routing.rules) {
    const patterns = rule.taskPattern.split("|");
    for (const pattern of patterns) {
      if (taskLower.includes(pattern.toLowerCase().trim())) {
        const wingman = config.wingmen[rule.wingman];
        if (wingman) {
          return { wingmanName: rule.wingman, wingman };
        }
      }
    }
  }

  // Fall back to default
  const defaultWingman = config.wingmen[config.routing.default];
  if (!defaultWingman) {
    // Shouldn't happen if config is valid, but just in case
    const entries = Object.entries(config.wingmen);
    const firstWingman = entries[0];
    if (!firstWingman) {
      throw new Error("No wingmen defined in config");
    }
    return { wingmanName: firstWingman[0], wingman: firstWingman[1] };
  }

  return { wingmanName: config.routing.default, wingman: defaultWingman };
}

/**
 * Build system prompt for a wingman based on its configuration
 */
export function buildWingmanSystemPrompt(
  wingman: WingmanDefinition,
  roleSpecificInstructions?: string,
): string {
  const parts = [`You are ${wingman.description}.`, `Operating in ${wingman.strength} mode.`];

  if (roleSpecificInstructions) {
    parts.push("", roleSpecificInstructions);
  }

  // Add model info
  parts.push("", `Model: ${wingman.model.model}`);

  return parts.join("\n");
}

/**
 * Export config as OpenCode agents configuration
 * This can be used to update .opencode/agents.json
 */
export async function exportAsOpenCodeAgents(
  configPath?: string,
): Promise<Record<string, unknown>> {
  const config = await loadWingmanConfig(configPath);
  const agents: Record<string, unknown> = {};

  for (const [name, wingman] of Object.entries(config.wingmen)) {
    agents[name] = {
      description: wingman.description,
      model: wingman.model.model,
      // OpenCode-specific fields
      systemPrompt: buildWingmanSystemPrompt(wingman),
    };
  }

  return agents;
}
