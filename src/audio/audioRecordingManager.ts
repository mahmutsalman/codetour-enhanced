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
  private recordingTimer: NodeJS.Timeout | null = null;

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
   * Detects macOS audio devices using Sox CoreAudio
   */
  private async detectMacOSDevices(): Promise<AudioDevice[]> {
    try {
      // Use sox to list CoreAudio devices
      const output = await this.executeCommandWithStderr('sox -V6 -n -t coreaudio junkname');
      const devices: AudioDevice[] = [];
      const lines = output.split('\n');
      
      console.log('Raw sox CoreAudio output:', output); // Debug logging
      
      for (const line of lines) {
        // Parse lines like: sox INFO coreaudio: Found Audio Device "MacBook Pro Microphone"
        if (line.includes('Found Audio Device')) {
          const match = line.match(/Found Audio Device "([^"]+)"/);
          if (match) {
            const name = match[1];
            const type = this.classifyMacOSDevice(name);
            
            console.log(`Debug: Device "${name}" classified as "${type}"`); // Debug logging
            
            // Add all microphone devices and any device that explicitly has microphone/input in name
            if (type === 'microphone' || name.toLowerCase().includes('input') || name.toLowerCase().includes('microphone')) {
              devices.push({ index: devices.length, name, type: 'microphone' });
              console.log(`✅ Added microphone device: ${name} (type: ${type})`); // Debug logging
            } else {
              console.log(`❌ Skipped device: ${name} (type: ${type})`); // Debug logging
            }
          }
        }
      }
      
      // Fallback: Add common macOS devices if detection fails
      if (devices.length === 0) {
        console.warn('No microphone devices detected from sox output, using fallback devices');
        devices.push({ index: 0, name: 'default', type: 'microphone' });
        devices.push({ index: 1, name: 'MacBook Pro Microphone', type: 'microphone' });
      }
      
      return devices;
    } catch (error) {
      console.warn('Failed to detect macOS audio devices:', error);
      // Return fallback devices 
      return [
        { index: 0, name: 'default', type: 'microphone' },
        { index: 1, name: 'MacBook Pro Microphone', type: 'microphone' }
      ];
    }
  }

  /**
   * Classifies macOS audio device type based on name
   */
  private classifyMacOSDevice(name: string): 'microphone' | 'virtual' | 'system' {
    const lowerName = name.toLowerCase();
    
    // Physical microphones - including external, USB, and built-in
    if (lowerName.includes('microphone') || 
        lowerName.includes('built-in') ||
        (lowerName.includes('external') && lowerName.includes('microphone')) ||
        lowerName.includes('usb') ||
        lowerName.includes('input') ||
        lowerName.includes('mic')) {
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
        // macOS: Check for sox (primary) or ffmpeg (fallback)
        try {
          await this.executeCommand('which sox');
          return true;
        } catch (soxError) {
          console.log('Sox not found, checking for ffmpeg fallback:', soxError);
          try {
            await this.executeCommand('which ffmpeg');
            return true;
          } catch (ffmpegError) {
            console.log('Neither sox nor ffmpeg found:', ffmpegError);
            return false;
          }
        }
      } else if (platform === 'win32') {
        // Windows: Check for sox or ffmpeg
        try {
          await this.executeCommand('where sox');
          return true;
        } catch (soxError) {
          try {
            await this.executeCommand('where ffmpeg');
            return true;
          } catch (ffmpegError) {
            return false;
          }
        }
      } else {
        // Linux: Check for sox or arecord (ALSA)
        try {
          await this.executeCommand('which sox');
          return true;
        } catch (soxError) {
          await this.executeCommand('which arecord');
          return true;
        }
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
      installMessage = 'Audio recording requires Sox (recommended) or FFmpeg. Would you like to install Sox?';
      installCommand = 'brew install sox';
    } else if (platform === 'win32') {
      installMessage = 'Audio recording requires Sox or FFmpeg. Please install Sox for best quality.';
      installCommand = 'Download Sox from https://sourceforge.net/projects/sox/';
    } else {
      installMessage = 'Audio recording requires Sox or ALSA utilities. Sox is recommended for best quality.';
      installCommand = 'sudo apt-get install sox';
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
   * Starts system-level audio recording using Sox (primary) or FFmpeg (fallback)
   */
  private async startSystemRecording(): Promise<void> {
    const platform = process.platform;
    
    // Use workspace or OS temp directory for recordings
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const tempDir = workspaceRoot 
      ? path.join(workspaceRoot, '.tours', 'temp')
      : path.join(require('os').tmpdir(), 'codetour-recordings');
    
    // Ensure temp directory exists with proper error handling
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log(`Created temp directory: ${tempDir}`);
      }
    } catch (error) {
      console.error('Failed to create temp directory:', error);
      vscode.window.showErrorMessage(`Failed to create recording directory: ${error}`);
      return;
    }

    const timestamp = Date.now();
    const tempFilePath = path.join(tempDir, `recording_${timestamp}.wav`);
    
    try {
      let recordingArgs: string[] = [];
      let command = '';

      // Try Sox first (crystal-clear quality), fallback to FFmpeg if needed
      const hasSox = await this.checkForSox();
      
      if (platform === 'darwin') {
        if (hasSox) {
          // macOS: Use Sox with CoreAudio (crystal-clear quality)
          command = 'sox';
          const deviceName = this.getSelectedDeviceName();
          recordingArgs = [
            '-t', 'coreaudio',           // macOS audio system
            deviceName,                  // Selected device name (input)
            '-r', '48000',              // 48kHz sample rate
            '-b', '24',                 // 24-bit depth
            '-c', '1',                  // Mono channel
            tempFilePath,               // Output file (must come after input settings)
            'compand', '0.3,1', '6:-70,-60,-20', '-5', '-90', '0.2'  // Dynamic range compression
          ];
        } else {
          // Fallback to FFmpeg with improved settings
          command = 'ffmpeg';
          recordingArgs = [
            '-f', 'avfoundation',
            '-i', `:${this.selectedDeviceIndex}`,
            '-acodec', 'pcm_s16le',
            '-ar', '44100',
            '-ac', '1',
            '-y',
            tempFilePath
          ];
        }
      } else if (platform === 'win32') {
        if (hasSox) {
          // Windows: Use Sox
          command = 'sox';
          recordingArgs = [
            '-d',                       // Default device (input)
            '-r', '48000',             // Sample rate
            '-b', '24',                // Bit depth
            '-c', '1',                 // Channels
            tempFilePath,              // Output file (after input settings)
            'compand', '0.3,1', '6:-70,-60,-20', '-5', '-90', '0.2'
          ];
        } else {
          // Fallback to FFmpeg
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
        }
      } else {
        if (hasSox) {
          // Linux: Use Sox
          command = 'sox';
          recordingArgs = [
            '-d',                       // Default device (input)
            '-r', '48000',             // Sample rate
            '-b', '24',                // Bit depth
            '-c', '1',                 // Channels
            tempFilePath,              // Output file (after input settings)
            'compand', '0.3,1', '6:-70,-60,-20', '-5', '-90', '0.2'
          ];
        } else {
          // Fallback to arecord
          command = 'arecord';
          recordingArgs = [
            '-f', 'cd',
            '-t', 'wav',
            tempFilePath
          ];
        }
      }

      console.log(`Starting recording with: ${command} ${recordingArgs.join(' ')}`);
      const recordingProcess = spawn(command, recordingArgs);
      
      this.recordingProcess = {
        process: recordingProcess,
        tempFilePath,
        startTime: Date.now()
      };

      // Set up status bar and start timer
      this.createStatusBarItem();
      this.startRecordingTimer(hasSox);

      recordingProcess.stderr?.on('data', (data) => {
        const errorOutput = data.toString();
        console.log('Recording stderr:', errorOutput);
        
        // Monitor for common issues
        if (errorOutput.includes('Permission denied') || errorOutput.includes('Device busy')) {
          console.warn('Recording permission/device issue:', errorOutput);
        }
      });

      recordingProcess.on('error', (error) => {
        console.error('Recording process error:', error);
        vscode.window.showErrorMessage(`Recording failed: ${error.message}`);
        this.cleanup();
      });

      // Show persistent recording notification
      this.showPersistentRecordingNotification(hasSox);

    } catch (error) {
      console.error('Failed to start recording:', error);
      vscode.window.showErrorMessage(`Failed to start recording: ${error}`);
    }
  }

  /**
   * Checks if Sox is available on the system
   */
  private async checkForSox(): Promise<boolean> {
    const platform = process.platform;
    try {
      if (platform === 'win32') {
        await this.executeCommand('where sox');
      } else {
        await this.executeCommand('which sox');
      }
      return true;
    } catch (error) {
      console.log('Sox not available:', error);
      return false;
    }
  }

  /**
   * Gets the selected device name for Sox
   */
  private getSelectedDeviceName(): string {
    if (this.availableDevices.length > 0 && this.selectedDeviceIndex >= 0) {
      const device = this.availableDevices.find(d => d.index === this.selectedDeviceIndex);
      return device?.name || 'default';
    }
    return 'default';
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
   * Shows a persistent recording notification that doesn't auto-dismiss
   */
  private showPersistentRecordingNotification(hasSox: boolean): void {
    const recordingTool = hasSox ? 'Sox' : 'Fallback mode';
    
    // Create a progress notification that won't auto-dismiss
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `🎤 Recording started with ${recordingTool}`,
      cancellable: true
    }, async (progress, token) => {
      let timeElapsed = 0;
      
      // Initial progress message
      progress.report({ 
        message: `Recording in progress... 00:00 | Click status bar or Cancel to stop`
      });
      
      // Update progress every 5 seconds to keep it alive
      const progressInterval = setInterval(() => {
        if (!this.recordingProcess) {
          clearInterval(progressInterval);
          return;
        }
        
        timeElapsed += 5;
        const minutes = Math.floor(timeElapsed / 60);
        const seconds = timeElapsed % 60;
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        progress.report({ 
          message: `Recording in progress... ${timeStr} | Click status bar or Cancel to stop`
        });
      }, 5000);
      
      // Handle cancellation
      token.onCancellationRequested(() => {
        clearInterval(progressInterval);
        this.stopRecording();
      });
      
      // Keep the notification open until recording stops
      return new Promise<void>((resolve) => {
        const checkRecording = () => {
          if (!this.recordingProcess) {
            clearInterval(progressInterval);
            resolve();
          } else {
            setTimeout(checkRecording, 1000);
          }
        };
        checkRecording();
      });
    });
  }

  /**
   * Starts the recording timer to update status bar with elapsed time
   */
  private startRecordingTimer(hasSox: boolean): void {
    if (!this.recordingProcess) return;
    
    const recordingTool = hasSox ? 'Sox' : 'Fallback';
    
    // Update immediately
    this.updateStatusBar(`🎤 Recording with ${recordingTool} - 00:00 - Click to STOP`, true);
    
    // Update every second
    this.recordingTimer = setInterval(() => {
      if (!this.recordingProcess) {
        this.stopRecordingTimer();
        return;
      }
      
      const elapsed = Date.now() - this.recordingProcess.startTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      
      this.updateStatusBar(`🎤 Recording with ${recordingTool} - ${timeStr} - Click to STOP`, true);
    }, 1000);
  }

  /**
   * Stops the recording timer
   */
  private stopRecordingTimer(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  /**
   * Updates status bar display
   */
  private updateStatusBar(text: string, isRecording: boolean): void {
    if (!this.statusBarItem) return;
    
    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = isRecording 
      ? 'Click to stop recording or press Ctrl+Shift+P → CodeTour: Stop Recording'
      : 'Audio recording';
  }

  /**
   * Cleans up recording resources
   */
  private cleanup(): void {
    // Stop the recording timer
    this.stopRecordingTimer();
    
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
        // For device listing, sox returns exit code 2 (can't open dummy device) but still provides device info
        // FFmpeg returns exit code 1 but still provides device info
        // So we accept 0, 1, and 2 for device detection
        if (code === 0 || code === 1 || code === 2) {
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