const ENV_REFERENCE_PATTERN = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

export function isEnvReference(value: string): boolean {
  return ENV_REFERENCE_PATTERN.test(value);
}

export function extractEnvVarName(value: string): string | null {
  const match = value.match(ENV_REFERENCE_PATTERN);
  return match ? match[1] : null;
}

export function formatEnvReferenceHelp(): string {
  return "$ENV_VAR";
}

export function resolveListValues(
  values: string[],
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const resolved: string[] = [];

  for (const value of values) {
    const envVarName = extractEnvVarName(value);
    if (!envVarName) {
      const trimmed = value.trim();
      if (trimmed) {
        resolved.push(trimmed);
      }
      continue;
    }

    const envValue = env[envVarName];
    if (envValue === undefined || envValue === "") {
      console.error(
        `Missing required environment variable for ${label}: ${envVarName}`,
      );
      process.exit(1);
    }

    resolved.push(
      ...envValue
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  return resolved;
}

export function resolveStringValue(
  value: string,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const envVarName = extractEnvVarName(value);
  if (!envVarName) {
    return value;
  }

  const resolved = env[envVarName];
  if (resolved === undefined || resolved === "") {
    console.error(
      `Missing required environment variable for ${label}: ${envVarName}`,
    );
    process.exit(1);
  }

  return resolved;
}

export function resolveBooleanValue(
  value: boolean | string,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const resolved = resolveStringValue(value, label, env).trim().toLowerCase();
  if (["y", "yes", "true", "1", "on"].includes(resolved)) {
    return true;
  }
  if (["n", "no", "false", "0", "off"].includes(resolved)) {
    return false;
  }

  console.error(`${label} must resolve to yes or no.`);
  process.exit(1);
}

export function resolveEnumValue<T extends string>(
  value: T | string,
  label: string,
  allowedValues: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): T {
  const resolved = resolveStringValue(value, label, env);
  if (allowedValues.includes(resolved as T)) {
    return resolved as T;
  }

  console.error(
    `${label} must resolve to one of: ${allowedValues.join(", ")}.`,
  );
  process.exit(1);
}

export function resolvePortValue(
  value: number | string,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rawValue =
    typeof value === "number"
      ? String(value)
      : resolveStringValue(value, label, env);
  const port = Number(rawValue);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    return port;
  }

  console.error(`${label} must resolve to an integer from 1 to 65535.`);
  process.exit(1);
}

export function formatSecretValue(value: string): string {
  return isEnvReference(value) ? value : "[literal value hidden]";
}

export function formatVisibleValue(
  rawValue: string,
  resolvedValue: string,
): string {
  return isEnvReference(rawValue)
    ? `${rawValue} -> ${resolvedValue}`
    : rawValue;
}
