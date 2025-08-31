import * as vscode from "vscode";
import { registerRecorderCommands } from "./commands";
import { registerCompletionProvider } from "./completionProvider";
import { registerImageCommands } from "./imageCommands";

export function registerRecorderModule(context?: vscode.ExtensionContext) {
  registerRecorderCommands();
  registerImageCommands();
  
  // Only register audio commands in Node.js environment
  // Audio recording requires fs and child_process which are not available in web workers
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const { registerAudioCommands } = require("./audioCommands");
      registerAudioCommands(context);
    } catch (error) {
      console.warn("Audio commands could not be registered:", error);
    }
  }
  
  registerCompletionProvider();
}
