import { registerRecorderCommands } from "./commands";
import { registerCompletionProvider } from "./completionProvider";
import { registerImageCommands } from "./imageCommands";

export function registerRecorderModule() {
  registerRecorderCommands();
  registerImageCommands();
  
  // Only register audio commands in Node.js environment
  // Audio recording requires fs and child_process which are not available in web workers
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const { registerAudioCommands } = require("./audioCommands");
      registerAudioCommands();
    } catch (error) {
      console.warn("Audio commands could not be registered:", error);
    }
  }
  
  registerCompletionProvider();
}
