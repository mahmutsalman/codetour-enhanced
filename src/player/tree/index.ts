// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { reaction } from "mobx";
import * as vscode from "vscode";
import {
  Disposable,
  Event,
  EventEmitter,
  MarkdownString,
  TreeDataProvider,
  TreeItem,
  window,
  workspace
} from "vscode";
import { EXTENSION_NAME, TOURS_VIEW_ID } from "../../constants";
import { generatePreviewContent } from "..";
import { store, CodeTour } from "../../store";
import { CodeTourNode, CodeTourStepNode, WorkspaceFolderNode } from "./nodes";

class CodeTourTreeProvider implements TreeDataProvider<TreeItem>, Disposable {
  private _disposables: Disposable[] = [];

  private _onDidChangeTreeData = new EventEmitter<TreeItem | undefined>();
  public readonly onDidChangeTreeData: Event<TreeItem | undefined> = this
    ._onDidChangeTreeData.event;

  private sortTours(tours: CodeTour[]): CodeTour[] {
    const sorted = [...tours];
    
    switch (store.tourSortMode) {
      case "name-asc":
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case "name-desc":
        return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case "created-asc":
        return sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      case "created-desc":
        return sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      case "updated-asc":
        return sorted.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
      case "updated-desc":
        return sorted.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      case "steps-asc":
        return sorted.sort((a, b) => a.steps.length - b.steps.length);
      case "steps-desc":
        return sorted.sort((a, b) => b.steps.length - a.steps.length);
      default:
        return sorted;
    }
  }

  private filterTours(tours: CodeTour[]): CodeTour[] {
    if (!store.tourFilter.isActive || !store.tourFilter.pattern) {
      return tours;
    }

    const pattern = store.tourFilter.pattern.toLowerCase();
    return tours.filter(tour => 
      tour.title.toLowerCase().includes(pattern) ||
      (tour.description && tour.description.toLowerCase().includes(pattern))
    );
  }

  private processTours(tours: CodeTour[]): CodeTour[] {
    const filtered = this.filterTours(tours);
    return this.sortTours(filtered);
  }

  /**
   * Returns true if this is a multi-root workspace (more than one folder)
   */
  private isMultiRootWorkspace(): boolean {
    return (workspace.workspaceFolders?.length ?? 0) > 1;
  }

  /**
   * Gets tours belonging to a specific workspace folder
   */
  private getToursForWorkspace(workspaceFolder: vscode.WorkspaceFolder, tours: CodeTour[]): CodeTour[] {
    const folderUri = workspaceFolder.uri.toString();
    return tours.filter(tour => tour.workspaceFolderUri === folderUri);
  }

  constructor(private extensionPath: string) {
    reaction(
      () => [
        store.tours.map(tour => [
          tour.id,
          tour.title,
          tour.description,
          tour.steps?.length ?? 0,
          tour.isPrimary ?? false,
          tour.when,
          tour.createdAt,
          tour.updatedAt,
          tour.workspaceFolderUri
        ]),
        store.isRecording,
        store.tourSortMode,
        store.tourFilter.isActive,
        store.tourFilter.pattern,
        store.progress.map(([id, completedSteps]) => [
          id,
          completedSteps.map(step => step)
        ]),
        store.activeTour
          ? [
              store.activeTour.tour.title,
              store.activeTour.tour.description,
              store.activeTour.tour.steps.map(step => [
                step.title,
                step.markerTitle,
                step.description
              ])
            ]
          : null
      ],
      () => {
        this._onDidChangeTreeData.fire(undefined);
      }
    );
  }

  getTreeItem = (node: TreeItem) => node;

  async getChildren(element?: TreeItem): Promise<TreeItem[] | undefined> {
    if (!element) {
      if (!store.hasTours && !store.activeTour) {
        return undefined;
      }

      // Start with all tours
      let allTours = [...store.tours];

      // Add active tour if it's not in the list
      if (
        store.activeTour &&
        !store.tours.find(tour => tour.id === store.activeTour?.tour.id)
      ) {
        allTours.unshift(store.activeTour.tour);
      }

      // Apply filtering and sorting
      const processedTours = this.processTours(allTours);

      if (processedTours.length === 0) {
        const filterPattern =
          store.tourFilter.isActive && store.tourFilter.pattern
            ? store.tourFilter.pattern.trim()
            : "";

        if (filterPattern) {
          const item = new TreeItem(`No tours match filter: ${filterPattern}`);
          item.iconPath = new vscode.ThemeIcon("filter");
          item.tooltip = "Clear the current tour filter";
          item.command = {
            command: `${EXTENSION_NAME}.clearTourFilter`,
            title: "Clear tour filter"
          };
          return [item];
        }

        if (store.hasTours || store.activeTour) {
          const item = new TreeItem("No tours to display");
          return [item];
        }
      }

      // Multi-root workspace: group tours by workspace folder
      if (this.isMultiRootWorkspace()) {
        const workspaceFolders = workspace.workspaceFolders || [];
        const folderNodes = workspaceFolders
          .map(folder => {
            const folderTours = this.getToursForWorkspace(folder, processedTours);
            return new WorkspaceFolderNode(folder, folderTours);
          })
          .filter(node => node.tours.length > 0); // Only show folders with tours

        if (folderNodes.length > 0) {
          return folderNodes;
        }

        return processedTours.map(
          tour => new CodeTourNode(tour, this.extensionPath)
        );
      }

      // Single workspace: flat list of tours (current behavior)
      return processedTours.map(
        tour => new CodeTourNode(tour, this.extensionPath)
      );
    } else if (element instanceof WorkspaceFolderNode) {
      // Return tours for this workspace folder
      if (element.tours.length === 0) {
        const item = new TreeItem("No tours in this folder");
        return [item];
      }
      return element.tours.map(
        tour => new CodeTourNode(tour, this.extensionPath)
      );
    } else if (element instanceof CodeTourNode) {
      if (element.tour.steps.length === 0) {
        let item;

        if (store.isRecording && store.activeTour?.tour.id == element.tour.id) {
          item = new TreeItem("Add tour step...");
          item.command = {
            command: "codetour.addContentStep",
            title: "Add tour step..."
          };
        } else {
          item = new TreeItem("No steps recorded");
        }

        return [item];
      } else {
        return element.tour.steps.map(
          (_, index) => new CodeTourStepNode(element.tour, index)
        );
      }
    }
  }

  async getParent(element: TreeItem): Promise<TreeItem | null> {
    if (element instanceof CodeTourStepNode) {
      return new CodeTourNode(element.tour, this.extensionPath);
    } else if (element instanceof CodeTourNode && this.isMultiRootWorkspace()) {
      // In multi-root workspaces, CodeTourNode's parent is the workspace folder
      const workspaceFolderUri = element.tour.workspaceFolderUri;
      if (workspaceFolderUri) {
        const workspaceFolder = workspace.workspaceFolders?.find(
          folder => folder.uri.toString() === workspaceFolderUri
        );
        if (workspaceFolder) {
          const folderTours = this.getToursForWorkspace(workspaceFolder, store.tours);
          return new WorkspaceFolderNode(workspaceFolder, folderTours);
        }
      }
      return null;
    } else {
      return null;
    }
  }

  // This is called whenever a tree item is hovered over, and we're
  // using it to generate preview tooltips for tour steps on-demand.
  async resolveTreeItem(element: TreeItem): Promise<TreeItem> {
    if (element instanceof CodeTourStepNode) {
      const content = generatePreviewContent(
        element.tour.steps[element.stepNumber].description
      );

      const tooltip = new MarkdownString(content);
      tooltip.isTrusted = true;

      // @ts-ignore
      element.tooltip = tooltip;
    }

    return element;
  }

  dispose() {
    this._disposables.forEach(disposable => disposable.dispose());
  }
}

export function registerTreeProvider(extensionPath: string) {
  const treeDataProvider = new CodeTourTreeProvider(extensionPath);
  const treeView = window.createTreeView(TOURS_VIEW_ID, {
    showCollapseAll: true,
    treeDataProvider,
    canSelectMany: true
  });

  let isRevealPending = false;
  treeView.onDidChangeVisibility(e => {
    if (e.visible && isRevealPending) {
      isRevealPending = false;
      revealCurrentStepNode();
    }
  });

  function revealCurrentStepNode() {
    setTimeout(() => {
      treeView.reveal(
        new CodeTourStepNode(store.activeTour!.tour, store.activeTour!.step)
      );
    }, 300);
  }

  reaction(
    () => [
      store.activeTour
        ? [
            store.activeTour.tour.title,
            store.activeTour.tour.steps.map(step => [step.title]),
            store.activeTour.step
          ]
        : null
    ],
    () => {
      if (store.activeTour && store.activeTour.step >= 0) {
        if (
          !treeView.visible ||
          store.activeTour.tour.steps[store.activeTour.step].view
        ) {
          isRevealPending = true;
          return;
        }

        revealCurrentStepNode();
      } else {
        // TODO: Once VS Code supports it, we want
        // to de-select the step node once the tour ends.
        treeView.message = undefined;
      }
    }
  );
}
