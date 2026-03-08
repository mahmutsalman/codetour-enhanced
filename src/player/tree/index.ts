// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { reaction } from "mobx";
import * as vscode from "vscode";
import {
  DataTransfer,
  DataTransferItem,
  Disposable,
  Event,
  EventEmitter,
  MarkdownString,
  TreeDataProvider,
  TreeDragAndDropController,
  TreeItem,
  Uri,
  window,
  workspace
} from "vscode";
import { EXTENSION_NAME, TOURS_VIEW_ID } from "../../constants";
import { generatePreviewContent } from "..";
import { store, CodeTour, Topic } from "../../store";
import { assignTourToTopic } from "../../store/topics";
import { CodeTourNode, CodeTourNotesNode, CodeTourStepNode, TopicNode, WorkspaceFolderNode } from "./nodes";

class CodeTourTreeProvider implements TreeDataProvider<TreeItem>, TreeDragAndDropController<TreeItem>, Disposable {
  private _disposables: Disposable[] = [];

  private _onDidChangeTreeData = new EventEmitter<TreeItem | undefined>();

  // TreeDragAndDropController
  readonly dropMimeTypes: string[] = ["text/uri-list"];
  readonly dragMimeTypes: string[] = ["text/uri-list", "text/plain"];
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

  /**
   * Gets topics for a specific workspace folder from the store
   */
  private getTopicsForWorkspace(folderUri: string): Topic[] {
    return store.topics.filter(t => t.workspaceFolderUri === folderUri);
  }

  /**
   * Gets processed tours assigned to a specific topic within a workspace folder
   */
  private getToursForTopic(topicName: string, folderUri: string, tours: CodeTour[]): CodeTour[] {
    return tours.filter(t => t.topic === topicName && t.workspaceFolderUri === folderUri);
  }

  /**
   * Gets processed tours not assigned to any topic within a workspace folder
   */
  private getUnassignedTours(folderUri: string, tours: CodeTour[]): CodeTour[] {
    return tours.filter(t => t.workspaceFolderUri === folderUri && !t.topic);
  }

  /**
   * Builds the list of TopicNodes (with their tours) followed by unassigned CodeTourNodes.
   * When a filter is active, topics with no matching tours are hidden.
   * Empty topics are visible when no filter is active.
   */
  private buildTopicAndUnassignedNodes(
    folderUri: string,
    processedTours: CodeTour[]
  ): TreeItem[] {
    const topics = this.getTopicsForWorkspace(folderUri);
    const result: TreeItem[] = [];

    for (const topic of topics) {
      const topicTours = this.getToursForTopic(topic.name, folderUri, processedTours);

      // When filter is active, hide topics with no matching tours
      if (store.tourFilter.isActive && topicTours.length === 0) {
        continue;
      }

      result.push(new TopicNode(topic.name, topicTours, folderUri));
    }

    // Unassigned tours appear directly at this level
    const unassigned = this.getUnassignedTours(folderUri, processedTours);
    result.push(...unassigned.map(t => new CodeTourNode(t, this.extensionPath)));

    return result;
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
          tour.workspaceFolderUri,
          tour.topic ?? "",
          tour.parentNote?.description ?? "",
          tour.parentNote?.images?.length ?? 0,
          tour.parentNote?.audios?.length ?? 0
        ]),
        store.topics.map(t => [t.name, t.workspaceFolderUri]),
        store.isRecording,
        store.viewingParentNote,
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
          .filter(node => node.tours.length > 0);

        if (folderNodes.length > 0) {
          return folderNodes;
        }

        return processedTours.map(
          tour => new CodeTourNode(tour, this.extensionPath)
        );
      }

      // Single workspace: topics + unassigned tours
      const folderUri = workspace.workspaceFolders?.[0]?.uri.toString() ?? "";
      if (store.topics.some(t => t.workspaceFolderUri === folderUri)) {
        return this.buildTopicAndUnassignedNodes(folderUri, processedTours);
      }

      // No topics defined — flat list (original behavior)
      return processedTours.map(
        tour => new CodeTourNode(tour, this.extensionPath)
      );
    } else if (element instanceof WorkspaceFolderNode) {
      const folderUri = element.workspaceFolder.uri.toString();
      const processedTours = this.processTours(element.tours);

      // Check if this workspace folder has topics defined
      if (store.topics.some(t => t.workspaceFolderUri === folderUri)) {
        return this.buildTopicAndUnassignedNodes(folderUri, processedTours);
      }

      if (processedTours.length === 0) {
        const item = new TreeItem("No tours in this folder");
        return [item];
      }
      return processedTours.map(
        tour => new CodeTourNode(tour, this.extensionPath)
      );
    } else if (element instanceof TopicNode) {
      if (element.tours.length === 0) {
        const item = new TreeItem("No tours in this topic");
        return [item];
      }
      return element.tours.map(t => new CodeTourNode(t, this.extensionPath));
    } else if (element instanceof CodeTourNode) {
      const children: TreeItem[] = [];

      // Always prepend Tour Notes node
      children.push(new CodeTourNotesNode(element.tour));

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

        children.push(item);
      } else {
        children.push(...element.tour.steps.map(
          (_, index) => new CodeTourStepNode(element.tour, index)
        ));
      }

      return children;
    }
  }

  async getParent(element: TreeItem): Promise<TreeItem | null> {
    if (element instanceof CodeTourNotesNode) {
      return new CodeTourNode(element.tour, this.extensionPath);
    } else if (element instanceof CodeTourStepNode) {
      return new CodeTourNode(element.tour, this.extensionPath);
    } else if (element instanceof CodeTourNode && element.tour.topic) {
      // Tour is inside a topic — parent is the TopicNode
      const folderUri = element.tour.workspaceFolderUri ?? "";
      const topicTours = store.tours.filter(
        t => t.topic === element.tour.topic && t.workspaceFolderUri === folderUri
      );
      return new TopicNode(element.tour.topic, topicTours, folderUri);
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

  handleDrag(source: readonly TreeItem[], dataTransfer: DataTransfer): void {
    const tourIds = new Set<string>();
    const stepTexts: string[] = [];

    for (const item of source) {
      if (item instanceof CodeTourNode) {
        tourIds.add(item.tour.id);
      } else if (item instanceof CodeTourStepNode) {
        const tourUri = Uri.parse(item.tour.id);
        const stepNumber = item.stepNumber + 1; // 1-based
        stepTexts.push(`${tourUri.fsPath}:${stepNumber}`);
      }
    }

    if (stepTexts.length > 0) {
      dataTransfer.set("text/plain", new DataTransferItem(stepTexts.join("\n")));
    } else {
      if (tourIds.size === 0) return;
      const uris = [...tourIds].map(id => Uri.parse(id));
      const fsPaths = uris.map(uri => uri.fsPath);
      dataTransfer.set(
        "text/uri-list",
        new DataTransferItem(uris.map(u => u.toString()).join("\r\n"))
      );
      dataTransfer.set("text/plain", new DataTransferItem(fsPaths.join("\n")));
    }
  }

  async handleDrop(target: TreeItem | undefined, dataTransfer: DataTransfer): Promise<void> {
    if (!(target instanceof TopicNode)) {
      return;
    }

    const item = dataTransfer.get("text/uri-list");
    if (!item) {
      return;
    }

    const uriList = item.value as string;
    const uriStrings = uriList.split(/\r?\n/).filter(s => s.trim());

    for (const uriStr of uriStrings) {
      const tour = store.tours.find(
        t => t.id === uriStr || t.id === decodeURIComponent(uriStr)
      );
      if (tour) {
        await assignTourToTopic(tour, target.topicName);
      }
    }
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
    canSelectMany: true,
    dragAndDropController: treeDataProvider
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
