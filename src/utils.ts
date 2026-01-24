// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as os from "os";
import * as path from "path";
import { Uri, workspace } from "vscode";
import { CONTENT_URI, FS_SCHEME } from "./constants";
import { api } from "./git";
import { CodeTour, CodeTourStep, store } from "./store";

const HEADING_PATTERN = /^#+\s*(.*)/;
export function getStepLabel(
  tour: CodeTour,
  stepNumber: number,
  includeStepNumber: boolean = true,
  defaultToFileName: boolean = true
) {
  const step = tour.steps[stepNumber];

  const prefix = includeStepNumber ? `#${stepNumber + 1} - ` : "";
  let label = "";
  if (step.title) {
    label = step.title;
  } else if (HEADING_PATTERN.test(step.description.trim())) {
    label = step.description.trim().match(HEADING_PATTERN)![1];
  } else if (step.markerTitle) {
    label = step.markerTitle;
  } else if (defaultToFileName) {
    label = step.uri
      ? step.uri!
      : decodeURIComponent(step.directory || step.file!);
  }

  return `${prefix}${label}`;
}

export function getTourTitle(tour: CodeTour) {
  if (tour.title.match(/^#?\d+\s-/)) {
    return tour.title.split("-")[1].trim();
  }

  return tour.title;
}

export function getRelativePath(root: string, filePath: string) {
  let relativePath = path.relative(root, filePath);

  if (os.platform() === "win32") {
    relativePath = relativePath.replace(/\\/g, "/");
  }

  return relativePath;
}

export async function readUriContents(uri: Uri) {
  const bytes = await workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}

export function getFileUri(file: string, workspaceRoot?: Uri) {
  if (!workspaceRoot) {
    return Uri.parse(file);
  }

  return Uri.joinPath(workspaceRoot, file);
  //return appendUriPath(workspaceRoot, file);
}

export async function getStepFileUri(
  step: CodeTourStep,
  workspaceRoot?: Uri,
  ref?: string
): Promise<Uri> {
  let uri;
  if (step.contents) {
    uri = Uri.parse(`${FS_SCHEME}://current/${step.file}`);
  } else if (step.uri || step.file) {
    uri = step.uri
      ? Uri.parse(step.uri)
      : getFileUri(step.file!, workspaceRoot);

    if (api && ref && ref !== "HEAD") {
      const repo = api.getRepository(uri);

      if (
        repo &&
        repo.state.HEAD &&
        repo.state.HEAD.name !== ref && // The tour refs the user's current branch
        repo.state.HEAD.commit !== ref && // The tour refs the user's HEAD commit
        repo.state.HEAD.commit !== // The tour refs a branch/tag that points at the user's HEAD commit
          repo.state.refs.find(gitRef => gitRef.name === ref)?.commit
      ) {
        uri = await api.toGitUri(uri, ref);
      }
    }
  } else {
    uri = CONTENT_URI;
  }

  return uri;
}

export function getActiveWorkspacePath() {
  return store.activeTour!.workspaceRoot?.path || "";
}

export function getWorkspaceKey() {
  return workspace.workspaceFile || workspace.workspaceFolders![0].uri;
}

export function getWorkspacePath(tour: CodeTour) {
  return getWorkspaceUri(tour)?.toString() || "";
}

/**
 * Gets the workspace URI for a tour.
 * In multi-root workspaces, this uses the tour's workspace metadata if available,
 * otherwise tries to resolve from the tour's file location.
 *
 * IMPORTANT: Does NOT fallback to workspaceFolders[0] to avoid cross-workspace issues.
 */
export function getWorkspaceUri(tour: CodeTour): Uri | undefined {
  // First, try to use the tour's workspace folder metadata (for multi-root support)
  if (tour.workspaceFolderUri) {
    return Uri.parse(tour.workspaceFolderUri);
  }

  // Fall back to resolving from tour file location
  const tourUri = Uri.parse(tour.id);
  const workspaceFolder = workspace.getWorkspaceFolder(tourUri);

  if (workspaceFolder) {
    return workspaceFolder.uri;
  }

  // In single-workspace scenarios, use the only workspace folder
  if (workspace.workspaceFolders?.length === 1) {
    return workspace.workspaceFolders[0].uri;
  }

  // Cannot determine workspace - return undefined rather than guessing
  return undefined;
}

/**
 * Validates that a tour's workspace folder still exists and is accessible.
 * Returns true if the tour can be safely started/played.
 */
export function validateTourWorkspace(tour: CodeTour): boolean {
  // If tour has workspace metadata, verify the folder still exists
  if (tour.workspaceFolderUri) {
    const folderExists = workspace.workspaceFolders?.some(
      folder => folder.uri.toString() === tour.workspaceFolderUri
    );
    return !!folderExists;
  }

  // Try to resolve workspace from tour ID
  const tourUri = Uri.parse(tour.id);
  const workspaceFolder = workspace.getWorkspaceFolder(tourUri);

  if (workspaceFolder) {
    return true;
  }

  // In single workspace, assume it's valid
  if (workspace.workspaceFolders?.length === 1) {
    return true;
  }

  // Cannot validate - workspace is unknown
  return false;
}

function getTourNumber(tour: CodeTour): number | undefined {
  const match = tour.title.match(/^#?(\d+)\s+-/);
  if (match) {
    return Number(match[1]);
  }
}

export function getActiveTourNumber(): number | undefined {
  return getTourNumber(store.activeTour!.tour);
}

function getStepMarkerPrefix(tour: CodeTour): string | undefined {
  if (tour.stepMarker) {
    return tour.stepMarker;
  } else {
    const tourNumber = getTourNumber(tour);
    if (tourNumber) {
      return `CT${tourNumber}`;
    }
  }
}

function getActiveStepMarkerPrefix(): string | undefined {
  return getStepMarkerPrefix(store.activeTour!.tour);
}

export function getActiveStepMarker(): string | undefined {
  if (!isMarkerStep(store.activeTour!.tour, store.activeTour!.step)) {
    return;
  }

  const prefix = getActiveStepMarkerPrefix();
  const suffix = `.${store.activeTour!.step + 1}`;
  return `${prefix}${suffix}`;
}

export async function getStepMarkerForLine(uri: Uri, lineNumber: number) {
  const document = await workspace.openTextDocument(uri);
  const line = document.lineAt(lineNumber).text;

  const stepMarkerPrefix = getActiveStepMarkerPrefix();
  const match = line.match(new RegExp(`${stepMarkerPrefix}.(\\d+)`));
  if (match) {
    return Number(match[1]);
  }
}

function isMarkerTour(tour: CodeTour): boolean {
  return !!getStepMarkerPrefix(tour);
}

function isMarkerStep(tour: CodeTour, stepNumber: number) {
  const step = tour.steps[stepNumber];
  return getStepMarkerPrefix(tour) && step.file && !step.line;
}

async function updateMarkerTitleForStep(tour: CodeTour, stepNumber: number) {
  if (!isMarkerStep(tour, stepNumber)) {
    return;
  }

  const uri = await getStepFileUri(
    tour.steps[stepNumber],
    getWorkspaceUri(tour),
    tour.ref
  );

  const document = await workspace.openTextDocument(uri);
  const stepMarkerPrefix = getStepMarkerPrefix(tour);

  const markerPattern = new RegExp(
    `${stepMarkerPrefix}\\.${stepNumber + 1}\\s*[-:]\\s*(.*)`
  );

  const match = document.getText().match(markerPattern);
  if (match) {
    tour.steps[stepNumber].markerTitle = match[1];
  }
}

async function updateMarkerTitlesForTour(tour: CodeTour) {
  if (!isMarkerTour(tour)) {
    return;
  }

  tour.steps.forEach((_, index) => updateMarkerTitleForStep(tour, index));
}

export async function updateMarkerTitles() {
  store.tours.forEach(updateMarkerTitlesForTour);
}
