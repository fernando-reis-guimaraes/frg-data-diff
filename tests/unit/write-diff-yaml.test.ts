import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildYamlOutputPath,
  writeYamlFile,
} from "../../src/diff/write-diff-yaml";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("write-diff-yaml", () => {
  it("builds a sibling yaml path from a json path", () => {
    expect(buildYamlOutputPath("frg-data-diff.json")).toBe(
      "frg-data-diff.yaml",
    );
    expect(buildYamlOutputPath("custom-output")).toBe("custom-output.yaml");
  });

  it("writes yaml using the yaml library", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "frg-yaml-test-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "diff.yaml");

    writeYamlFile(filePath, {
      format: "postgres-data-diff-json/v1",
      tables: [
        {
          table: "directus_users",
          inserts: [{ row: { id: 1, email: "hi@example.com" } }],
        },
      ],
    });

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("format: postgres-data-diff-json/v1");
    expect(content).toContain("table: directus_users");
    expect(content).toContain("email: hi@example.com");
  });
});
