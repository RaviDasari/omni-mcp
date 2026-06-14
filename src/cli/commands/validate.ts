import { loadConfig } from "../../config/index.js";

interface ValidateOptions {
  config: string;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const { config, errors, warnings } = loadConfig(options.config);

  if (errors.length > 0) {
    process.stderr.write(
      `[omni-mcp] Config invalid: ${options.config} (${errors.length} error(s))\n`,
    );
    errors.forEach((e, i) => {
      process.stderr.write(`  ${i + 1}. ${e.message}\n`);
    });
    process.exit(1);
  }

  if (!config) {
    process.stderr.write("[omni-mcp] ERROR: Failed to load config\n");
    process.exit(1);
  }

  process.stdout.write(`[omni-mcp] Config valid: ${options.config}\n`);
  process.stdout.write(`  Servers:  ${Object.keys(config.servers).length} defined\n`);
  process.stdout.write(`  Profiles: ${Object.keys(config.profiles).length} defined\n`);
  process.stdout.write(`  Tokens:   ${Object.keys(config.tokens).length} defined\n`);

  if (warnings.length > 0) {
    process.stdout.write("  Warnings:\n");
    for (const w of warnings) {
      process.stdout.write(`    - ${w.message}\n`);
    }
  }
}
