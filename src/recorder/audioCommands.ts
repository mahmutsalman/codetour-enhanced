// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { EXTENSION_NAME } from "../constants";
import { store } from "../store";
import { AudioRecordingManager } from "../audio/audioRecordingManager";
import { AudioPlayerManager } from "../audio/audioPlayerManager";
import { removeAudioFromStep, updateAudioTranscript, formatDuration, addAudioToStep } from "../utils/audioStorage";
import { saveTour } from "./commands";

/**
 * Registers audio-related commands for CodeTour
 */
export function registerAudioCommands(context?: vscode.ExtensionContext) {
  
  /**
   * Command: Start audio recording for current step
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.startAudioRecording`,
    async () => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour to add audio to");
        return;
      }

      if (!store.isRecording || !store.isEditing) {
        vscode.window.showErrorMessage("Tour must be in recording/editing mode to add audio");
        return;
      }

      try {
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;

        const recorder = AudioRecordingManager.getInstance();
        await recorder.openRecorder(tour, stepIndex);

      } catch (error) {
        console.error("Failed to start audio recording:", error);
        vscode.window.showErrorMessage(`Failed to start recording: ${error}`);
      }
    }
  );

  /**
   * Command: Stop audio recording
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.stopAudioRecording`,
    async () => {
      try {
        const recorder = AudioRecordingManager.getInstance();
        await recorder.stopRecording();
      } catch (error) {
        console.error("Failed to stop audio recording:", error);
        vscode.window.showErrorMessage(`Failed to stop recording: ${error}`);
      }
    }
  );

  /**
   * Command: Add audio from file to current step
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.addAudioFromFile`,
    async () => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour to add audio to");
        return;
      }

      try {
        // Show file picker for audio files
        const fileUri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: false,
          filters: {
            'Audio Files': ['wav', 'mp3', 'ogg', 'webm', 'm4a', 'aac', 'flac']
          }
        });

        if (!fileUri || fileUri.length === 0) {
          return;
        }

        // Read audio file
        const audioData = await vscode.workspace.fs.readFile(fileUri[0]);
        const filename = vscode.workspace.asRelativePath(fileUri[0]);
        
        // Get file extension to determine format
        const ext = filename.split('.').pop()?.toLowerCase() || 'unknown';

        // Ask for optional transcript
        const transcript = await vscode.window.showInputBox({
          prompt: "Enter an optional transcript for the audio",
          placeHolder: "Audio transcript (optional)"
        });

        // Estimate duration (we can't get exact duration from file data alone)
        // For now, use file size as a rough estimate (this is imperfect but functional)
        const estimatedDuration = Math.max(1, audioData.length / 32000); // rough estimate

        // Add audio to current step
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;
        
        await addAudioToStep(
          tour,
          stepIndex,
          audioData,
          estimatedDuration,
          ext,
          transcript || undefined
        );

        // Save tour with new audio
        await saveTour(tour);

        vscode.window.showInformationMessage("Audio added to tour step successfully!");

      } catch (error) {
        console.error("Failed to add audio from file:", error);
        vscode.window.showErrorMessage(`Failed to add audio: ${error}`);
      }
    }
  );

  /**
   * Command: Play audio recording
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.playAudio`,
    async (audioPath?: string) => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour found");
        return;
      }

      try {
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;
        const step = tour.steps[stepIndex];

        if (!step.audios || step.audios.length === 0) {
          vscode.window.showInformationMessage("No audio recordings found in current step");
          return;
        }

        const player = AudioPlayerManager.getInstance(context?.extensionUri);
        await player.openPlayer(tour, stepIndex, step.audios, audioPath);

      } catch (error) {
        console.error("Failed to play audio:", error);
        vscode.window.showErrorMessage(`Failed to play audio: ${error}`);
      }
    }
  );

  /**
   * Command: Remove audio from step
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.removeAudio`,
    async (audioId: string) => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour");
        return;
      }

      if (!audioId) {
        vscode.window.showErrorMessage("No audio ID provided");
        return;
      }

      try {
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;
        const step = tour.steps[stepIndex];

        // Find the audio to get its info for confirmation
        const audio = step.audios?.find(a => a.id === audioId);
        if (!audio) {
          vscode.window.showErrorMessage("Audio not found");
          return;
        }

        // Confirm deletion
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to remove "${audio.filename}"?`,
          "Remove Audio",
          "Cancel"
        );

        if (confirm !== "Remove Audio") {
          return;
        }

        await removeAudioFromStep(tour, stepIndex, audioId);
        
        // Save tour
        await saveTour(tour);

        vscode.window.showInformationMessage("Audio removed successfully!");

      } catch (error) {
        console.error("Failed to remove audio:", error);
        vscode.window.showErrorMessage(`Failed to remove audio: ${error}`);
      }
    }
  );

  /**
   * Command: Update audio transcript
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.updateAudioTranscript`,
    async (audioId: string) => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour");
        return;
      }

      if (!audioId) {
        vscode.window.showErrorMessage("No audio ID provided");
        return;
      }

      try {
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;
        const step = tour.steps[stepIndex];
        
        // Find current audio
        const audio = step.audios?.find(a => a.id === audioId);
        if (!audio) {
          vscode.window.showErrorMessage("Audio not found");
          return;
        }

        // Ask for transcript
        const newTranscript = await vscode.window.showInputBox({
          prompt: "Enter transcript for the audio recording",
          placeHolder: "Audio transcript (leave empty to remove)",
          value: audio.transcript || "",
          ignoreFocusOut: true
        });

        if (newTranscript === undefined) {
          return; // User cancelled
        }

        // Update transcript
        updateAudioTranscript(tour, stepIndex, audioId, newTranscript || undefined);
        
        // Save tour
        await saveTour(tour);

        vscode.window.showInformationMessage("Audio transcript updated!");

      } catch (error) {
        console.error("Failed to update audio transcript:", error);
        vscode.window.showErrorMessage(`Failed to update transcript: ${error}`);
      }
    }
  );

  /**
   * Command: Show audio management panel
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.manageStepAudios`,
    async () => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour");
        return;
      }

      const tour = store.activeTour.tour;
      const stepIndex = store.activeTour.step;
      const step = tour.steps[stepIndex];
      const audios = step.audios || [];

      if (audios.length === 0) {
        const action = await vscode.window.showInformationMessage(
          "No audio recordings in current step",
          "Record Audio"
        );
        
        if (action === "Record Audio") {
          await vscode.commands.executeCommand(`${EXTENSION_NAME}.startAudioRecording`);
        }
        return;
      }

      // Create quick pick items for audios
      const items = audios.map(audio => ({
        label: audio.filename,
        description: `${formatDuration(audio.duration)} • ${audio.format.toUpperCase()}`,
        detail: audio.transcript ? `📝 ${audio.transcript.substring(0, 100)}...` : 'No transcript',
        audioId: audio.id,
        audioPath: audio.path
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select an audio recording to manage"
      });

      if (!selected) return;

      // Show action menu for selected audio
      const actions = [
        { label: "$(play) Play Audio", action: "play" },
        { label: "$(edit) Edit Transcript", action: "transcript" },
        { label: "$(trash) Remove Audio", action: "remove" }
      ];

      const action = await vscode.window.showQuickPick(actions, {
        placeHolder: "What would you like to do with this audio recording?"
      });

      if (!action) return;

      switch (action.action) {
        case "play":
          await vscode.commands.executeCommand(`${EXTENSION_NAME}.playAudio`, selected.audioPath);
          break;
        case "transcript":
          await vscode.commands.executeCommand(`${EXTENSION_NAME}.updateAudioTranscript`, selected.audioId);
          break;
        case "remove":
          await vscode.commands.executeCommand(`${EXTENSION_NAME}.removeAudio`, selected.audioId);
          break;
      }
    }
  );

  /**
   * Command: Quick add audio (record immediately)
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.quickRecordAudio`,
    async () => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour to add audio to");
        return;
      }

      if (!store.isRecording || !store.isEditing) {
        const startRecording = await vscode.window.showInformationMessage(
          "Tour must be in recording mode to add audio. Start recording this tour?",
          "Start Recording",
          "Cancel"
        );
        
        if (startRecording === "Start Recording") {
          await vscode.commands.executeCommand(`${EXTENSION_NAME}.editTour`);
          // Wait a bit for the recording state to update
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          return;
        }
      }

      // Start recording immediately
      await vscode.commands.executeCommand(`${EXTENSION_NAME}.startAudioRecording`);
    }
  );

  /**
   * Command: List all audio recordings in tour
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.listTourAudios`,
    async () => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour");
        return;
      }

      const tour = store.activeTour.tour;
      let totalAudios = 0;
      const audioItems: any[] = [];

      tour.steps.forEach((step, stepIndex) => {
        if (step.audios && step.audios.length > 0) {
          step.audios.forEach(audio => {
            totalAudios++;
            audioItems.push({
              label: `Step ${stepIndex + 1}: ${audio.filename}`,
              description: `${formatDuration(audio.duration)} • ${audio.format.toUpperCase()}`,
              detail: audio.transcript || 'No transcript',
              stepIndex,
              audioPath: audio.path
            });
          });
        }
      });

      if (totalAudios === 0) {
        vscode.window.showInformationMessage("No audio recordings found in this tour");
        return;
      }

      const selected = await vscode.window.showQuickPick(audioItems, {
        placeHolder: `Select from ${totalAudios} audio recordings in this tour`
      });

      if (selected) {
        // Navigate to the step and play the audio
        if (store.activeTour.step !== selected.stepIndex) {
          // Navigate to the step first
          store.activeTour.step = selected.stepIndex;
        }
        
        await vscode.commands.executeCommand(`${EXTENSION_NAME}.playAudio`, selected.audioPath);
      }
    }
  );

  /**
   * Command: Select/Change microphone input device
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.selectMicrophone`,
    async () => {
      try {
        const recorder = AudioRecordingManager.getInstance();
        await recorder.selectMicrophone();
      } catch (error) {
        console.error("Failed to select microphone:", error);
        vscode.window.showErrorMessage(`Failed to select microphone: ${error}`);
      }
    }
  );
}