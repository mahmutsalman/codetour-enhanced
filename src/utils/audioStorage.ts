// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import { spawn } from "child_process";
import { Uri, workspace } from "vscode";
import { CodeTour, CodeTourStepAudio } from "../store";
import { getActiveWorkspacePath } from "../utils";
import { Buffer } from "buffer";

const AUDIOS_FOLDER = ".tours/audio";

/**
 * Generates the audio storage path for a specific tour and step
 */
export function getAudioStoragePath(tourTitle: string, stepIndex: number | 'tour-note'): string {
  const sanitizedTourTitle = sanitizeTourName(tourTitle);
  const stepFolder = stepIndex === 'tour-note' ? 'tour-note' : `step-${String(stepIndex + 1).padStart(2, '0')}`;
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
export function getAudioWorkspacePath(tourTitle: string, stepIndex: number | 'tour-note', filename: string): string {
  const storagePath = getAudioStoragePath(tourTitle, stepIndex);
  return path.join(storagePath, filename);
}

/**
 * Creates the audio storage directory if it doesn't exist
 */
export async function ensureAudioStorageDirectory(tourTitle: string, stepIndex: number | 'tour-note'): Promise<Uri> {
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
  stepIndex: number | 'tour-note',
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
  stepIndex: number | 'tour-note',
  audioData: Uint8Array,
  duration: number,
  format: string = 'webm',
  transcript?: string
): Promise<CodeTourStepAudio> {
  const audioMetadata = await saveAudioRecording(audioData, tour.title, stepIndex, duration, format);

  if (transcript) {
    audioMetadata.transcript = transcript;
  }

  if (stepIndex === 'tour-note') {
    if (!tour.parentNote) {
      tour.parentNote = { description: '' };
    }
    if (!tour.parentNote.audios) {
      tour.parentNote.audios = [];
    }
    tour.parentNote.audios.push(audioMetadata);
  } else {
    const step = tour.steps[stepIndex];
    if (!step.audios) {
      step.audios = [];
    }
    step.audios.push(audioMetadata);
  }

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
 * Updates an audio's caption
 */
export function updateAudioCaption(
  tour: CodeTour,
  stepIndex: number,
  audioId: string,
  caption?: string
): boolean {
  const step = tour.steps[stepIndex];
  if (!step.audios) return false;

  const audio = step.audios.find(a => a.id === audioId);
  if (!audio) return false;

  if (caption) {
    audio.caption = caption;
  } else {
    delete audio.caption;
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
  if (!seconds || !isFinite(seconds)) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Detects MIME type from the actual file bytes (magic numbers).
 * Returns null if the format is unrecognised.
 */
function sniffMimeType(data: Uint8Array): string | null {
  if (data.length < 8) return null;
  // WebM: 1A 45 DF A3
  if (data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3) return 'audio/webm';
  // MP4/M4A: ISO Base Media — 'ftyp' box at offset 4
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) return 'audio/mp4';
  // WAV: RIFF....WAVE
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'audio/wav';
  // OGG: OggS
  if (data[0] === 0x4F && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) return 'audio/ogg';
  // MP3: ID3 tag or MPEG sync
  if ((data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) ||
      (data[0] === 0xFF && (data[1] & 0xE0) === 0xE0)) return 'audio/mpeg';
  return null;
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
 * Transcodes audio data to WAV (PCM) using the system ffmpeg.
 *
 * VS Code's Electron build does not support WebM/Opus in the <audio> element
 * (MEDIA_ERR_SRC_NOT_SUPPORTED, code 4). WAV/PCM has no codec dependency and
 * plays reliably in all Electron/Chromium webviews.
 *
 * Uses stdin→stdout piping — no temp files required.
 * Returns null if ffmpeg is not available or transcoding fails.
 */
// Common ffmpeg locations — VS Code GUI on macOS does not inherit the shell PATH,
// so Homebrew-installed ffmpeg is invisible unless we probe known paths explicitly.
const FFMPEG_CANDIDATES = [
  '/opt/homebrew/bin/ffmpeg',  // macOS Apple Silicon (Homebrew)
  '/usr/local/bin/ffmpeg',     // macOS Intel (Homebrew) / Linux custom install
  '/usr/bin/ffmpeg',           // Linux system package
  'ffmpeg',                    // fallback: rely on PATH (works in some terminal launches)
];

async function findFfmpeg(): Promise<string | null> {
  const { execFile } = await import('child_process');
  for (const candidate of FFMPEG_CANDIDATES) {
    const found = await new Promise<boolean>((res) => {
      execFile(candidate, ['-version'], { timeout: 2000 }, (err) => res(!err));
    });
    if (found) {
      return candidate;
    }
  }
  return null;
}

async function transcodeToWav(input: Uint8Array): Promise<Buffer | null> {
  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) {
    console.warn('[CodeTour:audio] ffmpeg not found — tried:', FFMPEG_CANDIDATES.join(', '));
    return null;
  }

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn> | null = null;
    try {
      proc = spawn(ffmpegPath, [
        '-v', 'quiet',       // suppress console output
        '-i', 'pipe:0',      // read from stdin
        '-c:a', 'pcm_s16le', // PCM 16-bit signed little-endian
        '-ar', '22050',      // 22 kHz — good enough for speech, half the size of 44.1 kHz
        '-ac', '1',          // mono
        '-f', 'wav',
        'pipe:1'             // write to stdout
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }

    const chunks: Buffer[] = [];
    proc.stdout!.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('close', (code) => {
      resolve(code === 0 && chunks.length > 0 ? Buffer.concat(chunks) : null);
    });
    proc.on('error', () => resolve(null));

    try {
      proc.stdin!.write(Buffer.from(input));
      proc.stdin!.end();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Converts audio metadata to data URLs for webview playback
 */
export async function convertAudiosToDataUrls(audios: CodeTourStepAudio[]): Promise<{
  id: string; filename: string; duration: number; format: string;
  transcript?: string; caption?: string; richNotes?: { delta: any; html: string };
  markers?: import('../store').AudioMarker[]; dataUrl?: string;
}[]> {
  const workspaceUri = workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) return [];

  console.log(`[CodeTour:audio] convertAudiosToDataUrls — workspace: ${workspaceUri?.fsPath}, count: ${audios.length}`);
  return Promise.all(audios.map(async (audio) => {
    try {
      const audioUri = getAudioUri(audio, workspaceUri);
      console.log(`[CodeTour:audio] reading: ${audioUri.fsPath}`);
      const audioData = await workspace.fs.readFile(audioUri);
      const detectedMime = sniffMimeType(audioData);
      const mimeType = detectedMime ?? getMimeType(audio.format);
      console.log(`[CodeTour:audio] OK — ${audio.filename} (${audioData.length} bytes, mime: ${mimeType}${detectedMime && detectedMime !== getMimeType(audio.format) ? ` [detected; stored format="${audio.format}"]` : ''})`);

      // VS Code's Electron does not support WebM/Opus in the <audio> element.
      // Transcode to WAV (PCM) which has no codec dependency.
      let finalData: Uint8Array = audioData;
      let finalMime = mimeType;
      if (mimeType === 'audio/webm') {
        const wavData = await transcodeToWav(audioData);
        if (wavData) {
          finalData = wavData;
          finalMime = 'audio/wav';
          console.log(`[CodeTour:audio] transcoded WebM→WAV — ${audio.filename} (${audioData.length}→${wavData.length} bytes)`);
        } else {
          console.warn(`[CodeTour:audio] ffmpeg not available — WebM will not play in VS Code webview`);
        }
      }

      const base64 = Buffer.from(finalData).toString('base64');
      return {
        id: audio.id,
        filename: audio.filename,
        duration: audio.duration,
        format: audio.format,
        transcript: audio.transcript,
        caption: audio.caption,
        richNotes: audio.richNotes,
        markers: audio.markers,
        dataUrl: `data:${finalMime};base64,${base64}`
      };
    } catch (err: any) {
      console.error(`[CodeTour:audio] FAILED to read ${audio.path} — ${err?.message ?? err}`);
      return {
        id: audio.id,
        filename: audio.filename,
        duration: audio.duration,
        format: audio.format,
        transcript: audio.transcript,
        caption: audio.caption,
        richNotes: audio.richNotes,
        markers: audio.markers
      };
    }
  }));
}

/**
 * Removes an audio from a tour's parent note
 */
export async function removeAudioFromParentNote(
  tour: CodeTour,
  audioId: string
): Promise<void> {
  if (!tour.parentNote?.audios) return;

  const audioIndex = tour.parentNote.audios.findIndex(a => a.id === audioId);
  if (audioIndex === -1) return;

  const audio = tour.parentNote.audios[audioIndex];
  const workspaceUri = workspace.getWorkspaceFolder(Uri.parse(tour.id))?.uri;

  if (workspaceUri) {
    await deleteAudio(audio, workspaceUri);
  }

  tour.parentNote.audios.splice(audioIndex, 1);
  if (tour.parentNote.audios.length === 0) {
    delete tour.parentNote.audios;
  }
}

/**
 * Updates an audio's rich notes (Quill Delta) in a step
 */
export function updateAudioNotes(
  tour: CodeTour,
  stepIndex: number,
  audioId: string,
  delta: any,
  html: string,
  plainText: string
): boolean {
  const step = tour.steps[stepIndex];
  if (!step?.audios) return false;
  const audio = step.audios.find(a => a.id === audioId);
  if (!audio) return false;
  if (plainText.trim()) {
    audio.richNotes = { delta, html };
    audio.caption = plainText.substring(0, 100);
  } else {
    delete audio.richNotes;
    delete audio.caption;
  }
  return true;
}

/**
 * Updates an audio's rich notes (Quill Delta) in parent note
 */
export function updateParentNoteAudioNotes(
  tour: CodeTour,
  audioId: string,
  delta: any,
  html: string,
  plainText: string
): boolean {
  if (!tour.parentNote?.audios) return false;
  const audio = tour.parentNote.audios.find(a => a.id === audioId);
  if (!audio) return false;
  if (plainText.trim()) {
    audio.richNotes = { delta, html };
    audio.caption = plainText.substring(0, 100);
  } else {
    delete audio.richNotes;
    delete audio.caption;
  }
  return true;
}

/**
 * Updates an audio's caption in parent note
 */
export function updateParentNoteAudioCaption(
  tour: CodeTour,
  audioId: string,
  caption?: string
): boolean {
  if (!tour.parentNote?.audios) return false;
  const audio = tour.parentNote.audios.find(a => a.id === audioId);
  if (!audio) return false;
  if (caption) { audio.caption = caption; } else { delete audio.caption; }
  return true;
}