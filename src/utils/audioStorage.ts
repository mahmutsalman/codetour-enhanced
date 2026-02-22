// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import { Uri, workspace } from "vscode";
import { CodeTour, CodeTourStepAudio } from "../store";
import { getActiveWorkspacePath } from "../utils";
import { Buffer } from "buffer";

const AUDIOS_FOLDER = ".tours/audio";

/**
 * Generates the audio storage path for a specific tour and step
 */
export function getAudioStoragePath(tourTitle: string, stepIndex: number): string {
  const sanitizedTourTitle = sanitizeTourName(tourTitle);
  const stepFolder = `step-${String(stepIndex + 1).padStart(2, '0')}`;
  return path.join(AUDIOS_FOLDER, sanitizedTourTitle, stepFolder);
}

/**
 * Sanitizes tour title for use as folder name
 */
function sanitizeTourName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generates a unique filename for an audio recording
 */
export function generateAudioFilename(format: string = 'webm'): string {
  const timestamp = Date.now();
  return `audio-${timestamp}.${format}`;
}

/**
 * Gets the workspace-relative path for an audio file
 */
export function getAudioWorkspacePath(tourTitle: string, stepIndex: number, filename: string): string {
  const storagePath = getAudioStoragePath(tourTitle, stepIndex);
  return path.join(storagePath, filename);
}

/**
 * Creates the audio storage directory if it doesn't exist
 */
export async function ensureAudioStorageDirectory(tourTitle: string, stepIndex: number): Promise<Uri> {
  const workspacePathString = getActiveWorkspacePath();
  const workspacePath = Uri.file(workspacePathString);
  const storagePath = getAudioStoragePath(tourTitle, stepIndex);
  const storageUri = Uri.joinPath(workspacePath, storagePath);
  
  try {
    await workspace.fs.stat(storageUri);
  } catch {
    // Directory doesn't exist, create it
    await workspace.fs.createDirectory(storageUri);
  }
  
  return storageUri;
}

/**
 * Saves audio data to the tour's audio storage
 */
export async function saveAudioRecording(
  audioData: Uint8Array,
  tourTitle: string,
  stepIndex: number,
  duration: number,
  format: string = 'webm'
): Promise<CodeTourStepAudio> {
  const filename = generateAudioFilename(format);
  const storageDir = await ensureAudioStorageDirectory(tourTitle, stepIndex);
  const audioUri = Uri.joinPath(storageDir, filename);
  
  // Save the audio file
  await workspace.fs.writeFile(audioUri, audioData);
  
  const workspacePath = getAudioWorkspacePath(tourTitle, stepIndex, filename);
  
  const audioMetadata: CodeTourStepAudio = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    filename,
    path: workspacePath,
    duration,
    size: audioData.length,
    format,
    created: Date.now()
  };
  
  return audioMetadata;
}

/**
 * Deletes an audio file from storage
 */
export async function deleteAudio(
  audio: CodeTourStepAudio,
  workspaceUri: Uri
): Promise<void> {
  try {
    const audioUri = Uri.joinPath(workspaceUri, audio.path);
    await workspace.fs.delete(audioUri);
  } catch (error) {
    console.warn('Failed to delete audio file:', error);
  }
}

/**
 * Cleans up all audio files for a specific step
 */
export async function cleanupStepAudios(
  tour: CodeTour,
  stepIndex: number
): Promise<void> {
  const step = tour.steps[stepIndex];
  if (!step.audios) return;
  
  const workspaceUri = workspace.getWorkspaceFolder(Uri.parse(tour.id))?.uri;
  if (!workspaceUri) return;
  
  for (const audio of step.audios) {
    await deleteAudio(audio, workspaceUri);
  }
}

/**
 * Cleans up all audio files for an entire tour
 */
export async function cleanupTourAudios(tour: CodeTour): Promise<void> {
  const workspaceUri = workspace.getWorkspaceFolder(Uri.parse(tour.id))?.uri;
  if (!workspaceUri) return;
  
  const tourAudioDir = Uri.joinPath(
    workspaceUri, 
    AUDIOS_FOLDER, 
    sanitizeTourName(tour.title)
  );
  
  try {
    await workspace.fs.delete(tourAudioDir, { recursive: true });
  } catch (error) {
    console.warn('Failed to cleanup tour audio files:', error);
  }
}

/**
 * Adds an audio recording to a tour step
 */
export async function addAudioToStep(
  tour: CodeTour,
  stepIndex: number,
  audioData: Uint8Array,
  duration: number,
  format: string = 'webm',
  transcript?: string
): Promise<CodeTourStepAudio> {
  const audioMetadata = await saveAudioRecording(audioData, tour.title, stepIndex, duration, format);
  
  if (transcript) {
    audioMetadata.transcript = transcript;
  }
  
  // Add audio to step
  const step = tour.steps[stepIndex];
  if (!step.audios) {
    step.audios = [];
  }
  step.audios.push(audioMetadata);
  
  return audioMetadata;
}

/**
 * Removes an audio recording from a tour step
 */
export async function removeAudioFromStep(
  tour: CodeTour,
  stepIndex: number,
  audioId: string
): Promise<void> {
  const step = tour.steps[stepIndex];
  if (!step.audios) return;
  
  const audioIndex = step.audios.findIndex(audio => audio.id === audioId);
  if (audioIndex === -1) return;
  
  const audio = step.audios[audioIndex];
  const workspaceUri = workspace.getWorkspaceFolder(Uri.parse(tour.id))?.uri;
  
  if (workspaceUri) {
    await deleteAudio(audio, workspaceUri);
  }
  
  // Remove from step
  step.audios.splice(audioIndex, 1);
  
  // Clean up empty audios array
  if (step.audios.length === 0) {
    delete step.audios;
  }
}

/**
 * Updates an audio's transcript
 */
export function updateAudioTranscript(
  tour: CodeTour,
  stepIndex: number,
  audioId: string,
  transcript?: string
): boolean {
  const step = tour.steps[stepIndex];
  if (!step.audios) return false;
  
  const audio = step.audios.find(a => a.id === audioId);
  if (!audio) return false;
  
  if (transcript) {
    audio.transcript = transcript;
  } else {
    delete audio.transcript;
  }
  
  return true;
}

/**
 * Gets audio file URI for playback
 */
export function getAudioUri(audio: CodeTourStepAudio, workspaceUri: Uri): Uri {
  return Uri.joinPath(workspaceUri, audio.path);
}

/**
 * Format duration in seconds to MM:SS format
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Gets the MIME type for an audio format
 */
export function getMimeType(format: string): string {
  switch (format.toLowerCase()) {
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mpeg';
    case 'ogg': return 'audio/ogg';
    case 'webm': return 'audio/webm';
    case 'm4a': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'flac': return 'audio/flac';
    default: return 'audio/wav';
  }
}

/**
 * Converts audio metadata to data URLs for webview playback
 */
export async function convertAudiosToDataUrls(audios: CodeTourStepAudio[]): Promise<{
  id: string; filename: string; duration: number; format: string;
  transcript?: string; dataUrl?: string;
}[]> {
  const workspaceUri = workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) return [];

  return Promise.all(audios.map(async (audio) => {
    try {
      const audioUri = getAudioUri(audio, workspaceUri);
      const audioData = await workspace.fs.readFile(audioUri);
      const base64 = Buffer.from(audioData).toString('base64');
      const mimeType = getMimeType(audio.format);
      return {
        id: audio.id,
        filename: audio.filename,
        duration: audio.duration,
        format: audio.format,
        transcript: audio.transcript,
        dataUrl: `data:${mimeType};base64,${base64}`
      };
    } catch {
      return {
        id: audio.id,
        filename: audio.filename,
        duration: audio.duration,
        format: audio.format,
        transcript: audio.transcript
      };
    }
  }));
}