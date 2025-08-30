import { registerRecorderCommands } from "./commands";
import { registerCompletionProvider } from "./completionProvider";
import { registerImageCommands } from "./imageCommands";

export function registerRecorderModule() {
  registerRecorderCommands();
  registerImageCommands();
  registerCompletionProvider();
}
