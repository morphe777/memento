import { createInterface } from 'node:readline';

/** Reads a line; hides the typed characters on a TTY. */
export function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY,
    });
    if (hidden && process.stdin.isTTY) {
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        write.call(rl, s.startsWith(question) ? question : '');
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden && process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}
