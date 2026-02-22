// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { initializeApi } from "./api";
import { initializeGitApi } from "./git";
import { registerLiveShareModule } from "./liveShare";
import { registerPlayerModule } from "./player";
import { registerRecorderModule } from "./recorder";
import { store } from "./store";
import {
  promptForTour,
  startCodeTour,
  startDefaultTour
} from "./store/actions";
import { discoverTours as _discoverTours } from "./store/provider";
import { GalleryManager } from "./gallery/galleryManager";
import { StepContentViewProvider } from "./player/stepContentView";
import { StepImagesViewProvider } from "./player/stepImagesView";
import { ImageGalleryPanelProvider } from "./player/imageGalleryPanel";
import { StepAudioViewProvider } from "./player/stepAudioView";

/**
 * In order to check whether the URI handler was called on activation,
 * we must do this dance around `discoverTours`. The same call to
 * `discoverTours` is shared between `activate` and the URI handler.
 */
let cachedDiscoverTours: Promise<void> | undefined;
function discoverTours(): Promise<void> {
  return cachedDiscoverTours ?? (cachedDiscoverTours = _discoverTours());
}

function startTour(params: URLSearchParams) {
  let tourPath = params.get("tour");
  const step = params.get("step");

  let stepNumber;
  if (step) {
    // Allow the step number to be
    // provided as 1-based vs. 0-based
    stepNumber = Number(step) - 1;
  }

  if (tourPath) {
    if (!tourPath.endsWith(".tour")) {
      tourPath = `${tourPath}.tour`;
    }

    const tour = store.tours.find(tour => tour.id.endsWith(tourPath as string));
    if (tour) {
      startCodeTour(tour, stepNumber);
    }
  } else {
    startDefaultTour(undefined, undefined, stepNumber);
  }
}

class URIHandler implements vscode.UriHandler {
  private _didStartDefaultTour = false;
  get didStartDefaultTour(): boolean {
    return this._didStartDefaultTour;
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    this._didStartDefaultTour = true;
    await discoverTours();

    let query = uri.query;
    if (uri.path === "/startDefaultTour") {
      query = vscode.Uri.parse(uri.query).query;
    }

    if (query) {
      const params = new URLSearchParams(query);
      startTour(params);
    } else {
      startDefaultTour();
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  try {
    console.log("CodeTour: Starting activation...");

    // Store extension URI for accessing bundled resources
    store.extensionUri = context.extensionUri;

    // Initialize core modules first
    registerPlayerModule(context);
    console.log("CodeTour: Player module registered");
    
    registerRecorderModule(context);
    console.log("CodeTour: Recorder module registered");
    
    registerLiveShareModule();
    console.log("CodeTour: LiveShare module registered");

    // Initialize gallery manager with error handling
    try {
      GalleryManager.getInstance(context.extensionUri);
      GalleryManager.registerCommands();
      console.log("CodeTour: Gallery manager initialized successfully");
    } catch (galleryError) {
      console.error("CodeTour: Gallery manager initialization failed, but continuing:", galleryError);
      // Don't let gallery errors break the extension
    }

    // Register Step Content webview provider (Quill.js rich text editor)
    const stepContentProvider = new StepContentViewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        StepContentViewProvider.viewType,
        stepContentProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("codetour.editStepRichText", () => {
        stepContentProvider.enterEditMode();
      }),
      vscode.commands.registerCommand("codetour.saveStepRichText", () => {
        // Save is handled via webview message passing
      }),
      vscode.commands.registerCommand("codetour.cancelStepRichTextEdit", () => {
        stepContentProvider.cancelEdit();
      })
    );
    console.log("CodeTour: Step Content provider registered");

    // Register Step Images sidebar provider and Image Gallery bottom panel provider
    const imageGalleryProvider = new ImageGalleryPanelProvider(context.extensionUri);
    const stepImagesProvider = new StepImagesViewProvider(context.extensionUri);
    stepImagesProvider.setGalleryProvider(imageGalleryProvider);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        StepImagesViewProvider.viewType,
        stepImagesProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
      ),
      vscode.window.registerWebviewViewProvider(
        ImageGalleryPanelProvider.viewType,
        imageGalleryProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );

    // Register Step Audio sidebar provider — wired to the same bottom media panel
    const stepAudioProvider = new StepAudioViewProvider(context.extensionUri);
    stepAudioProvider.setMediaProvider(imageGalleryProvider);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        StepAudioViewProvider.viewType,
        stepAudioProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("codetour.updateImageColor", () => {
        // Color updates are handled via webview message passing in the gallery panel
      }),
      vscode.commands.registerCommand("codetour.pasteImageFromWebview", () => {
        // Paste is handled via webview message passing in both panels
      }),
      vscode.commands.registerCommand("codetour.focusAudioPlayer", (index?: number) => {
        imageGalleryProvider.focusAudio(index ?? 0);
        vscode.commands.executeCommand("codetourEnhanced.imageGallery.focus");
      })
    );
    console.log("CodeTour: Step Images, Step Audio, and Step Media providers registered");

    // Initialize tour sorting and filtering preferences
    const initializePreferences = () => {
      const config = vscode.workspace.getConfiguration("codetour");
      const savedSortMode = config.get("tourSortMode", "name-asc");
      const savedFilter = config.get("tourFilter", { isActive: false });
      
      // Set initial values without triggering watchers
      store.tourSortMode = savedSortMode as any;
      store.tourFilter = savedFilter as any;

      // Set up context for UI elements
      vscode.commands.executeCommand(
        "setContext", 
        "codetour:hasActiveFilter", 
        store.tourFilter.isActive
      );
    };

    // Initialize preferences after a short delay to avoid conflicts with tour discovery
    setTimeout(initializePreferences, 200);

    // Watch for external configuration changes (not our own updates)
    let configUpdateInProgress = false;
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (configUpdateInProgress) return;
        
        if (e.affectsConfiguration("codetour.tourSortMode") || e.affectsConfiguration("codetour.tourFilter")) {
          configUpdateInProgress = true;
          setTimeout(() => {
            const config = vscode.workspace.getConfiguration("codetour");
            if (e.affectsConfiguration("codetour.tourSortMode")) {
              const newSortMode = config.get("tourSortMode", "name-asc");
              store.tourSortMode = newSortMode as any;
            }
            if (e.affectsConfiguration("codetour.tourFilter")) {
              const newFilter = config.get("tourFilter", { isActive: false });
              store.tourFilter = newFilter as any;
              vscode.commands.executeCommand(
                "setContext", 
                "codetour:hasActiveFilter", 
                store.tourFilter.isActive
              );
            }
            configUpdateInProgress = false;
          }, 50);
        }
      })
    );

    const uriHandler = new URIHandler();
    context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

  if (vscode.workspace.workspaceFolders) {
    await discoverTours();

    if (!uriHandler.didStartDefaultTour) {
      promptForTour(context.globalState);
    }

    initializeGitApi();
  }

  console.log("CodeTour: Activation completed successfully");
  return initializeApi(context);
  
  } catch (error) {
    console.error("CodeTour: Extension activation failed:", error);
    vscode.window.showErrorMessage(`CodeTour activation failed: ${error}`);
    throw error;
  }
}
