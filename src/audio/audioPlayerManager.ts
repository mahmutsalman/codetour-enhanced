// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { CodeTour, CodeTourStepAudio } from "../store";
import { getAudioUri } from "../utils/audioStorage";

export class AudioPlayerManager {
  private static instance: AudioPlayerManager | null = null;
  private panel: vscode.WebviewPanel | null = null;

  public static getInstance(): AudioPlayerManager {
    if (!AudioPlayerManager.instance) {
      AudioPlayerManager.instance = new AudioPlayerManager();
    }
    return AudioPlayerManager.instance;
  }

  /**
   * Opens the audio player interface
   */
  public async openPlayer(
    tour: CodeTour, 
    stepIndex: number, 
    audios: CodeTourStepAudio[], 
    selectedAudioPath?: string
  ): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      // Update the content if different audio
      this.updatePlayerContent(tour, stepIndex, audios, selectedAudioPath);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'audioPlayer',
      `Audio Player - ${tour.title} (Step ${stepIndex + 1})`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file('')
        ]
      }
    );

    this.panel.webview.html = this.getPlayerHtml(tour, stepIndex, audios, selectedAudioPath);

    this.panel.onDidDispose(() => {
      this.panel = null;
    });
  }

  /**
   * Updates the player content with new audio list
   */
  private updatePlayerContent(
    tour: CodeTour, 
    stepIndex: number, 
    audios: CodeTourStepAudio[], 
    selectedAudioPath?: string
  ): void {
    if (!this.panel) return;
    
    // Send updated audio list to the webview
    this.panel.webview.postMessage({
      type: 'updateAudios',
      audios: this.convertAudiosForWebview(audios),
      selectedPath: selectedAudioPath
    });
  }

  /**
   * Converts audio metadata for webview consumption
   */
  private convertAudiosForWebview(audios: CodeTourStepAudio[]): any[] {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) return [];

    return audios.map(audio => ({
      id: audio.id,
      filename: audio.filename,
      duration: audio.duration,
      format: audio.format,
      created: audio.created,
      transcript: audio.transcript,
      uri: this.panel?.webview.asWebviewUri(getAudioUri(audio, workspaceUri)).toString()
    }));
  }

  /**
   * Generates the HTML for the audio player
   */
  private getPlayerHtml(
    tour: CodeTour, 
    stepIndex: number, 
    audios: CodeTourStepAudio[], 
    selectedAudioPath?: string
  ): string {
    const audioList = this.convertAudiosForWebview(audios);
    const selectedAudio = selectedAudioPath 
      ? audioList.find(a => a.uri.includes(selectedAudioPath))
      : audioList[0];

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audio Player</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        
        .player-container {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            background-color: var(--vscode-editor-background);
        }
        
        .audio-list {
            margin-bottom: 20px;
        }
        
        .audio-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            margin-bottom: 10px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .audio-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .audio-item.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            border-color: var(--vscode-focusBorder);
        }
        
        .audio-icon {
            font-size: 16px;
            width: 20px;
            text-align: center;
        }
        
        .audio-info {
            flex: 1;
        }
        
        .audio-filename {
            font-weight: bold;
            margin-bottom: 4px;
        }
        
        .audio-details {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .player {
            border-top: 1px solid var(--vscode-panel-border);
            padding-top: 20px;
        }
        
        .player-controls {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 15px;
        }
        
        .play-pause-btn {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: none;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-size: 20px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s;
        }
        
        .play-pause-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .progress-container {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .progress-bar {
            flex: 1;
            height: 6px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 3px;
            cursor: pointer;
            position: relative;
        }
        
        .progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-foreground);
            border-radius: 3px;
            width: 0%;
            transition: width 0.1s;
        }
        
        .time-display {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            min-width: 80px;
            text-align: center;
        }
        
        .speed-controls {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .speed-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .speed-selector {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        
        .transcript {
            margin-top: 15px;
            padding: 10px;
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            border-radius: 4px;
        }
        
        .transcript-label {
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--vscode-textBlockQuote-foreground);
        }
        
        .transcript-text {
            font-style: italic;
            color: var(--vscode-textBlockQuote-foreground);
        }
        
        .no-transcript {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        
        .volume-controls {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 10px;
        }
        
        .volume-slider {
            width: 100px;
        }
        
        .current-audio-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <h2>🔊 Audio Player</h2>
    <div class="current-audio-title" id="currentAudioTitle">No audio selected</div>
    
    <div class="player-container">
        <div class="audio-list" id="audioList">
            <!-- Audio items will be populated here -->
        </div>
        
        <div class="player">
            <audio id="audioElement" preload="metadata"></audio>
            
            <div class="player-controls">
                <button id="playPauseBtn" class="play-pause-btn">▶</button>
                
                <div class="progress-container">
                    <div class="progress-bar" id="progressBar">
                        <div class="progress-fill" id="progressFill"></div>
                    </div>
                    <div class="time-display" id="timeDisplay">0:00 / 0:00</div>
                </div>
            </div>
            
            <div class="speed-controls">
                <span class="speed-label">Speed:</span>
                <select id="speedSelector" class="speed-selector">
                    <option value="0.5">0.5x</option>
                    <option value="0.75">0.75x</option>
                    <option value="1" selected>1x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2x</option>
                    <option value="2.5">2.5x</option>
                </select>
                
                <div class="volume-controls">
                    <span class="speed-label">Volume:</span>
                    <input type="range" id="volumeSlider" class="volume-slider" min="0" max="100" value="100">
                </div>
            </div>
            
            <div id="transcript" class="transcript" style="display: none;">
                <div class="transcript-label">Transcript:</div>
                <div id="transcriptText" class="transcript-text"></div>
            </div>
        </div>
    </div>

    <script>
        let audios = ${JSON.stringify(audioList)};
        let currentAudio = null;
        let isPlaying = false;
        
        const audioElement = document.getElementById('audioElement');
        const playPauseBtn = document.getElementById('playPauseBtn');
        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');
        const timeDisplay = document.getElementById('timeDisplay');
        const speedSelector = document.getElementById('speedSelector');
        const volumeSlider = document.getElementById('volumeSlider');
        const audioList = document.getElementById('audioList');
        const currentAudioTitle = document.getElementById('currentAudioTitle');
        const transcript = document.getElementById('transcript');
        const transcriptText = document.getElementById('transcriptText');
        
        // Initialize
        init();
        
        function init() {
            renderAudioList();
            setupEventListeners();
            
            if (audios.length > 0) {
                const selectedAudio = ${JSON.stringify(selectedAudio)} || audios[0];
                loadAudio(selectedAudio);
            }
        }
        
        function renderAudioList() {
            audioList.innerHTML = '';
            
            audios.forEach(audio => {
                const item = document.createElement('div');
                item.className = 'audio-item';
                item.dataset.audioId = audio.id;
                
                item.innerHTML = \`
                    <div class="audio-icon">🎵</div>
                    <div class="audio-info">
                        <div class="audio-filename">\${audio.filename}</div>
                        <div class="audio-details">
                            Duration: \${formatDuration(audio.duration)} | 
                            Format: \${audio.format.toUpperCase()} | 
                            Size: \${formatFileSize(getCurrentAudioSize(audio))}
                        </div>
                    </div>
                \`;
                
                item.addEventListener('click', () => loadAudio(audio));
                audioList.appendChild(item);
            });
        }
        
        function setupEventListeners() {
            playPauseBtn.addEventListener('click', togglePlayPause);
            progressBar.addEventListener('click', seek);
            speedSelector.addEventListener('change', changeSpeed);
            volumeSlider.addEventListener('input', changeVolume);
            
            audioElement.addEventListener('loadedmetadata', updateDisplay);
            audioElement.addEventListener('timeupdate', updateProgress);
            audioElement.addEventListener('ended', onAudioEnded);
            audioElement.addEventListener('play', () => { isPlaying = true; updatePlayPauseButton(); });
            audioElement.addEventListener('pause', () => { isPlaying = false; updatePlayPauseButton(); });
        }
        
        function loadAudio(audio) {
            currentAudio = audio;
            audioElement.src = audio.uri;
            currentAudioTitle.textContent = audio.filename;
            
            // Update active state in list
            document.querySelectorAll('.audio-item').forEach(item => {
                item.classList.toggle('active', item.dataset.audioId === audio.id);
            });
            
            // Show/hide transcript
            if (audio.transcript) {
                transcriptText.textContent = audio.transcript;
                transcript.style.display = 'block';
            } else {
                transcript.style.display = 'none';
            }
            
            updateDisplay();
        }
        
        function togglePlayPause() {
            if (!currentAudio) return;
            
            if (isPlaying) {
                audioElement.pause();
            } else {
                audioElement.play();
            }
        }
        
        function seek(event) {
            if (!currentAudio) return;
            
            const rect = progressBar.getBoundingClientRect();
            const percent = (event.clientX - rect.left) / rect.width;
            audioElement.currentTime = percent * audioElement.duration;
        }
        
        function changeSpeed() {
            audioElement.playbackRate = parseFloat(speedSelector.value);
        }
        
        function changeVolume() {
            audioElement.volume = parseInt(volumeSlider.value) / 100;
        }
        
        function updateDisplay() {
            if (!currentAudio) return;
            
            const current = formatTime(audioElement.currentTime || 0);
            const total = formatTime(audioElement.duration || currentAudio.duration);
            timeDisplay.textContent = \`\${current} / \${total}\`;
        }
        
        function updateProgress() {
            if (!audioElement.duration) return;
            
            const percent = (audioElement.currentTime / audioElement.duration) * 100;
            progressFill.style.width = percent + '%';
            updateDisplay();
        }
        
        function updatePlayPauseButton() {
            playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
        }
        
        function onAudioEnded() {
            isPlaying = false;
            updatePlayPauseButton();
            
            // Auto-play next audio if available
            const currentIndex = audios.findIndex(a => a.id === currentAudio.id);
            if (currentIndex < audios.length - 1) {
                loadAudio(audios[currentIndex + 1]);
                audioElement.play();
            }
        }
        
        function formatTime(seconds) {
            if (!seconds || !isFinite(seconds)) return '0:00';
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.floor(seconds % 60);
            return \`\${minutes}:\${remainingSeconds.toString().padStart(2, '0')}\`;
        }
        
        function formatDuration(seconds) {
            return formatTime(seconds);
        }
        
        function formatFileSize(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }
        
        function getCurrentAudioSize(audio) {
            // This would need to be passed from the extension
            return 0; // Placeholder
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'updateAudios':
                    audios = message.audios;
                    renderAudioList();
                    
                    if (message.selectedPath) {
                        const selected = audios.find(a => a.uri.includes(message.selectedPath));
                        if (selected) {
                            loadAudio(selected);
                        }
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
  }
}