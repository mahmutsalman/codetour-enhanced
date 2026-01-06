// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { reaction } from "mobx";
import {
  commands,
  Comment,
  CommentAuthorInformation,
  CommentController,
  CommentMode,
  comments,
  CommentThread,
  CommentThreadCollapsibleState,
  ExtensionContext,
  MarkdownString,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  Uri,
  window,
  workspace
} from "vscode";
import { SMALL_ICON_URL, IMAGE_DISPLAY } from "../constants";
import { CodeTour, CodeTourStep, store } from "../store";
import { initializeStorage } from "../store/storage";
import {
  getActiveStepMarker,
  getActiveTourNumber,
  getFileUri,
  getStepFileUri,
  getStepLabel,
  getTourTitle
} from "../utils";
import { registerCodeStatusModule } from "./codeStatus";
import { registerPlayerCommands } from "./commands";
import { registerDecorators } from "./decorator";
import { registerFileSystemProvider } from "./fileSystem";
import { registerTextDocumentContentProvider } from "./fileSystem/documentProvider";
import { registerStatusBar } from "./status";
import { registerTreeProvider } from "./tree";
import { stripGeneratedMediaSections } from "../utils/stepContent";

const CONTROLLER_ID = "codetour";
const CONTROLLER_LABEL = "CodeTour";

let id = 0;

const SHELL_SCRIPT_PATTERN = /^>>\s+(?<script>.*)$/gm;

const COMMAND_PATTERN =
  /(?<commandPrefix>\(command:[\w+\.]+\?)(?<params>\[[^\]\)]+\])/gm;

const TOUR_REFERENCE_PATTERN =
  /(?:\[(?<linkTitle>[^\]]+)\])?\[(?=\s*[^\]\s])(?<tourTitle>[^\]#]+)?(?:#(?<stepNumber>\d+))?\](?!\()/gm;
const FILE_REFERENCE_PATTERN = /(\!)?(\[[^\]]+\]\()(\.[^\)]+)(?=\))/gm;
const CODE_FENCE_PATTERN = /```[^\n]+\n(.+)\n```/gms;

/**
 * Generates audio player markdown for a tour step
 */
function generateAudioGallery(step: CodeTourStep): string {
  if (!step.audios || step.audios.length === 0) {
    return "";
  }

  let audioContent = "\n\n---\n\n";
  audioContent += `🎵 **Audio Recordings (${step.audios.length})**\n\n`;
  
  for (const audio of step.audios) {
    const workspaceFolder = workspace.workspaceFolders?.[0];
    if (!workspaceFolder) continue;
    
    // Format duration
    const minutes = Math.floor(audio.duration / 60);
    const seconds = Math.floor(audio.duration % 60);
    const durationText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Create audio player link
    audioContent += `🎧 [**${audio.filename}**](command:codetour.playAudio?${encodeURIComponent(JSON.stringify([audio.path]))} "Play ${audio.filename}") `;
    audioContent += `*(${durationText}, ${audio.format.toUpperCase()})*`;
    
    // Add transcript if available
    if (audio.transcript) {
      audioContent += `  \n💬 *"${audio.transcript.length > 100 ? audio.transcript.substring(0, 100) + '...' : audio.transcript}"*`;
    }
    
    // Add audio management commands for editing mode
    if (store.isRecording && store.isEditing) {
      const removeArgs = encodeURIComponent(JSON.stringify([audio.id]));
      const transcriptArgs = encodeURIComponent(JSON.stringify([audio.id]));
      audioContent += `  \n[$(edit) Edit Transcript](command:codetour.updateAudioTranscript?${transcriptArgs}) | [$(trash) Remove](command:codetour.removeAudio?${removeArgs})`;
    }
    
    audioContent += "\n\n";
  }
  
  return audioContent;
}

/**
 * Generates image gallery with standardized sizing for a tour step
 */
function generateImageGallery(step: CodeTourStep): string {
  if (!step.images || step.images.length === 0) {
    return "";
  }

  let galleryContent = "\n\n---\n\n";
  galleryContent += `📎 **Attachments (${step.images.length})**\n\n`;
  
  for (const image of step.images) {
    const workspaceFolder = workspace.workspaceFolders?.[0];
    if (!workspaceFolder) continue;
    
    const imageUri = Uri.joinPath(workspaceFolder.uri, image.path);
    
    // Create a clickable image with size constraints using HTML
    galleryContent += `<div style="border: 1px solid #454545; border-radius: 6px; padding: 8px; margin: 8px 0; max-width: ${IMAGE_DISPLAY.DEFAULT_MAX_WIDTH + 20}px;">`;
    galleryContent += `<a href="command:codetour.viewImage?${encodeURIComponent(JSON.stringify([image.path]))}" title="Click to view full size">`;
    galleryContent += `<img src="${imageUri.toString()}" alt="${image.filename}" style="max-width: ${IMAGE_DISPLAY.DEFAULT_MAX_WIDTH}px; max-height: ${IMAGE_DISPLAY.DEFAULT_MAX_HEIGHT}px; width: auto; height: auto; object-fit: contain; border-radius: 4px; display: block;" />`;
    galleryContent += `</a>`;
    
    // Add filename and caption
    galleryContent += `<div style="margin-top: 8px; font-size: 0.9em;">`;
    galleryContent += `<div style="font-weight: bold;">${image.filename}</div>`;
    if (image.caption) {
      galleryContent += `<div style="font-style: italic; color: #888; margin-top: 4px;">${image.caption}</div>`;
    }
    
    // Add image management commands for editing mode
    if (store.isRecording && store.isEditing) {
      const removeArgs = encodeURIComponent(JSON.stringify([image.id]));
      const captionArgs = encodeURIComponent(JSON.stringify([image.id]));
      galleryContent += `<div style="margin-top: 8px; font-size: 0.85em;">`;
      galleryContent += `<a href="command:codetour.updateImageCaption?${captionArgs}">$(edit) Edit Caption</a> | <a href="command:codetour.removeImage?${removeArgs}">$(trash) Remove</a>`;
      galleryContent += `</div>`;
    }
    
    galleryContent += `</div></div>\n\n`;
  }
  
  return galleryContent;
}

/**
 * Generates simplified text summary for edit mode (avoids HTML in editable content)
 */
function generateEditModeAttachmentSummary(step: CodeTourStep): string {
  let summary = "";

  if (step.images && step.images.length > 0) {
    summary += "\n\n---\n\n";
    summary += `📎 **Attachments (${step.images.length})**\n\n`;
    summary += "_View attachments in preview mode or click Edit to manage them._\n";
  }

  if (step.audios && step.audios.length > 0) {
    if (!summary) {
      summary += "\n\n---\n\n";
    }
    summary += `🎵 **Audio Recordings (${step.audios.length})**\n\n`;
    summary += "_View audio recordings in preview mode or click Edit to manage them._\n";
  }

  return summary;
}

export function generatePreviewContent(content: string) {
  return content
    .replace(SHELL_SCRIPT_PATTERN, (_, script) => {
      const args = encodeURIComponent(JSON.stringify([script]));
      const s = `> [${script}](command:codetour.sendTextToTerminal?${args} "Run \\"${script.replace(
        /"/g,
        "'"
      )}\\" in a terminal")`;
      return s;
    })
    .replace(COMMAND_PATTERN, (_, commandPrefix, params) => {
      const args = encodeURIComponent(JSON.stringify(JSON.parse(params)));
      return `${commandPrefix}${args}`;
    })
    .replace(FILE_REFERENCE_PATTERN, (_, isImage, prefix, filePath) => {
      const workspaceUri = workspace.getWorkspaceFolder(
        Uri.parse(store.activeTour!.tour.id)
      )!.uri;
      const fileUri = Uri.joinPath(workspaceUri, filePath);

      if (isImage) {
        return `!${prefix}${fileUri.toString()}`;
      } else {
        const args = encodeURIComponent(JSON.stringify([fileUri]));
        return `${prefix}command:vscode.open?${args} "Open ${filePath}"`;
      }
    })
    .replace(TOUR_REFERENCE_PATTERN, (_, linkTitle, tourTitle, stepNumber) => {
      if (!tourTitle) {
        const title = linkTitle || `#${stepNumber}`;
        return `[${title}](command:codetour.navigateToStep?${stepNumber} "Navigate to step #${stepNumber}")`;
      }

      const tours = store.activeTour?.tours || store.tours;
      const tour = tours.find(tour => getTourTitle(tour) === tourTitle);
      if (tour) {
        const args: [string, number?] = [tour.title];

        if (stepNumber) {
          args.push(Number(stepNumber));
        }
        const argsContent = encodeURIComponent(JSON.stringify(args));
        const title = linkTitle || tour.title;
        return `[${title}](command:codetour.startTourByTitle?${argsContent} "Start \\"${tour.title}\\" tour")`;
      }

      return _;
    })
    .replace(CODE_FENCE_PATTERN, (_, codeBlock) => {
      const params = encodeURIComponent(JSON.stringify([codeBlock]));
      return `${_}
↪ [Insert Code](command:codetour.insertCodeSnippet?${params} "Insert Code")`;
    });
}

export class CodeTourComment implements Comment {
  public id: string = (++id).toString();
  public contextValue: string = "";
  public author: CommentAuthorInformation = {
    name: CONTROLLER_LABEL,
    iconPath: store.extensionUri
      ? Uri.joinPath(store.extensionUri, 'images', 'icon-small.png')
      : Uri.parse(SMALL_ICON_URL)
  };
  public body: MarkdownString;

  constructor(
    content: string,
    public label: string = "",
    public parent: CommentThread,
    public mode: CommentMode
  ) {
    const body =
      mode === CommentMode.Preview ? generatePreviewContent(content) : content;

    this.body = new MarkdownString(body);
    this.body.isTrusted = true;
    // @ts-ignore - supportHtml exists but not in type definitions
    this.body.supportHtml = true;
  }
}

let controller: CommentController | null;

export async function focusPlayer() {
  const currentThread = store.activeTour!.thread!;
  if (currentThread.range) {
    showDocument(currentThread.uri, currentThread.range);
  }
}

export async function startPlayer() {
  if (controller) {
    controller.dispose();
  }

  controller = comments.createCommentController(
    CONTROLLER_ID,
    CONTROLLER_LABEL
  );

  // TODO: Correctly limit the commenting ranges
  // to files within the workspace root
  controller.commentingRangeProvider = {
    provideCommentingRanges: (document: TextDocument) => {
      if (store.isRecording) {
        return [new Range(0, 0, document.lineCount, 0)];
      } else {
        return null;
      }
    }
  };
}

export async function stopPlayer() {
  if (store.activeTour?.thread) {
    store.activeTour!.thread.dispose();
    store.activeTour!.thread = null;
  }

  if (controller) {
    controller.dispose();
    controller = null;
  }
}

const VIEW_COMMANDS = new Map([
  ["comments", "workbench.panel.comments"],
  ["console", "workbench.panel.console"],
  ["debug", "workbench.view.debug"],
  ["debug:breakpoints", "workbench.debug.action.focusBreakpointsView"],
  ["debug:callstack", "workbench.debug.action.focusCallStackView"],
  ["debug:variables", "workbench.debug.action.focusVariablesView"],
  ["debug:watch", "workbench.debug.action.focusWatchView"],
  ["explorer", "workbench.view.explorer"],
  ["extensions", "workbench.view.extensions"],
  ["extensions:disabled", "extensions.disabledExtensionList.focus"],
  ["extensions:enabled", "extensions.enabledExtensionList.focus"],
  ["output", "workbench.panel.output"],
  ["problems", "workbench.panel.markers"],
  ["scm", "workbench.view.scm"],
  ["search", "workbench.view.search"],
  ["terminal", "terminal.focus"]
]);

function getPreviousTour(): CodeTour | undefined {
  const previousTour = store.tours.find(
    tour => tour.nextTour === store.activeTour?.tour.title
  );

  if (previousTour) {
    return previousTour;
  }

  const match = store.activeTour?.tour.title.match(/^#?(\d+)\s+-/);
  if (match) {
    const previousTourNumber = Number(match[1]) - 1;
    return store.tours.find(tour =>
      tour.title.match(new RegExp(`^#?${previousTourNumber}\\s+[-:]`))
    );
  }
}

function getNextTour(): CodeTour | undefined {
  if (store.activeTour?.tour.nextTour) {
    return store.tours.find(
      tour => tour.title === store.activeTour?.tour.nextTour
    );
  } else {
    const tourNumber = getActiveTourNumber();
    if (tourNumber) {
      const nextTourNumber = tourNumber + 1;
      return store.tours.find(tour =>
        tour.title.match(new RegExp(`^#?${nextTourNumber}\\s+[-:]`))
      );
    }
  }
}

async function renderCurrentStep() {
  if (store.activeTour!.thread) {
    store.activeTour!.thread.dispose();
  }

  const currentTour = store.activeTour!.tour;
  const currentStep = store.activeTour!.step;

  const step = currentTour!.steps[currentStep];
  if (!step) {
    return;
  }

  const workspaceRoot = store.activeTour?.workspaceRoot;
  const uri = await getStepFileUri(step, workspaceRoot, currentTour.ref);

  let line = step.line
    ? step.line - 1
    : step.selection
    ? step.selection.end.line - 1
    : undefined;

  if (step.file && line === undefined) {
    const stepPattern = step.pattern || getActiveStepMarker();
    if (stepPattern) {
      const document = await workspace.openTextDocument(uri);
      const match = document.getText().match(new RegExp(stepPattern, "m"));
      if (match) {
        line = document.positionAt(match.index!).line;
      }
    }
  }

  if (line === undefined) {
    // The step doesn't have a discoverable line number and so
    // stick the step at the end of the file. Unfortunately, there
    // isn't a way to say EOF, so 2000 is a temporary hack.
    line = 2000;
  }

  const range = new Range(line!, 0, line!, 0);
  let label = `Step #${currentStep + 1} of ${currentTour!.steps.length}`;

  if (currentTour.title) {
    const title = getTourTitle(currentTour);
    label += ` (${title})`;
  }

  store.activeTour!.thread = controller!.createCommentThread(uri, range, []);

  const mode =
    store.isRecording && store.isEditing
      ? CommentMode.Editing
      : CommentMode.Preview;
  const baseDescription = stripGeneratedMediaSections(step.description);
  let content = baseDescription;

  let hasPreviousStep = currentStep > 0;
  const hasNextStep = currentStep < currentTour.steps.length - 1;
  const isFinalStep = currentStep === currentTour.steps.length - 1;

  const showNavigation = hasPreviousStep || hasNextStep || isFinalStep;
  if (!store.isEditing && showNavigation) {
    content += "\n\n---\n";

    if (hasPreviousStep) {
      const stepLabel = getStepLabel(
        currentTour,
        currentStep - 1,
        false,
        false
      );
      const suffix = stepLabel ? ` (${stepLabel})` : "";
      content += `← [Previous${suffix}](command:codetour.previousTourStep "Navigate to previous step")`;
    } else {
      const previousTour = getPreviousTour();
      if (previousTour) {
        hasPreviousStep = true;

        const tourTitle = getTourTitle(previousTour);
        const argsContent = encodeURIComponent(
          JSON.stringify([previousTour.title])
        );
        content += `← [Previous Tour (${tourTitle})](command:codetour.startTourByTitle?${argsContent} "Navigate to previous tour")`;
      }
    }

    const prefix = hasPreviousStep ? " | " : "";
    if (hasNextStep) {
      const stepLabel = getStepLabel(
        currentTour,
        currentStep + 1,
        false,
        false
      );
      const suffix = stepLabel ? ` (${stepLabel})` : "";
      content += `${prefix}[Next${suffix}](command:codetour.nextTourStep "Navigate to next step") →`;
    } else if (isFinalStep) {
      const nextTour = getNextTour();
      if (nextTour) {
        const tourTitle = getTourTitle(nextTour);
        const argsContent = encodeURIComponent(
          JSON.stringify([nextTour.title])
        );
        content += `${prefix}[Next Tour (${tourTitle})](command:codetour.finishTour?${argsContent} "Start next tour")`;
      } else {
        content += `${prefix}[Finish Tour](command:codetour.finishTour "Finish the tour")`;
      }
    }
  }

  // Show media galleries or simplified summary depending on step's comment mode
  if (mode === CommentMode.Editing) {
    // In edit mode, show simplified summary to avoid HTML in editable content
    content += generateEditModeAttachmentSummary(step);
  } else {
    // In preview mode, show full galleries with HTML formatting
    content += generateAudioGallery(step);
    content += generateImageGallery(step);
  }

  const comment = new CodeTourComment(
    content,
    label,
    store.activeTour!.thread!,
    mode
  );

  // @ts-ignore
  store.activeTour!.thread.canReply = false;
  store.activeTour!.thread.comments = [comment];

  const contextValues = [];
  if (hasPreviousStep) {
    contextValues.push("hasPrevious");
  }

  if (hasNextStep) {
    contextValues.push("hasNext");
  }

  store.activeTour!.thread.contextValue = contextValues.join(".");
  store.activeTour!.thread.collapsibleState =
    CommentThreadCollapsibleState.Expanded;

  let selection;
  if (step.selection) {
    // Adjust the 1-based positions
    // to the 0-based positions that
    // VS Code's editor uses.
    selection = new Selection(
      step.selection.start.line - 1,
      step.selection.start.character - 1,
      step.selection.end.line - 1,
      step.selection.end.character - 1
    );
  } else {
    selection = new Selection(range.start, range.end);
  }

  await showDocument(uri, range, selection);

  if (step.directory) {
    const directoryUri = getFileUri(step.directory, workspaceRoot);
    commands.executeCommand("revealInExplorer", directoryUri);
  } else if (step.view) {
    const commandName = VIEW_COMMANDS.has(step.view)
      ? VIEW_COMMANDS.get(step.view)!
      : `${step.view}.focus`;

    try {
      await commands.executeCommand(commandName);
    } catch {
      window.showErrorMessage(
        `The current tour step is attempting to focus a view which isn't available: ${step.view}. Please check the tour and try again.`
      );
    }
  }

  if (step.commands) {
    for (const command of step.commands) {
      let name = command,
      args: any[] = [];

      if (command.includes("?")) {
        const parts = command.split("?");
        name = parts[0];
        args = JSON.parse(parts[1]);
      }

      try {
        console.log("Executing command", name, JSON.stringify(args));
        await commands.executeCommand(name, ...args);
      } catch (e) {
        window.showErrorMessage(`An error has occurred: ${e}`);
      }
    }
  }
}

/**
 * Manually refresh the current step display.
 * Useful for triggering UI updates after programmatic changes.
 */
export async function refreshCurrentStep() {
  return renderCurrentStep();
}

async function showDocument(uri: Uri, range: Range, selection?: Selection) {
  const document =
    window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    ) || (await window.showTextDocument(uri, { preserveFocus: true }));

  // TODO: Figure out how to force focus when navigating
  // to documents which are already open.

  if (selection) {
    document.selection = selection;
  }

  document.revealRange(range, TextEditorRevealType.InCenter);
}

export function registerPlayerModule(context: ExtensionContext) {
  registerPlayerCommands();
  registerTreeProvider(context.extensionPath);
  registerFileSystemProvider();
  registerTextDocumentContentProvider();
  registerStatusBar();
  registerDecorators();
  registerCodeStatusModule();

  initializeStorage(context);

  // Watch for changes to the active tour property,
  // and automatically re-render the current step in response.
  reaction(
    () => [
      store.activeTour
        ? [
            store.activeTour.step,
            store.activeTour.tour.title,
            store.activeTour.tour.steps.map(step => [
              step.title,
              step.description,
              step.line,
              step.directory,
              step.view,
              step.images
            ])
          ]
        : null
    ],
    () => {
      if (store.activeTour) {
        renderCurrentStep();
      }
    }
  );
}
