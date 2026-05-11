import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPoolConfig,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  resolveConnectionParams,
} from "../../src/db/connection";

const TEST_ENV_VAR = "TEST_DB_PASSWORD_ABC123";
const TEST_HOST_ENV_VAR = "TEST_DB_HOST_ABC123";
const TEST_PORT_ENV_VAR = "TEST_DB_PORT_ABC123";

describe("resolveConnectionParams", () => {
  beforeEach(() => {
    delete process.env[TEST_ENV_VAR];
    delete process.env[TEST_HOST_ENV_VAR];
    delete process.env[TEST_PORT_ENV_VAR];
  });

  afterEach(() => {
    delete process.env[TEST_ENV_VAR];
    delete process.env[TEST_HOST_ENV_VAR];
    delete process.env[TEST_PORT_ENV_VAR];
  });

  it("resolves $ENV_VAR references for connection values", () => {
    process.env[TEST_ENV_VAR] = "secret_password";
    process.env[TEST_HOST_ENV_VAR] = "db.example.com";
    process.env[TEST_PORT_ENV_VAR] = "5433";

    const params = resolveConnectionParams(
      {
        host: `$${TEST_HOST_ENV_VAR}`,
        port: `$${TEST_PORT_ENV_VAR}`,
        database: "app",
        user: "app_user",
        password: `$${TEST_ENV_VAR}`,
        ssl: true,
      },
      {
        host: "source host",
        port: "source port",
        database: "source database",
        user: "source user",
        password: "source password",
      },
    );

    expect(params).toEqual({
      host: "db.example.com",
      port: 5433,
      database: "app",
      user: "app_user",
      password: "secret_password",
      ssl: true,
    });
  });

  it("keeps literal values as-is", () => {
    const params = resolveConnectionParams(
      {
        host: "db.example.com",
        port: 5432,
        database: "app",
        user: "app_user",
        password: "plain_password",
        ssl: false,
      },
      {
        host: "destination host",
        port: "destination port",
        database: "destination database",
        user: "destination user",
        password: "destination password",
      },
    );

    expect(params.password).toBe("plain_password");
    expect(params.port).toBe(5432);
  });

  it("exits with code 1 when a required environment variable is missing", () => {
    const originalExit = process.exit;
    const originalConsoleError = console.error;

    let exitCode: number | undefined;
    const errorMessages: string[] = [];

    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    }) as any;
    console.error = (message: string) => {
      errorMessages.push(message);
    };

    try {
      resolveConnectionParams(
        {
          host: "db.example.com",
          port: 5432,
          database: "app",
          user: "app_user",
          password: `$${TEST_ENV_VAR}`,
          ssl: false,
        },
        {
          host: "destination host",
          port: "destination port",
          database: "destination database",
          user: "destination user",
          password: "destination password",
        },
      );
    } catch {
      // Expected
    } finally {
      process.exit = originalExit;
      console.error = originalConsoleError;
    }

    expect(exitCode).toBe(1);
    expect(errorMessages.join("\n")).toContain(TEST_ENV_VAR);
  });

  it("exits when an env-backed port resolves to an invalid value", () => {
    process.env[TEST_PORT_ENV_VAR] = "not-a-port";
    const originalExit = process.exit;
    const originalConsoleError = console.error;

    let exitCode: number | undefined;
    const errorMessages: string[] = [];

    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    }) as any;
    console.error = (message: string) => {
      errorMessages.push(message);
    };

    try {
      resolveConnectionParams(
        {
          host: "db.example.com",
          port: `$${TEST_PORT_ENV_VAR}`,
          database: "app",
          user: "app_user",
          password: "plain_password",
          ssl: false,
        },
        {
          host: "destination host",
          port: "destination port",
          database: "destination database",
          user: "destination user",
          password: "destination password",
        },
      );
    } catch {
      // Expected
    } finally {
      process.exit = originalExit;
      console.error = originalConsoleError;
    }

    expect(exitCode).toBe(1);
    expect(errorMessages.join("\n")).toContain("destination port");
  });
});

describe("buildPoolConfig", () => {
  it("adds ssl config when ssl is enabled", () => {
    const config = buildPoolConfig({
      host: "db.example.com",
      port: 5432,
      database: "app",
      user: "app_user",
      password: "plain_password",
      ssl: true,
    });

    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("omits ssl config when ssl is disabled", () => {
    const config = buildPoolConfig({
      host: "db.example.com",
      port: 5432,
      database: "app",
      user: "app_user",
      password: "plain_password",
      ssl: false,
    });

    expect(config.ssl).toBeUndefined();
  });

  it("sets a finite connection timeout", () => {
    const config = buildPoolConfig({
      host: "db.example.com",
      port: 5432,
      database: "app",
      user: "app_user",
      password: "plain_password",
      ssl: false,
    });

    expect(config.connectionTimeoutMillis).toBe(DEFAULT_CONNECTION_TIMEOUT_MS);
  });
});
