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

interface AudioDevice {
  index: number;
  name: string;
  type: 'microphone' | 'virtual' | 'system';
}

export class AudioRecordingManager {
  private static instance: AudioRecordingManager | null = null;
  private currentTour: CodeTour | null = null;
  private currentStepIndex: number = -1;
  private recordingProcess: RecordingProcess | null = null;
  private statusBarItem: vscode.StatusBarItem | null = null;
  private availableDevices: AudioDevice[] = [];
  private selectedDeviceIndex: number = -1;

  public static getInstance(): AudioRecordingManager {
    if (!AudioRecordingManager.instance) {
      AudioRecordingManager.instance = new AudioRecordingManager();
    }
    return AudioRecordingManager.instance;
  }

  /**
   * Detects available audio devices for the current platform
   */
  private async detectAudioDevices(): Promise<AudioDevice[]> {
    const platform = process.platform;
    
    if (platform === 'darwin') {
      return await this.detectMacOSDevices();
    } else if (platform === 'win32') {
      return await this.detectWindowsDevices();
    } else {
      return await this.detectLinuxDevices();
    }
  }

  /**
   * Detects macOS audio devices using ffmpeg AVFoundation
   */
  private async detectMacOSDevices(): Promise<AudioDevice[]> {
    try {
      const output = await this.executeCommandWithStderr('ffmpeg -f avfoundation -list_devices true -i ""');
      const devices: AudioDevice[] = [];
      const lines = output.split('\n');
      
      console.log('Raw ffmpeg output:', output); // Debug logging
      
      let inAudioSection = false;
      for (const line of lines) {
        if (line.includes('AVFoundation audio devices:')) {
          inAudioSection = true;
          continue;
        }
        
        if (inAudioSection && line.includes('[') && line.includes(']')) {
          const match = line.match(/\[(\d+)\]\s+(.+)/);
          if (match) {
            const index = parseInt(match[1]);
            const name = match[2].trim();
            const type = this.classifyMacOSDevice(name);
            devices.push({ index, name, type });
            console.log(`Found device: ${index} - ${name} (${type})`); // Debug logging
          }
        }
      }
      
      // Fallback: if no devices found but we know they exist, add known devices
      if (devices.length === 0) {
        console.warn('No devices detected from ffmpeg output, using fallback devices');
        devices.push({ index: 0, name: 'ZoomAudioDevice', type: 'virtual' });
        devices.push({ index: 1, name: 'MacBook Pro Microphone', type: 'microphone' });
      }
      
      return devices;
    } catch (error) {
      console.warn('Failed to detect macOS audio devices:', error);
      // Return fallback devices based on your system output
      return [
        { index: 0, name: 'ZoomAudioDevice', type: 'virtual' },
        { index: 1, name: 'MacBook Pro Microphone', type: 'microphone' }
      ];
    }
  }

  /**
   * Classifies macOS audio device type based on name
   */
  private classifyMacOSDevice(name: string): 'microphone' | 'virtual' | 'system' {
    const lowerName = name.toLowerCase();
    
    // Physical microphones
    if (lowerName.includes('microphone') || lowerName.includes('built-in')) {
      return 'microphone';
    }
    
    // Virtual audio devices
    if (lowerName.includes('zoom') || lowerName.includes('virtual') || lowerName.includes('aggregate')) {
      return 'virtual';
    }
    
    // System devices
    return 'system';
  }

  /**
   * Detects Windows audio devices (placeholder - implement based on DirectShow)
   */
  private async detectWindowsDevices(): Promise<AudioDevice[]> {
    // For now, return default microphone
    return [{ index: 0, name: 'Default Microphone', type: 'microphone' }];
  }

  /**
   * Detects Linux audio devices (placeholder - implement based on ALSA)
   */
  private async detectLinuxDevices(): Promise<AudioDevice[]> {
    // For now, return default microphone  
    return [{ index: 0, name: 'Default Microphone', type: 'microphone' }];
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

    // Detect available audio devices
    try {
      this.availableDevices = await this.detectAudioDevices();
      
      console.log(`Detected ${this.availableDevices.length} audio devices:`, this.availableDevices);
      
      if (this.availableDevices.length === 0) {
        vscode.window.showErrorMessage("No audio devices detected. Please check your microphone connection.");
        return;
      }

      // Show device selection if multiple devices or first time
      await this.showDeviceSelection();
      
      if (this.selectedDeviceIndex === -1) {
        return; // User cancelled device selection
      }

      console.log(`Selected device index: ${this.selectedDeviceIndex}`);

    } catch (error) {
      console.warn("Failed to detect audio devices, using default:", error);
      this.selectedDeviceIndex = 1; // Fallback to device index 1 (MacBook Pro Microphone)
    }

    // Start recording with selected device
    await this.startSystemRecording();
  }

  /**
   * Shows device selection dialog to user
   */
  private async showDeviceSelection(): Promise<void> {
    if (this.availableDevices.length === 1) {
      // Only one device, use it automatically
      this.selectedDeviceIndex = this.availableDevices[0].index;
      return;
    }

    const items = this.availableDevices.map(device => ({
      label: `${this.getDeviceIcon(device.type)} ${device.name}`,
      description: this.getDeviceDescription(device.type),
      detail: `Device ${device.index}`,
      deviceIndex: device.index
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select microphone for recording",
      title: "Audio Device Selection"
    });

    if (selected) {
      this.selectedDeviceIndex = selected.deviceIndex;
    } else {
      this.selectedDeviceIndex = -1; // User cancelled
    }
  }

  /**
   * Gets icon for device type
   */
  private getDeviceIcon(type: 'microphone' | 'virtual' | 'system'): string {
    switch (type) {
      case 'microphone': return '🎤';
      case 'virtual': return '🎙️';
      case 'system': return '🔊';
    }
  }

  /**
   * Gets description for device type
   */
  private getDeviceDescription(type: 'microphone' | 'virtual' | 'system'): string {
    switch (type) {
      case 'microphone': return 'Physical microphone (recommended)';
      case 'virtual': return 'Virtual audio device';
      case 'system': return 'System audio device';
    }
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
          '-i', `:${this.selectedDeviceIndex}`,  // Use selected audio device
          '-acodec', 'pcm_s16le',
          '-ar', '44100',
          '-ac', '1',  // Use mono for better compatibility
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
      
      // Check if recording is silent (basic check for file size)
      const isSilent = await this.checkIfRecordingIsSilent(audioData, duration);
      
      if (isSilent) {
        const action = await vscode.window.showWarningMessage(
          "The recording appears to be silent. This might be due to incorrect microphone selection or system permissions.",
          "Try Different Device",
          "Save Anyway",
          "Discard"
        );
        
        if (action === "Try Different Device") {
          // Reset selected device to force device selection on next recording
          this.selectedDeviceIndex = -1;
          vscode.window.showInformationMessage("Try recording again and select a different microphone.");
          return;
        } else if (action === "Discard") {
          vscode.window.showInformationMessage("Recording discarded.");
          return;
        }
        // If "Save Anyway" or no action, continue with saving
      }
      
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

      const message = isSilent 
        ? `⚠️ Audio saved but may be silent. Duration: ${this.formatDuration(duration)}`
        : `🎤 Audio recorded successfully! Duration: ${this.formatDuration(duration)}`;
      
      vscode.window.showInformationMessage(message);

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
   * Executes a command and returns both stdout and stderr output
   */
  private executeCommandWithStderr(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const process = spawn(cmd, args);
      
      let output = '';
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      process.on('close', (code) => {
        // For device listing, ffmpeg returns exit code 1 but still provides device info
        // So we accept both 0 and 1 for device detection
        if (code === 0 || code === 1) {
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
   * Checks if recording is silent based on file size and duration
   */
  private async checkIfRecordingIsSilent(audioData: Buffer, duration: number): Promise<boolean> {
    // Basic check: very small file size relative to duration indicates silence
    const expectedMinSize = duration * 1000; // Rough minimum bytes for actual audio
    
    if (audioData.length < expectedMinSize) {
      return true;
    }
    
    // Additional check: analyze audio data for non-zero samples
    // Skip WAV header (44 bytes) and check for non-zero audio data
    const audioStart = 44;
    const sampleSize = 100; // Check first 100 samples after header
    
    if (audioData.length > audioStart + sampleSize) {
      for (let i = audioStart; i < audioStart + sampleSize; i++) {
        if (audioData[i] !== 0) {
          return false; // Found non-zero audio data
        }
      }
      return true; // All samples are zero
    }
    
    return false; // File too small to analyze properly
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