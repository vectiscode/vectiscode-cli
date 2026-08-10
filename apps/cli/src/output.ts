import chalk from "chalk";

export const output = {
  line(message = ""): void { process.stdout.write(`${message}\n`); },
  write(message: string): void { process.stdout.write(message); },
  error(message: string): void { process.stderr.write(`${chalk.red(message)}\n`); },
  muted(message: string): void { process.stdout.write(`${chalk.dim(message)}\n`); },
  success(message: string): void { process.stdout.write(`${chalk.green(message)}\n`); },
  warning(message: string): void { process.stdout.write(`${chalk.yellow(message)}\n`); }
};
