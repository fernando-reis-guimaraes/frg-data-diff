import * as fs from "fs";
import * as readline from "readline";

let nonTtyAnswers: string[] | undefined;
let nonTtyAnswerIndex = 0;

/**
 * Prompts the user with the given message and waits for input.
 * Returns the trimmed input string.
 */
export function prompt(message: string): Promise<string> {
  if (!process.stdin.isTTY) {
    nonTtyAnswers ??= fs.readFileSync(0, "utf-8").split(/\r?\n/);
    process.stdout.write(message);
    return Promise.resolve((nonTtyAnswers[nonTtyAnswerIndex++] ?? "").trim());
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Asks the user to type "yes" to proceed.
 * Returns true if the user typed exactly "yes", false otherwise.
 */
export async function confirmProceed(
  message: string = 'Proceed? Type "yes" to continue: ',
  defaultYes: boolean = false,
): Promise<boolean> {
  const answer = (await prompt(message)).trim().toLowerCase();
  if (answer === "") {
    return defaultYes;
  }
  if (answer === "no") {
    return false;
  }
  return answer === "yes";
}

/**
 * Asks the user whether to create a config file.
 * Returns true if the user typed exactly "yes".
 */
export async function confirmCreateConfig(): Promise<boolean> {
  const message =
    "\nNo .frg-data-diff.config.json file was found.\nCreate one from these options? [yes]: ";
  return confirmProceed(message, true);
}

/**
 * Asks the user whether to update an existing config file with the current options.
 * Returns true if the user typed exactly "yes".
 */
export async function confirmUpdateConfig(): Promise<boolean> {
  const message =
    "\nSave these options back to .frg-data-diff.config.json? [yes]: ";
  return confirmProceed(message, true);
}

/**
 * Asks the user whether to run `direnv allow` in the current directory.
 * Returns true if the user typed exactly "yes".
 */
export async function confirmDirenvAllow(): Promise<boolean> {
  const message =
    '\nA direnv installation was detected.\nRun "direnv allow" for this directory now? [yes]: ';
  return confirmProceed(message, true);
}
