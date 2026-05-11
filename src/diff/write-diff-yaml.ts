import * as fs from "fs";
import { stringify } from "yaml";

export function buildYamlOutputPath(jsonOutputPath: string): string {
  return jsonOutputPath.endsWith(".json")
    ? jsonOutputPath.replace(/\.json$/i, ".yaml")
    : `${jsonOutputPath}.yaml`;
}

export function writeYamlFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, stringify(data), "utf-8");
}
