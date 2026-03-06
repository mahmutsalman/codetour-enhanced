// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import {
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Uri
} from "vscode";
import { EXTENSION_NAME } from "../../constants";
import { CodeTour, store } from "../../store";
import { progress } from "../../store/storage";
import { getFileUri, getStepLabel, getWorkspaceUri } from "../../utils";

/**
 * Tree node representing a workspace folder in multi-root workspaces.
 * Groups tours belonging to a specific workspace folder.
 */
export class WorkspaceFolderNode extends TreeItem {
  constructor(
    public readonly workspaceFolder: vscode.WorkspaceFolder,
    public readonly tours: CodeTour[]
  ) {
    super(workspaceFolder.name, TreeItemCollapsibleState.Expanded);

    this.contextValue = "codetour.workspaceFolder";
    this.iconPath = new ThemeIcon("folder-library");
    this.description = `${tours.length} tour${tours.length !== 1 ? "s" : ""}`;
    this.tooltip = `${workspaceFolder.name} - ${tours.length} tour${tours.length !== 1 ? "s" : ""}`;

    // Set resource URI for identification
    this.resourceUri = workspaceFolder.uri;
  }
}

function isRecording(tour: CodeTour) {
  return (
    store.isRecording &&
    store.activeTour &&
    store.activeTour.tour.id === tour.id
  );
}

const completeIcon = new ThemeIcon(
  "check",
  // @ts-ignore
  new ThemeColor("terminal.ansiGreen")
);

export class CodeTourNode extends TreeItem {
  constructor(public tour: CodeTour, extensionPath: string) {
    super(
      tour.title!,
      isRecording(tour)
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.Collapsed
    );

    this.tooltip = tour.description;
    this.description = `${tour.steps.length} steps`;

    const contextValues = ["codetour.tour"];

    if (tour.isPrimary) {
      contextValues.push("primary");
      this.description += " (Primary)";
    }

    if (isRecording(tour)) {
      contextValues.push("recording");
    }

    const isActive = store.activeTour && tour.id === store.activeTour?.tour.id;
    if (isActive) {
      contextValues.push("active");
    }

    this.contextValue = contextValues.join(".");

    this.iconPath = isRecording(tour)
      ? new ThemeIcon("record")
      : isActive
      ? new ThemeIcon("play-circle")
      : progress.isComplete(tour)
      ? completeIcon
      : new ThemeIcon("location");
  }
}

export class CodeTourNotesNode extends TreeItem {
  constructor(public tour: CodeTour) {
    super("Tour Notes");

    this.iconPath = new ThemeIcon("notebook");
    this.contextValue = "codetour.tourNotes";

    // Build description summary
    const note = tour.parentNote;
    if (note) {
      const parts: string[] = [];
      const hasText = (note.description && note.description.trim().length > 0) ||
                      (note.richDescription && note.richDescription.html && note.richDescription.html.trim().length > 0);
      if (hasText) parts.push("text");
      if (note.images && note.images.length > 0) parts.push(`${note.images.length} img`);
      if (note.audios && note.audios.length > 0) parts.push(`${note.audios.length} audio`);
      this.description = parts.length > 0 ? parts.join(", ") : "empty";
    } else {
      this.description = "empty";
    }

    const isActive = store.activeTour && store.activeTour.tour.id === tour.id && store.viewingParentNote;
    if (isActive) {
      this.iconPath = new ThemeIcon("notebook-render-output");
    }

    this.command = {
      command: `${EXTENSION_NAME}.viewParentNote`,
      title: "View Tour Notes",
      arguments: [tour]
    };
  }
}

export class CodeTourStepNode extends TreeItem {
  constructor(public tour: CodeTour, public stepNumber: number) {
    super(getStepLabel(tour, stepNumber));

    const step = tour.steps[stepNumber];

    let workspaceRoot, tours;
    if (store.activeTour && store.activeTour.tour.id === tour.id) {
      workspaceRoot = store.activeTour.workspaceRoot;
      tours = store.activeTour.tours;
    }

    this.command = {
      command: `${EXTENSION_NAME}.startTour`,
      title: "Start Tour",
      arguments: [tour, stepNumber, workspaceRoot, tours]
    };

    // Set resourceUri to the .tour file so drag-to-terminal pastes the tour path
    this.resourceUri = Uri.parse(tour.id);

    const isActive =
      store.activeTour &&
      tour.id === store.activeTour?.tour.id &&
      store.activeTour.step === stepNumber;

    if (isActive) {
      this.iconPath = new ThemeIcon("play-circle");
    } else if (progress.isComplete(tour, stepNumber)) {
      // @ts-ignore
      this.iconPath = completeIcon;
    } else if (step.icon) {
      if (step.icon.startsWith('.')) {
        const resourceRoot = workspaceRoot
          ? workspaceRoot
          : getWorkspaceUri(tour);
          
          this.iconPath = getFileUri(step.icon, resourceRoot);
      } else {
        try {
          const uri = Uri.parse(step.icon, true);
          
          this.iconPath = uri;
        } catch {
          const data = step.icon.split(',');
          if (data.length > 1) {
            this.iconPath = new ThemeIcon(data[0], new ThemeColor(data[1]));
          } else {
            this.iconPath = new ThemeIcon(data[0]);
          }
        }
      }
    } else if (step.directory) {
      this.iconPath = ThemeIcon.Folder;
    } else {
      this.iconPath = ThemeIcon.File;
    }

    const contextValues = ["codetour.tourStep"];
    if (stepNumber > 0) {
      contextValues.push("hasPrevious");
    }

    if (stepNumber < tour.steps.length - 1) {
      contextValues.push("hasNext");
    }

    this.contextValue = contextValues.join(".");
  }
}
