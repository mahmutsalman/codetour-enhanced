// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { CodeTour } from "../store";
import { addAudioToStep } from "../utils/audioStorage";
import { saveTour } from "../recorder/commands";

interface RecordingProcess {
  process: ChildProcess;
  tempFilePath: string;
  startTime: number;
}

export class AudioRecordingManager {
  private static instance: AudioRecordingManager | null = null;
  private currentTour: CodeTour | null = null;
  private currentStepIndex: number = -1;
  private recordingProcess: RecordingProcess | null = null;
  private statusBarItem: vscode.StatusBarItem | null = null;

  public static getInstance(): AudioRecordingManager {
    if (!AudioRecordingManager.instance) {
      AudioRecordingManager.instance = new AudioRecordingManager();
    }
    return AudioRecordingManager.instance;
  }

  /**
   * Opens the audio recording interface using system recording
   */
  public async openRecorder(tour: CodeTour, stepIndex: number): Promise<void> {
    this.currentTour = tour;
    this.currentStepIndex = stepIndex;

    // Check if recording is already in progress
    if (this.recordingProcess) {
      const action = await vscode.window.showWarningMessage(
        "Recording is already in progress. What would you like to do?",
        "Stop Current Recording",
        "Cancel"
      );
      
      if (action === "Stop Current Recording") {
        await this.stopRecording();
      }
      return;
    }

    // Check for required recording tools
    const hasRecordingTool = await this.checkRecordingTools();
    if (!hasRecordingTool) {
      await this.showRecordingToolsInstallation();
      return;
    }

    // Start recording immediately
    await this.startSystemRecording();
  }

  /**
   * Checks if system recording tools are available
   */
  private async checkRecordingTools(): Promise<boolean> {
    const platform = process.platform;
    
    try {
      if (platform === 'darwin') {
        // macOS: Check for ffmpeg
        await this.executeCommand('which ffmpeg');
        return true;
      } else if (platform === 'win32') {
        // Windows: Check for ffmpeg
        await this.executeCommand('where ffmpeg');
        return true;
      } else {
        // Linux: Check for arecord (ALSA)
        await this.executeCommand('which arecord');
        return true;
      }
    } catch (error) {
      console.log('Recording tools not found:', error);
      return false;
    }
  }

  /**
   * Shows installation instructions for recording tools
   */
  private async showRecordingToolsInstallation(): Promise<void> {
    const platform = process.platform;
    let installMessage = '';
    let installCommand = '';

    if (platform === 'darwin') {
      installMessage = 'Audio recording requires FFmpeg. Would you like to install it?';
      installCommand = 'brew install ffmpeg';
    } else if (platform === 'win32') {
      installMessage = 'Audio recording requires FFmpeg. Please install it from https://ffmpeg.org/download.html';
      installCommand = 'Download from https://ffmpeg.org/download.html and add to PATH';
    } else {
      installMessage = 'Audio recording requires ALSA utilities. Would you like to install them?';
      installCommand = 'sudo apt-get install alsa-utils';
    }

    const action = await vscode.window.showErrorMessage(
      installMessage,
      'Show Install Command',
      'Record from File Instead',
      'Cancel'
    );

    if (action === 'Show Install Command') {
      vscode.window.showInformationMessage(`Run this command: ${installCommand}`);
    } else if (action === 'Record from File Instead') {
      await vscode.commands.executeCommand('codetour.addAudioFromFile');
    }
  }

  /**
   * Starts system-level audio recording
   */
  private async startSystemRecording(): Promise<void> {
    const platform = process.platform;
    const tempDir = path.join(__dirname, '..', '..', 'temp');
    
    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const timestamp = Date.now();
    const tempFilePath = path.join(tempDir, `recording_${timestamp}.wav`);
    
    try {
      let recordingArgs: string[] = [];
      let command = '';

      if (platform === 'darwin') {
        // macOS: Use ffmpeg with AVFoundation
        command = 'ffmpeg';
        recordingArgs = [
          '-f', 'avfoundation',
          '-i', ':0',  // Use default microphone
          '-acodec', 'pcm_s16le',
          '-ar', '44100',
          '-ac', '2',
          '-y',  // Overwrite output file
          tempFilePath
        ];
      } else if (platform === 'win32') {
        // Windows: Use ffmpeg with DirectShow
        command = 'ffmpeg';
        recordingArgs = [
          '-f', 'dshow',
          '-i', 'audio="Microphone"',
          '-acodec', 'pcm_s16le',
          '-ar', '44100',
          '-ac', '2',
          '-y',
          tempFilePath
        ];
      } else {
        // Linux: Use arecord
        command = 'arecord';
        recordingArgs = [
          '-f', 'cd',  // CD quality (16-bit, 44.1kHz, stereo)
          '-t', 'wav',
          tempFilePath
        ];
      }

      const recordingProcess = spawn(command, recordingArgs);
      
      this.recordingProcess = {
        process: recordingProcess,
        tempFilePath,
        startTime: Date.now()
      };

      // Set up status bar
      this.createStatusBarItem();
      this.updateStatusBar('Recording...', true);

      recordingProcess.on('error', (error) => {
        console.error('Recording process error:', error);
        vscode.window.showErrorMessage(`Recording failed: ${error.message}`);
        this.cleanup();
      });

      vscode.window.showInformationMessage(
        '🎤 Recording started! Click the status bar or press ESC to stop.',
        'Stop Recording'
      ).then(action => {
        if (action === 'Stop Recording') {
          this.stopRecording();
        }
      });

    } catch (error) {
      console.error('Failed to start recording:', error);
      vscode.window.showErrorMessage(`Failed to start recording: ${error}`);
    }
  }

  /**
   * Stops the current recording
   */
  public async stopRecording(): Promise<void> {
    if (!this.recordingProcess) {
      return;
    }

    const duration = (Date.now() - this.recordingProcess.startTime) / 1000;
    
    // Stop the recording process
    this.recordingProcess.process.kill('SIGTERM');
    
    // Wait a moment for the file to be finalized
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      // Read the recorded file
      const audioData = fs.readFileSync(this.recordingProcess.tempFilePath);
      
      // Add audio to step
      await addAudioToStep(
        this.currentTour!,
        this.currentStepIndex,
        audioData,
        duration,
        'wav'
      );

      // Save tour
      await saveTour(this.currentTour!);

      vscode.window.showInformationMessage(
        `🎤 Audio recorded successfully! Duration: ${this.formatDuration(duration)}`
      );

    } catch (error) {
      console.error('Failed to save recording:', error);
      vscode.window.showErrorMessage(`Failed to save recording: ${error}`);
    } finally {
      this.cleanup();
    }
  }

  /**
   * Creates status bar item for recording control
   */
  private createStatusBarItem(): void {
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        1000
      );
      this.statusBarItem.command = 'codetour.stopAudioRecording';
    }
    this.statusBarItem.show();
  }

  /**
   * Updates status bar display
   */
  private updateStatusBar(text: string, isRecording: boolean): void {
    if (!this.statusBarItem) return;
    
    this.statusBarItem.text = `$(${isRecording ? 'record' : 'mic'}) ${text}`;
    this.statusBarItem.tooltip = isRecording 
      ? 'Click to stop recording (Ctrl+Shift+P → CodeTour: Stop Recording)'
      : 'Audio recording';
  }

  /**
   * Cleans up recording resources
   */
  private cleanup(): void {
    if (this.recordingProcess) {
      // Clean up temp file
      try {
        if (fs.existsSync(this.recordingProcess.tempFilePath)) {
          fs.unlinkSync(this.recordingProcess.tempFilePath);
        }
      } catch (error) {
        console.warn('Failed to clean up temp file:', error);
      }
      
      this.recordingProcess = null;
    }

    if (this.statusBarItem) {
      this.statusBarItem.hide();
      this.statusBarItem.dispose();
      this.statusBarItem = null;
    }

    this.currentTour = null;
    this.currentStepIndex = -1;
  }

  /**
   * Executes a command and returns a promise
   */
  private executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const process = spawn(cmd, args);
      
      let output = '';
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed with code ${code}`));
        }
      });
      
      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Formats duration in seconds to MM:SS
   */
  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}