import * as vscode from 'vscode';

export class Logger {
  constructor(
    private readonly channel: vscode.OutputChannel,
    private readonly isDebug: () => boolean,
  ) {}

  info(message: string): void {
    this.channel.appendLine(message);
  }

  debug(message: string): void {
    if (!this.isDebug()) {
      return;
    }
    this.channel.appendLine(`[debug] ${message}`);
  }

  error(message: string): void {
    this.channel.appendLine(`[error] ${message}`);
  }

  show(): void {
    this.channel.show(true);
  }
}
