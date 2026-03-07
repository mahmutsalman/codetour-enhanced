// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { runInAction } from "mobx";
import * as vscode from "vscode";
import { CodeTour, store, Topic } from ".";

const TOPICS_FILE = ".topics.json";

function getTopicsFileUri(workspaceFolderUri: string): vscode.Uri {
  const wsUri = vscode.Uri.parse(workspaceFolderUri);
  return vscode.Uri.joinPath(wsUri, ".tours", TOPICS_FILE);
}

export async function readTopicsFile(workspaceFolderUri: string): Promise<string[]> {
  try {
    const uri = getTopicsFileUri(workspaceFolderUri);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = new TextDecoder().decode(bytes);
    const data = JSON.parse(content);
    if (data.version === 1 && Array.isArray(data.topics)) {
      return data.topics as string[];
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return [];
}

async function writeTopicsFile(workspaceFolderUri: string, names: string[]): Promise<void> {
  const uri = getTopicsFileUri(workspaceFolderUri);
  const data = { version: 1, topics: names };
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  await vscode.workspace.fs.writeFile(uri, bytes);
}

/**
 * Write a tour's JSON back to disk (mirrors saveTour in recorder/commands.ts,
 * duplicated here to avoid a circular import chain).
 */
async function writeTourFile(tour: CodeTour): Promise<void> {
  const uri = vscode.Uri.parse(tour.id);
  const data: any = { $schema: "https://aka.ms/codetour-schema", ...tour };
  delete data.id;
  data.steps?.forEach((step: any) => {
    delete step.markerTitle;
  });
  if (data.parentNote) {
    const pn = data.parentNote;
    const hasContent =
      (pn.description && pn.description.trim()) ||
      (pn.richDescription?.html && pn.richDescription.html.trim()) ||
      (pn.images && pn.images.length > 0) ||
      (pn.audios && pn.audios.length > 0);
    if (!hasContent) {
      delete data.parentNote;
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  await vscode.workspace.fs.writeFile(uri, bytes);
}

export async function discoverTopics(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders || [];
  const allTopics: Topic[] = [];

  for (const folder of folders) {
    const folderUri = folder.uri.toString();
    const names = await readTopicsFile(folderUri);
    for (const name of names) {
      allTopics.push({ name, workspaceFolderUri: folderUri });
    }
  }

  runInAction(() => {
    store.topics = allTopics;
  });
}

export async function createTopic(name: string, workspaceFolderUri: string): Promise<void> {
  const existing = await readTopicsFile(workspaceFolderUri);
  if (existing.includes(name)) {
    vscode.window.showWarningMessage(`Topic "${name}" already exists.`);
    return;
  }
  const updated = [...existing, name];
  await writeTopicsFile(workspaceFolderUri, updated);
  await discoverTopics();
}

export async function renameTopic(
  oldName: string,
  newName: string,
  workspaceFolderUri: string
): Promise<void> {
  const existing = await readTopicsFile(workspaceFolderUri);
  if (!existing.includes(oldName)) {
    return;
  }
  if (existing.includes(newName)) {
    vscode.window.showWarningMessage(`Topic "${newName}" already exists.`);
    return;
  }
  const updated = existing.map(t => (t === oldName ? newName : t));
  await writeTopicsFile(workspaceFolderUri, updated);

  // Update all tours assigned to the old topic name
  const tours = store.tours.filter(
    t => t.topic === oldName && t.workspaceFolderUri === workspaceFolderUri
  );
  for (const tour of tours) {
    runInAction(() => {
      tour.topic = newName;
    });
    await writeTourFile(tour);
  }

  await discoverTopics();
}

export async function deleteTopic(name: string, workspaceFolderUri: string): Promise<void> {
  const existing = await readTopicsFile(workspaceFolderUri);
  const updated = existing.filter(t => t !== name);
  await writeTopicsFile(workspaceFolderUri, updated);

  // Clear topic from all assigned tours
  const tours = store.tours.filter(
    t => t.topic === name && t.workspaceFolderUri === workspaceFolderUri
  );
  for (const tour of tours) {
    runInAction(() => {
      tour.topic = undefined;
    });
    await writeTourFile(tour);
  }

  await discoverTopics();
}

export async function assignTourToTopic(
  tour: CodeTour,
  topicName: string | undefined
): Promise<void> {
  runInAction(() => {
    tour.topic = topicName;
  });
  await writeTourFile(tour);
}
