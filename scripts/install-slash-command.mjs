#!/usr/bin/env node

import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function findProjectRoot() {
  let projectRoot = process.cwd();

  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(projectRoot, "package.json"))) {
      return projectRoot;
    }

    const parent = dirname(projectRoot);
    if (parent === projectRoot) {
      break;
    }
    projectRoot = parent;
  }

  return null;
}

async function copyManagedFile(sourceFile, targetFile, options = {}) {
  const { updateIfDifferent = true, label = targetFile } = options;

  if (!existsSync(sourceFile)) {
    console.log(`⚠️  Missing packaged asset: ${sourceFile}`);
    return false;
  }

  await mkdir(dirname(targetFile), { recursive: true });

  if (existsSync(targetFile)) {
    const [existing, source] = await Promise.all([
      readFile(targetFile, "utf-8"),
      readFile(sourceFile, "utf-8"),
    ]);

    if (existing === source) {
      console.log(`✅ ${label} already up to date`);
      return false;
    }

    if (!updateIfDifferent) {
      console.log(`ℹ️  Preserving existing ${label}`);
      return false;
    }

    console.log(`📝 Updating ${label}...`);
  } else {
    console.log(`🚀 Installing ${label}...`);
  }

  await copyFile(sourceFile, targetFile);
  console.log(`✅ Installed ${label} to: ${targetFile}`);
  return true;
}

async function installAssets() {
  try {
    const projectRoot = await findProjectRoot();
    if (!projectRoot) {
      console.log("⚠️  Could not find project root (no package.json found)");
      console.log("   Skipping OpenCode asset installation");
      return;
    }

    const packageOpencodeRoot = resolve(__dirname, "..", ".opencode");
    const projectOpencodeRoot = join(projectRoot, ".opencode");

    const slashCommandSource = join(packageOpencodeRoot, "commands", "autopilot.md");
    const slashCommandTarget = join(projectOpencodeRoot, "commands", "autopilot.md");

    await copyManagedFile(slashCommandSource, slashCommandTarget, {
      updateIfDifferent: true,
      label: "autopilot slash command",
    });

    const wingmanConfigSource = join(packageOpencodeRoot, "wingman-config.json");
    const wingmanConfigTarget = join(projectOpencodeRoot, "wingman-config.json");

    await copyManagedFile(wingmanConfigSource, wingmanConfigTarget, {
      updateIfDifferent: false,
      label: "Wingman config",
    });

    const packagedAgentsDir = join(packageOpencodeRoot, "agents");
    if (!existsSync(packagedAgentsDir)) {
      console.log("⚠️  No packaged Wingman agents directory found");
      return;
    }

    const agentFiles = (await readdir(packagedAgentsDir)).filter((name) => name.endsWith(".md"));
    const projectAgentsDir = join(projectOpencodeRoot, "agents");
    await mkdir(projectAgentsDir, { recursive: true });

    for (const agentFile of agentFiles) {
      await copyManagedFile(join(packagedAgentsDir, agentFile), join(projectAgentsDir, agentFile), {
        updateIfDifferent: false,
        label: `Wingman agent ${agentFile}`,
      });
    }

    console.log("✅ OpenCode autopilot assets installed");
    console.log("   Available slash command: /autopilot on");
    console.log("   Available Wingman agents: see .opencode/agents/");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Failed to install OpenCode assets:", message);
    console.log("   You can manually copy assets from the package .opencode directory.");
  }
}

installAssets();
