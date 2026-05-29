import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { prompt as sharedPrompt } from "./prompts";
import type {
  GeneratorOptionInput,
  ResolvedGeneratorOptions,
} from "../config/resolve-options";
import {
  extractEnvVarName,
  formatEnvReferenceHelp,
  isEnvReference,
  resolveBooleanValue,
  resolveListValues,
} from "./env-values";

type PromptFn = (message: string) => Promise<string>;
type PromptSession = {
  prompt: PromptFn;
  close: () => void;
};

const DEFAULT_ENVRC_PATH = ".envrc";

interface WizardDependencies {
  env?: NodeJS.ProcessEnv;
  envrcPath?: string;
  onEnvrcWrite?: () => void;
}

export async function promptForGeneratorOptions(
  defaults: ResolvedGeneratorOptions,
  promptFn?: PromptFn,
  dependencies: WizardDependencies = {},
): Promise<GeneratorOptionInput> {
  console.log("No parameters provided. Starting generator setup wizard.");
  console.log(
    `Connection values can be entered as plain text or ${formatEnvReferenceHelp()}.`,
  );
  console.log(
    `Use ${formatEnvReferenceHelp()} to keep values out of the config file.`,
  );
  console.log(
    `Passwords can also be plain text, but ${formatEnvReferenceHelp()} is recommended.\n`,
  );

  const promptSession = promptFn ? undefined : createPromptSession();
  const ask = promptFn ?? promptSession!.prompt;
  const env = dependencies.env ?? process.env;
  const envrcPath = dependencies.envrcPath ?? DEFAULT_ENVRC_PATH;
  const onEnvrcWrite = dependencies.onEnvrcWrite;

  try {
    const sourcePgHost = await promptConfigString(
      "Source host",
      defaults.sourcePgHost,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );
    const sourcePgPort = await promptPort(
      "Source port",
      defaults.sourcePgPort,
      ask,
      env,
      envrcPath,
    );
    const sourcePgUser = await promptConfigString(
      "Source user",
      defaults.sourcePgUser,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );
    const sourcePgPassword = await promptConfigString(
      "Source password ($ENV_VAR or plain text)",
      defaults.sourcePgPassword,
      ask,
      env,
      envrcPath,
      { secretDefault: true },
      onEnvrcWrite,
    );
    const sourcePgSsl = await promptBoolean(
      "Use SSL for source database",
      defaults.sourcePgSsl,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const sourcePgDatabase = await promptConfigString(
      "Source database",
      defaults.sourcePgDatabase,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );

    console.log("");

    const destPgHost = await promptConfigString(
      "Destination host",
      defaults.destPgHost,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );
    const destPgPort = await promptPort(
      "Destination port",
      defaults.destPgPort,
      ask,
      env,
      envrcPath,
    );
    const destPgUser = await promptConfigString(
      "Destination user",
      defaults.destPgUser,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );
    const destPgPassword = await promptConfigString(
      "Destination password ($ENV_VAR or plain text)",
      defaults.destPgPassword,
      ask,
      env,
      envrcPath,
      { secretDefault: true },
      onEnvrcWrite,
    );
    const destPgSsl = await promptBoolean(
      "Use SSL for destination database",
      defaults.destPgSsl,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const destPgDatabase = await promptConfigString(
      "Destination database",
      defaults.destPgDatabase,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );

    console.log("");

    const schema = await promptConfigString(
      "Schema",
      defaults.schema,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );
    const tables = await promptList(
      'Tables to compare (comma-separated, "*" supported)',
      defaults.tables,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const excludeTables = await promptOptionalList(
      'Tables to exclude (comma-separated, "*" supported)',
      defaults.excludeTables,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const ignoreColumns = await promptOptionalList(
      "Columns to ignore (comma-separated)",
      defaults.ignoreColumns,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const includeDeletes = await promptBoolean(
      "Include deletes",
      defaults.includeDeletes,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const skipMissingPk = await promptBoolean(
      "Skip tables without primary keys",
      defaults.skipMissingPk,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const output = await promptConfigString(
      "Output file",
      defaults.output,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );
    const generateSql = await promptBoolean(
      "Generate SQL script after diff",
      defaults.generateSql ?? true,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );

    console.log("");
    const schemaDiffTables = await promptList(
      'Schema diff tables to compare (comma-separated, "*" supported)',
      defaults.schemaDiffTables,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const schemaDiffExcludeTables = await promptOptionalList(
      'Schema diff tables to exclude (comma-separated, "*" supported)',
      defaults.schemaDiffExcludeTables,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const schemaDiffOutput = await promptConfigString(
      "Schema diff output file",
      defaults.schemaDiffOutput,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );

    console.log("");
    const pgTriggersTables = await promptList(
      'PostgreSQL triggers tables to compare (comma-separated, "*" supported)',
      defaults.pgTriggersTables,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const pgTriggersExcludeTables = await promptOptionalList(
      'PostgreSQL triggers tables to exclude (comma-separated, "*" supported)',
      defaults.pgTriggersExcludeTables,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const pgTriggersOutput = await promptConfigString(
      "PostgreSQL triggers output file",
      defaults.pgTriggersOutput,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );
    const generatePgTriggers = await promptBoolean(
      "Generate a PostgreSQL triggers and functions diff? (SQL script)",
      defaults.generatePgTriggers ?? true,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );

    console.log("");
    const pgViews = await promptOptionalList(
      'PostgreSQL views to compare (comma-separated, "*" supported; blank for all)',
      defaults.pgViews,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const pgViewsExclude = await promptOptionalList(
      'PostgreSQL views to exclude (comma-separated, "*" supported)',
      defaults.pgViewsExclude,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );
    const pgViewsOutput = await promptConfigString(
      "PostgreSQL views output file",
      defaults.pgViewsOutput,
      ask,
      env,
      envrcPath,
      {},
      onEnvrcWrite,
    );
    const generatePgViews = await promptBoolean(
      "Generate a PostgreSQL views diff? (SQL script)",
      defaults.generatePgViews ?? true,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );

    console.log("");
    const pretty = await promptBoolean(
      "Pretty-print JSON",
      defaults.pretty,
      ask,
      env,
      envrcPath,
      onEnvrcWrite,
    );

    return {
      sourcePgHost,
      sourcePgPort,
      sourcePgUser,
      sourcePgPassword,
      sourcePgSsl,
      sourcePgDatabase,
      destPgHost,
      destPgPort,
      destPgUser,
      destPgPassword,
      destPgSsl,
      destPgDatabase,
      schema,
      tables,
      excludeTables,
      schemaDiffTables,
      schemaDiffExcludeTables,
      pgTriggersTables,
      pgTriggersExcludeTables,
      pgViews,
      pgViewsExclude,
      ignoreColumns,
      includeDeletes,
      skipMissingPk,
      output,
      schemaDiffOutput,
      pgTriggersOutput,
      pgViewsOutput,
      pretty,
      generateSql,
      generatePgTriggers,
      generatePgViews,
    };
  } finally {
    promptSession?.close();
  }
}

async function promptRequired(
  label: string,
  defaultValue: string,
  promptFn: PromptFn,
): Promise<string> {
  while (true) {
    const answer = await promptFn(formatPrompt(label, defaultValue));
    const value = answer || defaultValue;
    if (value) return value;
    console.log(`${label} is required.`);
  }
}

async function promptPort(
  label: string,
  defaultValue: number | string,
  promptFn: PromptFn,
  env: NodeJS.ProcessEnv,
  envrcPath: string,
): Promise<number | string> {
  while (true) {
    const displayedDefault = formatDefault(defaultValue);
    const answer = await promptFn(formatPrompt(label, displayedDefault));
    const value = (answer || displayedDefault).trim();
    if (isEnvReference(value)) {
      await ensureEnvReferenceValue(value, promptFn, env, envrcPath);
      const resolvedPort = Number(env[extractEnvVarName(value)!]);
      if (
        Number.isInteger(resolvedPort) &&
        resolvedPort >= 1 &&
        resolvedPort <= 65535
      ) {
        return value;
      }
      console.log(`${label} must resolve to an integer from 1 to 65535.`);
      continue;
    }
    const port = Number(value);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
    console.log(`${label} must be an integer from 1 to 65535.`);
  }
}

async function promptConfigString(
  label: string,
  defaultValue: string,
  promptFn: PromptFn,
  env: NodeJS.ProcessEnv,
  envrcPath: string,
  options: { secretDefault?: boolean } = {},
  onEnvrcWrite?: () => void,
): Promise<string> {
  while (true) {
    const displayedDefault = formatDefault(defaultValue, env, options);
    const answer = await promptFn(formatPrompt(label, displayedDefault));
    const value = answer || defaultValue;
    if (!value) {
      console.log(`${label} is required.`);
      continue;
    }
    if (value.startsWith("$") && !isEnvReference(value)) {
      console.log(
        `${label} must use ${formatEnvReferenceHelp()} when referencing an environment variable.`,
      );
      continue;
    }
    if (isEnvReference(value)) {
      await ensureEnvReferenceValue(
        value,
        promptFn,
        env,
        envrcPath,
        onEnvrcWrite,
      );
    }
    return value;
  }
}

async function promptList(
  label: string,
  defaultValue: string[],
  promptFn: PromptFn,
  env: NodeJS.ProcessEnv,
  envrcPath: string,
  onEnvrcWrite?: () => void,
): Promise<string[]> {
  while (true) {
    const answer = await promptFn(formatPrompt(label, defaultValue.join(", ")));
    const values = parseList(answer || defaultValue.join(","));
    const listRefsValid = await ensureEnvReferencesForList(
      values,
      promptFn,
      env,
      envrcPath,
      label,
      onEnvrcWrite,
    );
    if (!listRefsValid) {
      continue;
    }
    const resolved = resolveListValues(values, label, env);
    if (resolved.length > 0) return values;
    console.log(`${label} requires at least one value.`);
  }
}

async function promptOptionalList(
  label: string,
  defaultValue: string[],
  promptFn: PromptFn,
  env: NodeJS.ProcessEnv,
  envrcPath: string,
  onEnvrcWrite?: () => void,
): Promise<string[]> {
  while (true) {
    const promptLabel =
      defaultValue.length > 0 ? `${label} (type none to clear)` : label;
    const answer = await promptFn(
      formatPrompt(promptLabel, defaultValue.join(", ")),
    );
    if (answer.trim().toLowerCase() === "none") {
      return [];
    }
    const values =
      !answer && defaultValue.length > 0 ? defaultValue : parseList(answer);
    const listRefsValid = await ensureEnvReferencesForList(
      values,
      promptFn,
      env,
      envrcPath,
      label,
      onEnvrcWrite,
    );
    if (!listRefsValid) {
      continue;
    }
    resolveListValues(values, label, env);
    return values;
  }
}

async function promptBoolean(
  label: string,
  defaultValue: boolean | string,
  promptFn: PromptFn,
  env: NodeJS.ProcessEnv,
  envrcPath: string,
  onEnvrcWrite?: () => void,
): Promise<boolean | string> {
  let defaultText: string;
  if (typeof defaultValue === "string") {
    defaultText = defaultValue;
  } else {
    defaultText = defaultValue ? "yes" : "no";
  }
  while (true) {
    const answer = await promptFn(
      formatPrompt(`${label} (yes/no)`, defaultText),
    );
    const value = answer || defaultText;
    if (value.startsWith("$") && !isEnvReference(value)) {
      console.log(
        `${label} must use ${formatEnvReferenceHelp()} when referencing an environment variable.`,
      );
      continue;
    }
    if (isEnvReference(value)) {
      await ensureEnvReferenceValue(
        value,
        promptFn,
        env,
        envrcPath,
        onEnvrcWrite,
      );
      assertValidBooleanReference(value, label, env);
      return value;
    }
    const normalizedValue = value.toLowerCase();
    if (["y", "yes", "true"].includes(normalizedValue)) return true;
    if (["n", "no", "false"].includes(normalizedValue)) return false;
    console.log(`${label} must be yes or no.`);
  }
}

function formatPrompt(label: string, defaultValue: string): string {
  return defaultValue ? `${label} [${defaultValue}]: ` : `${label}: `;
}

function formatDefault(
  value: number | string,
  env: NodeJS.ProcessEnv = process.env,
  options: { secretDefault?: boolean } = {},
): string {
  if (typeof value === "number") {
    return String(value);
  }
  if (!value) {
    return "";
  }
  if (options.secretDefault && isEnvReference(value)) {
    const envVarName = extractEnvVarName(value);
    if (envVarName && env[envVarName] !== undefined && env[envVarName] !== "") {
      return `${value} loaded`;
    }
    return `${value} not set`;
  }
  if (options.secretDefault && !isEnvReference(value)) {
    return "existing literal hidden";
  }
  return value;
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function writeEnvrcValue(
  envrcPath: string,
  envVarName: string,
  value: string,
): void {
  const resolvedPath = path.resolve(envrcPath);
  const line = `export ${envVarName}=${shellQuote(value)}`;
  const existing = fs.existsSync(resolvedPath)
    ? fs.readFileSync(resolvedPath, "utf-8")
    : "";
  const lines = existing ? existing.replace(/\n$/, "").split("\n") : [];
  const assignmentPattern = new RegExp(`^(?:export\\s+)?${envVarName}=`);
  const index = lines.findIndex((existingLine) =>
    assignmentPattern.test(existingLine.trim()),
  );

  if (index >= 0) {
    lines[index] = line;
  } else {
    lines.push(line);
  }

  fs.writeFileSync(resolvedPath, `${lines.join("\n")}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

async function ensureEnvReferenceValue(
  envReference: string,
  promptFn: PromptFn,
  env: NodeJS.ProcessEnv,
  envrcPath: string,
  onEnvrcWrite?: () => void,
): Promise<void> {
  const envVarName = extractEnvVarName(envReference);
  if (!envVarName) {
    return;
  }

  if (env[envVarName] !== undefined && env[envVarName] !== "") {
    return;
  }

  while (true) {
    const value = await promptFn(
      `${envVarName} is not set. Enter value to store in ${envrcPath}: `,
    );
    if (!value) {
      console.log("Value is required.");
      continue;
    }
    env[envVarName] = value;
    writeEnvrcValue(envrcPath, envVarName, value);
    onEnvrcWrite?.();
    console.log(
      `${envVarName} written to ${path.resolve(envrcPath)} and loaded for this run.`,
    );
    return;
  }
}

async function ensureEnvReferencesForList(
  values: string[],
  promptFn: PromptFn,
  env: NodeJS.ProcessEnv,
  envrcPath: string,
  label: string,
  onEnvrcWrite?: () => void,
): Promise<boolean> {
  for (const value of values) {
    if (value.startsWith("$") && !isEnvReference(value)) {
      console.log(
        `${label} must use ${formatEnvReferenceHelp()} when referencing an environment variable.`,
      );
      return false;
    }
    if (isEnvReference(value)) {
      await ensureEnvReferenceValue(
        value,
        promptFn,
        env,
        envrcPath,
        onEnvrcWrite,
      );
    }
  }
  return true;
}

function assertValidBooleanReference(
  envReference: string,
  label: string,
  env: NodeJS.ProcessEnv,
): void {
  resolveBooleanValue(envReference, label, env);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function createPromptSession(): PromptSession {
  if (!process.stdin.isTTY) {
    return {
      prompt: sharedPrompt,
      close: () => undefined,
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    prompt: (message: string) =>
      new Promise((resolve) => {
        rl.question(message, (answer) => {
          resolve(answer.trim());
        });
      }),
    close: () => rl.close(),
  };
}
