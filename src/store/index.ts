// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { observable } from "mobx";
import { CommentThread, Uri } from "vscode";

export interface CodeTourStepPosition {
  line: number;
  character: number;
}

export interface CodeTourStepImage {
  id: string;                    // unique identifier
  filename: string;              // original filename  
  path: string;                  // relative path from workspace
  thumbnail?: string;            // thumbnail path
  caption?: string;              // optional description
  color?: string;                // color tag (green/blue/purple/red)
  size: number;                  // file size in bytes
  dimensions: {width: number; height: number};
  created: number;              // timestamp
}

export interface CodeTourStepAudio {
  id: string;                    // unique identifier
  filename: string;              // original filename
  path: string;                  // relative path from workspace
  duration: number;              // duration in seconds
  size: number;                  // file size in bytes
  format: string;                // audio format (webm, mp3, etc.)
  created: number;               // timestamp
  transcript?: string;           // optional transcription
  caption?: string;              // optional description
}

export interface CodeTourStep {
  title?: string;
  description: string;
  icon?: string;

  // If any of the following are set, then only
  // one of them can be, since these properties
  // indicate the "type" of step.
  file?: string;
  directory?: string;
  contents?: string;
  uri?: string;
  view?: string;

  // A line number and selection is only relevant for file-based
  // steps. And even then, they're optional. If a file-based step
  // doesn't have a line number, then the description is attached
  // to the last line in the file, assuming it's describing the file itself
  line?: number;
  selection?: { start: CodeTourStepPosition; end: CodeTourStepPosition };

  commands?: string[];

  pattern?: string;
  markerTitle?: string;
  
  // NEW: Image attachments for this step
  images?: CodeTourStepImage[];
  
  // NEW: Audio attachments for this step
  audios?: CodeTourStepAudio[];

  // Rich text content (Quill.js Delta + pre-rendered HTML)
  richDescription?: {
    delta: any;    // Quill Delta JSON (source of truth)
    html: string;  // Pre-rendered HTML for quick display
  };
}

export interface CodeTour {
  id: string;
  title: string;
  description?: string;
  steps: CodeTourStep[];
  ref?: string;
  isPrimary?: boolean;
  nextTour?: string;
  stepMarker?: string;
  when?: string;
  createdAt?: number;
  updatedAt?: number;

  // Multi-root workspace support: workspace folder this tour belongs to
  workspaceFolderUri?: string;    // URI of the workspace folder
  workspaceFolderName?: string;   // Display name of the workspace folder
}

export interface ActiveTour {
  tour: CodeTour;
  step: number;

  // When recording, a tour can be active, without
  // having created an actual comment yet.
  thread: CommentThread | null | undefined;

  // In order to resolve relative file
  // paths, we need to know the workspace root
  workspaceRoot?: Uri;

  // In order to resolve inter-tour
  // links, the active tour might need
  // the context of its sibling tours, if
  // they're coming from somewhere other
  // then the active workspace (e.g. a
  // GistPad-managed repo).
  tours?: CodeTour[];
}

type CodeTourProgress = [string, number[]];
export type CodeTourStepTuple = [CodeTour, CodeTourStep, number, number?];

export type TourSortMode = 
  | "name-asc" 
  | "name-desc" 
  | "created-asc" 
  | "created-desc" 
  | "updated-asc" 
  | "updated-desc" 
  | "steps-asc" 
  | "steps-desc";

export interface TourFilter {
  pattern?: string;
  isActive: boolean;
}

export interface Store {
  tours: CodeTour[];
  activeTour: ActiveTour | null;
  activeEditorSteps?: CodeTourStepTuple[];
  hasTours: boolean;
  isRecording: boolean;
  isEditing: boolean;
  isAudioRecording: boolean;
  showMarkers: boolean;
  progress: CodeTourProgress[];
  tourSortMode: TourSortMode;
  tourFilter: TourFilter;
  extensionUri?: Uri;
}

export const store: Store = observable({
  tours: [],
  activeTour: null,
  isRecording: false,
  isEditing: false,
  isAudioRecording: false,
  get hasTours() {
    return this.tours.length > 0;
  },
  showMarkers: false,
  progress: [],
  tourSortMode: "name-asc",
  tourFilter: { isActive: false }
});
