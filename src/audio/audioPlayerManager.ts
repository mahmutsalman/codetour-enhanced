// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { CodeTour, CodeTourStepAudio } from "../store";
import { getAudioUri } from "../utils/audioStorage";

export class AudioPlayerManager {
  private static instance: AudioPlayerManager | null = null;
  private panel: vscode.WebviewPanel | null = null;
  private extensionUri?: vscode.Uri;

  public static getInstance(extensionUri?: vscode.Uri): AudioPlayerManager {
    if (!AudioPlayerManager.instance) {
      AudioPlayerManager.instance = new AudioPlayerManager();
    }
    if (extensionUri) {
      AudioPlayerManager.instance.extensionUri = extensionUri;
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
      `🎵 Audio Player - ${tour.title} (Step ${stepIndex + 1})`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          ...(this.extensionUri ? [this.extensionUri] : []),
          vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file('')
        ]
      }
    );

    this.panel.webview.html = await this.getPlayerHtml(tour, stepIndex, audios, selectedAudioPath);

    this.panel.onDidDispose(() => {
      this.panel = null;
    });
  }

  /**
   * Updates the player content with new audio list
   */
  private async updatePlayerContent(
    tour: CodeTour, 
    stepIndex: number, 
    audios: CodeTourStepAudio[], 
    selectedAudioPath?: string
  ): Promise<void> {
    if (!this.panel) return;
    
    // Send updated audio list to the webview
    const audioList = await this.convertAudiosForWebview(audios);
    this.panel.webview.postMessage({
      type: 'updateAudios',
      audios: audioList,
      selectedPath: selectedAudioPath
    });
  }

  /**
   * Converts audio metadata for webview consumption
   */
  private async convertAudiosForWebview(audios: CodeTourStepAudio[]): Promise<any[]> {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) return [];

    const audioPromises = audios.map(async (audio) => {
      try {
        // Read audio file as buffer
        const audioUri = getAudioUri(audio, workspaceUri);
        const audioData = await vscode.workspace.fs.readFile(audioUri);
        
        // Convert to base64 data URL
        const base64 = Buffer.from(audioData).toString('base64');
        const mimeType = this.getMimeType(audio.format);
        const dataUrl = `data:${mimeType};base64,${base64}`;
        
        return {
          id: audio.id,
          filename: audio.filename,
          duration: audio.duration,
          format: audio.format,
          created: audio.created,
          transcript: audio.transcript,
          dataUrl: dataUrl,
          uri: this.panel?.webview.asWebviewUri(audioUri).toString() // Keep URI as fallback
        };
      } catch (error) {
        console.error(`Failed to convert audio ${audio.filename}:`, error);
        // Return without dataUrl if conversion fails
        return {
          id: audio.id,
          filename: audio.filename,
          duration: audio.duration,
          format: audio.format,
          created: audio.created,
          transcript: audio.transcript,
          uri: this.panel?.webview.asWebviewUri(getAudioUri(audio, workspaceUri)).toString()
        };
      }
    });

    return Promise.all(audioPromises);
  }

  /**
   * Gets the MIME type for an audio format
   */
  private getMimeType(format: string): string {
    switch (format.toLowerCase()) {
      case 'wav': return 'audio/wav';
      case 'mp3': return 'audio/mpeg';
      case 'ogg': return 'audio/ogg';
      case 'webm': return 'audio/webm';
      case 'm4a': return 'audio/mp4';
      case 'aac': return 'audio/aac';
      case 'flac': return 'audio/flac';
      default: return 'audio/wav'; // Default fallback
    }
  }

  /**
   * Gets resource URIs for webview assets
   */
  private getResourceUris() {
    const extensionUri = this.extensionUri;
    const webview = this.panel?.webview;
    
    if (!webview || !extensionUri) {
      throw new Error('Webview or extension URI not available');
    }

    return {
      playerCss: webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'assets', 'player.css')
      )
    };
  }

  /**
   * Generates the HTML for the WaveSurfer audio player
   */
  private async getPlayerHtml(
    tour: CodeTour, 
    stepIndex: number, 
    audios: CodeTourStepAudio[], 
    selectedAudioPath?: string
  ): Promise<string> {
    const audioList = await this.convertAudiosForWebview(audios);
    const selectedAudio = selectedAudioPath 
      ? audioList.find(a => a.uri && a.uri.includes(selectedAudioPath))
      : audioList[0];

    const resources = this.getResourceUris();
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; 
          script-src ${this.panel?.webview.cspSource} 'nonce-${nonce}' https://unpkg.com; 
          style-src ${this.panel?.webview.cspSource} 'unsafe-inline'; 
          media-src ${this.panel?.webview.cspSource} data: blob:; 
          connect-src ${this.panel?.webview.cspSource} https: data: blob:;">
    <title>WaveSurfer Audio Player</title>
    <link rel="stylesheet" href="${resources.playerCss}">
</head>
<body class="wavesurfer-player">
    <h2>🎵 WaveSurfer Audio Player</h2>
    <div class="current-audio-title" id="currentAudioTitle">
        <span id="titleText">No audio selected</span>
        <div id="playingIndicator" class="playing-indicator" style="display: none;">
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
        </div>
    </div>
    
    <div class="player-container">
        <div class="audio-list" id="audioList">
            <!-- Audio items will be populated here -->
        </div>
        
        <div class="player">
            <!-- Waveform Container -->
            <div class="waveform-container" id="waveformContainer">
                <div class="waveform-loading" id="waveformLoading">Loading waveform...</div>
                <div id="waveform"></div>
                <div id="timeline" class="timeline-container"></div>
            </div>
            
            <!-- Minimap -->
            <div id="minimap" class="minimap-container"></div>
            
            <!-- Controls -->
            <div class="waveform-controls">
                <button id="playPauseBtn" class="play-pause-btn" disabled>
                    <span class="sr-only">Play/Pause</span>
                    ▶
                </button>
                
                <div class="control-group">
                    <div class="time-display" id="timeDisplay">0:00 / 0:00</div>
                </div>
                
                <div class="control-group">
                    <div class="speed-control">
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
                    </div>
                </div>
                
                <div class="control-group">
                    <div class="volume-control">
                        <span class="volume-icon" id="volumeIcon">🔊</span>
                        <input type="range" id="volumeSlider" class="volume-slider" 
                               min="0" max="100" value="100" 
                               aria-label="Volume">
                    </div>
                </div>
                
                <div class="control-group">
                    <div class="zoom-controls">
                        <button id="zoomOutBtn" class="zoom-btn" title="Zoom Out" aria-label="Zoom Out">-</button>
                        <button id="zoomInBtn" class="zoom-btn" title="Zoom In" aria-label="Zoom In">+</button>
                    </div>
                </div>
            </div>
            
            <!-- Transcript -->
            <div id="transcript" class="transcript" style="display: none;">
                <div class="transcript-label">
                    📝 Transcript
                </div>
                <div id="transcriptText" class="transcript-text"></div>
            </div>
            
            <!-- Error Display -->
            <div id="errorMessage" class="error-message" style="display: none;"></div>
        </div>
    </div>

    <!-- Load WaveSurfer from CDN for better VSIX compatibility -->
    <script nonce="${nonce}" src="https://unpkg.com/wavesurfer.js@7.10.1/dist/wavesurfer.min.js"></script>
    <script nonce="${nonce}">
        let audios = ${JSON.stringify(audioList)};
        let currentAudio = null;
        let wavesurfer = null;
        let isPlaying = false;
        
        // DOM elements
        const elements = {
            audioList: document.getElementById('audioList'),
            currentAudioTitle: document.getElementById('titleText'),
            playingIndicator: document.getElementById('playingIndicator'),
            playPauseBtn: document.getElementById('playPauseBtn'),
            timeDisplay: document.getElementById('timeDisplay'),
            speedSelector: document.getElementById('speedSelector'),
            volumeSlider: document.getElementById('volumeSlider'),
            volumeIcon: document.getElementById('volumeIcon'),
            zoomInBtn: document.getElementById('zoomInBtn'),
            zoomOutBtn: document.getElementById('zoomOutBtn'),
            transcript: document.getElementById('transcript'),
            transcriptText: document.getElementById('transcriptText'),
            errorMessage: document.getElementById('errorMessage'),
            waveformLoading: document.getElementById('waveformLoading')
        };
        
        // Initialize
        init();
        
        function init() {
            // Ensure WaveSurfer is loaded from CDN before initializing
            if (typeof WaveSurfer === 'undefined') {
                console.log('Waiting for WaveSurfer to load from CDN...');
                // Retry after a short delay
                setTimeout(init, 100);
                return;
            }
            
            console.log('WaveSurfer loaded successfully, version:', WaveSurfer.VERSION || 'unknown');
            initializeWaveSurfer();
            renderAudioList();
            setupEventListeners();
            
            if (audios.length > 0) {
                const selectedAudio = ${JSON.stringify(selectedAudio)} || audios[0];
                loadAudio(selectedAudio);
            }
        }
        
        function initializeWaveSurfer() {
            try {
                if (typeof WaveSurfer === 'undefined') {
                    throw new Error('WaveSurfer library not loaded');
                }
                
                wavesurfer = WaveSurfer.create({
                    container: '#waveform',
                    waveColor: 'rgba(54, 162, 235, 0.8)',
                    progressColor: 'rgba(34, 134, 58, 1)',
                    cursorColor: 'rgba(255, 193, 7, 1)',
                    barWidth: 2,
                    barRadius: 3,
                    responsive: true,
                    height: 80,
                    normalize: true,
                    backend: 'WebAudio',
                    mediaControls: false,
                    interact: true,
                    hideScrollbar: false
                });

                // Plugins are not included in the basic CommonJS build
                // Timeline and minimap functionality can be added later with separate plugin files
                console.log('WaveSurfer initialized without plugins');

                setupWaveSurferEvents();
                
            } catch (error) {
                console.error('Failed to initialize WaveSurfer:', error);
                showError('Failed to initialize audio player: ' + error.message);
            }
        }
        
        function setupWaveSurferEvents() {
            wavesurfer.on('ready', () => {
                elements.waveformLoading.style.display = 'none';
                elements.playPauseBtn.disabled = false;
                updateTimeDisplay();
            });
            
            wavesurfer.on('loading', (percent) => {
                elements.waveformLoading.textContent = \`Loading waveform... \${percent}%\`;
                elements.waveformLoading.style.display = 'flex';
            });
            
            wavesurfer.on('play', () => {
                isPlaying = true;
                updatePlayPauseButton();
                elements.playingIndicator.style.display = 'inline-flex';
            });
            
            wavesurfer.on('pause', () => {
                isPlaying = false;
                updatePlayPauseButton();
                elements.playingIndicator.style.display = 'none';
            });
            
            wavesurfer.on('finish', () => {
                isPlaying = false;
                updatePlayPauseButton();
                elements.playingIndicator.style.display = 'none';
                onAudioEnded();
            });
            
            wavesurfer.on('timeupdate', () => {
                updateTimeDisplay();
            });
            
            wavesurfer.on('error', (error) => {
                console.error('WaveSurfer error:', error);
                showError('Audio playback error: ' + (error.message || error));
                elements.waveformLoading.style.display = 'none';
            });
            
            wavesurfer.on('load', () => {
                console.log('WaveSurfer: Audio loaded successfully');
            });
            
            wavesurfer.on('decode', () => {
                console.log('WaveSurfer: Audio decoded successfully');
            });
        }
        
        function renderAudioList() {
            elements.audioList.innerHTML = '';
            
            audios.forEach(audio => {
                const item = document.createElement('div');
                item.className = 'audio-item';
                item.dataset.audioId = audio.id;
                
                item.innerHTML = \`
                    <div class="audio-icon">🎵</div>
                    <div class="audio-info">
                        <div class="audio-filename">\${audio.filename}</div>
                        <div class="audio-details">
                            <span class="audio-detail-item">\${formatDuration(audio.duration)}</span>
                            <span class="audio-detail-item">\${audio.format.toUpperCase()}</span>
                        </div>
                    </div>
                \`;
                
                item.addEventListener('click', () => loadAudio(audio));
                elements.audioList.appendChild(item);
            });
        }
        
        function setupEventListeners() {
            elements.playPauseBtn.addEventListener('click', togglePlayPause);
            elements.speedSelector.addEventListener('change', changeSpeed);
            elements.volumeSlider.addEventListener('input', changeVolume);
            elements.zoomInBtn.addEventListener('click', () => wavesurfer && wavesurfer.zoom(wavesurfer.params.minPxPerSec * 1.5));
            elements.zoomOutBtn.addEventListener('click', () => wavesurfer && wavesurfer.zoom(wavesurfer.params.minPxPerSec * 0.75));
            
            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                
                switch (e.code) {
                    case 'Space':
                        e.preventDefault();
                        togglePlayPause();
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        if (wavesurfer) wavesurfer.skip(-5);
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        if (wavesurfer) wavesurfer.skip(5);
                        break;
                }
            });
        }
        
        function loadAudio(audio) {
            currentAudio = audio;
            elements.currentAudioTitle.textContent = audio.filename;
            elements.waveformLoading.style.display = 'flex';
            elements.waveformLoading.textContent = 'Loading waveform...';
            elements.playPauseBtn.disabled = true;
            hideError();
            
            // Update active state in list
            document.querySelectorAll('.audio-item').forEach(item => {
                item.classList.toggle('active', item.dataset.audioId === audio.id);
            });
            
            // Show/hide transcript
            if (audio.transcript) {
                elements.transcriptText.textContent = audio.transcript;
                elements.transcript.style.display = 'block';
            } else {
                elements.transcript.style.display = 'none';
            }
            
            // Load audio in WaveSurfer
            if (wavesurfer) {
                try {
                    // Use dataUrl if available, otherwise fall back to uri
                    const audioSource = audio.dataUrl || audio.uri;
                    console.log('Loading audio source:', audioSource ? 'dataUrl' : 'uri');
                    wavesurfer.load(audioSource);
                } catch (error) {
                    console.error('Failed to load audio:', error);
                    showError('Failed to load audio file: ' + error.message);
                }
            }
        }
        
        function togglePlayPause() {
            if (!wavesurfer || !currentAudio) return;
            
            try {
                wavesurfer.playPause();
            } catch (error) {
                console.error('Playback error:', error);
                showError('Playback error: ' + error.message);
            }
        }
        
        function changeSpeed() {
            if (!wavesurfer) return;
            const rate = parseFloat(elements.speedSelector.value);
            try {
                wavesurfer.setPlaybackRate(rate);
            } catch (error) {
                console.error('Speed change error:', error);
            }
        }
        
        function changeVolume() {
            if (!wavesurfer) return;
            const volume = parseInt(elements.volumeSlider.value) / 100;
            try {
                wavesurfer.setVolume(volume);
                updateVolumeIcon(volume);
            } catch (error) {
                console.error('Volume change error:', error);
            }
        }
        
        function updateVolumeIcon(volume) {
            if (volume === 0) {
                elements.volumeIcon.textContent = '🔇';
            } else if (volume < 0.5) {
                elements.volumeIcon.textContent = '🔉';
            } else {
                elements.volumeIcon.textContent = '🔊';
            }
        }
        
        function updateTimeDisplay() {
            if (!wavesurfer || !currentAudio) return;
            
            const current = formatTime(wavesurfer.getCurrentTime() || 0);
            const total = formatTime(wavesurfer.getDuration() || currentAudio.duration);
            elements.timeDisplay.textContent = \`\${current} / \${total}\`;
        }
        
        function updatePlayPauseButton() {
            elements.playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
            elements.playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
        }
        
        function onAudioEnded() {
            // Auto-play next audio if available
            const currentIndex = audios.findIndex(a => a.id === currentAudio.id);
            if (currentIndex < audios.length - 1) {
                loadAudio(audios[currentIndex + 1]);
                setTimeout(() => {
                    if (wavesurfer) wavesurfer.play();
                }, 100);
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
        
        function showError(message) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.style.display = 'block';
        }
        
        function hideError() {
            elements.errorMessage.style.display = 'none';
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

  /**
   * Generate a random nonce for CSP
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}