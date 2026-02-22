import { reaction } from "mobx";
import * as vscode from "vscode";
import { store, CodeTourStepImage, CodeTourStepAudio } from "../store";
import { IMAGE_COLOR_PRESETS } from "../constants";
import { saveTour } from "../recorder/commands";
import { addImageToStep, updateImageColor, updateImageCaption } from "../utils/imageStorage";
import { getClipboardImage } from "../utils/clipboard";
import { convertAudiosToDataUrls, updateAudioCaption } from "../utils/audioStorage";

export class ImageGalleryPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codetourEnhanced.imageGallery";

  private _view?: vscode.WebviewView;
  private _currentIndex = 0;
  private _mode: 'images' | 'audio' = 'images';
  private _audioIndex = 0;
  private _initialized = false;
  private _disposables: vscode.Disposable[] = [];
  private _pendingAutoPlay = false;
  private _isPlaying = false;
  private _playingIndex: number | null = null;
  private _onPlaybackStarted?: (index: number) => void;
  private _onPlaybackStopped?: () => void;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public setOnPlaybackStarted(callback: (index: number) => void) {
    this._onPlaybackStarted = callback;
  }

  public setOnPlaybackStopped(callback: () => void) {
    this._onPlaybackStopped = callback;
  }

  public stopAudioPlayback() {
    this._view?.webview.postMessage({ type: 'stopPlayback' });
  }

  public async playAudioAtIndex(index: number) {
    this._mode = 'audio';
    this._audioIndex = index;
    this._pendingAutoPlay = true;
    await this._updateContent();
  }

  public toggleAudioPlayback(index: number) {
    if (this._isPlaying && this._playingIndex === index) {
      this._view?.webview.postMessage({ type: 'togglePlayback' });
    } else {
      this.playAudioAtIndex(index);
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri,
        ...(vscode.workspace.workspaceFolders?.map(f => f.uri) || [])
      ]
    };

    webviewView.webview.onDidReceiveMessage(
      (message) => this._handleMessage(message),
      undefined,
      this._disposables
    );

    const dispose = reaction(
      () => {
        if (!store.activeTour) return null;
        const step = store.activeTour.tour.steps[store.activeTour.step];
        return [
          store.activeTour.step,
          step?.images?.length ?? 0,
          step?.images?.map(i => `${i.id}:${i.color ?? ""}:${i.caption ?? ""}`).join(","),
          step?.audios?.length ?? 0,
          step?.audios?.map(a => `${a.id}:${a.caption ?? ""}`).join(",")
        ];
      },
      () => this._updateContent()
    );
    this._disposables.push({ dispose });

    webviewView.onDidDispose(() => {
      this._disposables.forEach(d => d.dispose());
      this._disposables = [];
      this._initialized = false;
    });

    this._updateContent();
  }

  public focusImage(index: number) {
    this._mode = 'images';
    this._currentIndex = index;
    this._updateContent();
  }

  public focusAudio(index: number) {
    this._mode = 'audio';
    this._audioIndex = index;
    this._updateContent();
  }

  public switchMode(mode: 'images' | 'audio') {
    this._mode = mode;
    if (this._view && this._initialized) {
      this._view.webview.postMessage({ type: 'setMode', mode: this._mode });
    } else {
      this._updateContent();
    }
  }

  private _getImages(): CodeTourStepImage[] {
    if (!store.activeTour) return [];
    const step = store.activeTour.tour.steps[store.activeTour.step];
    return step?.images ?? [];
  }

  private _getAudios(): CodeTourStepAudio[] {
    if (!store.activeTour) return [];
    const step = store.activeTour.tour.steps[store.activeTour.step];
    return step?.audios ?? [];
  }

  private async _handleMessage(message: any) {
    switch (message.type) {
      // Mode switching — lightweight, no data reload
      case "switchMode":
        this._mode = message.mode;
        if (this._initialized) {
          this._view?.webview.postMessage({ type: 'setMode', mode: this._mode });
        }
        break;

      // Image navigation
      case "navigatePrev": {
        const images = this._getImages();
        if (images.length <= 1) return;
        this._currentIndex = (this._currentIndex - 1 + images.length) % images.length;
        this._sendImageIndex();
        break;
      }

      case "navigateNext": {
        const images = this._getImages();
        if (images.length <= 1) return;
        this._currentIndex = (this._currentIndex + 1) % images.length;
        this._sendImageIndex();
        break;
      }

      case "navigateTo":
        this._currentIndex = message.index;
        this._sendImageIndex();
        break;

      // Audio navigation
      case "audioNavigatePrev": {
        const audios = this._getAudios();
        if (audios.length <= 1) return;
        this._audioIndex = (this._audioIndex - 1 + audios.length) % audios.length;
        this._sendAudioIndex();
        break;
      }

      case "audioNavigateNext": {
        const audios = this._getAudios();
        if (audios.length <= 1) return;
        this._audioIndex = (this._audioIndex + 1) % audios.length;
        this._sendAudioIndex();
        break;
      }

      case "audioNavigateTo":
        this._audioIndex = message.index;
        this._sendAudioIndex();
        break;

      // Image actions
      case "setColor": {
        if (!store.activeTour) return;
        const { imageId, color } = message;
        updateImageColor(store.activeTour.tour, store.activeTour.step, imageId, color || undefined);
        await saveTour(store.activeTour.tour);
        // Full update needed since color affects thumbs and main image border
        this._updateContent();
        break;
      }

      case "setCaption": {
        if (!store.activeTour) return;
        const { imageId: captionImageId, caption } = message;
        updateImageCaption(store.activeTour.tour, store.activeTour.step, captionImageId, caption || undefined);
        await saveTour(store.activeTour.tour);
        break;
      }

      case "setAudioCaption": {
        if (!store.activeTour) return;
        const { audioId: captionAudioId, caption: audioCaption } = message;
        updateAudioCaption(store.activeTour.tour, store.activeTour.step, captionAudioId, audioCaption || undefined);
        await saveTour(store.activeTour.tour);
        break;
      }

      case "paste": {
        await this._handlePaste(message.dataUrl);
        break;
      }

      case "audioPlaybackStarted":
        this._isPlaying = true;
        this._playingIndex = message.index ?? this._audioIndex;
        this._onPlaybackStarted?.(this._playingIndex!);
        break;

      case "audioPlaybackStopped":
        this._isPlaying = false;
        this._playingIndex = null;
        this._onPlaybackStopped?.();
        break;
    }
  }

  private _sendImageIndex() {
    if (!this._view || !this._initialized) return;
    const images = this._getImages();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || images.length === 0) return;

    const img = images[this._currentIndex];
    const mainUri = this._view.webview.asWebviewUri(
      vscode.Uri.joinPath(workspaceFolder.uri, img.path)
    );

    this._view.webview.postMessage({
      type: 'setImageIndex',
      index: this._currentIndex,
      src: mainUri.toString(),
      color: img.color || '',
      caption: img.caption || '',
      imageId: img.id,
      total: images.length
    });
  }

  private _sendAudioIndex() {
    if (!this._view || !this._initialized) return;
    this._view.webview.postMessage({
      type: 'setAudioIndex',
      index: this._audioIndex
    });
  }

  private async _handlePaste(dataUrl?: string) {
    if (!store.activeTour) return;

    let imageData: Uint8Array | null = null;

    if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
      const matches = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (matches) {
        const binary = atob(matches[1]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        imageData = bytes;
      }
    }

    if (!imageData) {
      const clip = await getClipboardImage();
      if (clip) imageData = new Uint8Array(clip.data);
    }

    if (!imageData) {
      vscode.window.showWarningMessage("No image found in clipboard.");
      return;
    }

    await addImageToStep(store.activeTour.tour, store.activeTour.step, imageData);
    await saveTour(store.activeTour.tour);
    const images = this._getImages();
    this._currentIndex = Math.max(0, images.length - 1);
    this._mode = 'images';
    this._updateContent();
  }

  // ─── CORE UPDATE: postMessage-based ────────────────────────────────

  private async _updateContent() {
    if (!this._view) return;

    if (!this._initialized) {
      this._view.webview.html = this._getInitialHtml(this._view.webview);
      this._initialized = true;
      // Wait for webview JS to parse and be ready for messages
      await new Promise(r => setTimeout(r, 150));
    }

    if (!store.activeTour) {
      this._view.webview.postMessage({ type: 'noTour' });
      return;
    }

    const images = this._prepareImageData();
    const audios = await convertAudiosToDataUrls(this._getAudios());

    // Clamp indices
    if (images.length > 0 && this._currentIndex >= images.length) {
      this._currentIndex = images.length - 1;
    }
    if (audios.length > 0 && this._audioIndex >= audios.length) {
      this._audioIndex = audios.length - 1;
    }

    const autoPlay = this._pendingAutoPlay;
    this._pendingAutoPlay = false;

    this._view.webview.postMessage({
      type: 'fullUpdate',
      mode: this._mode,
      images,
      imageIndex: this._currentIndex,
      audios,
      audioIndex: this._audioIndex,
      colorPresets: Object.keys(IMAGE_COLOR_PRESETS),
      autoPlay
    });
  }

  private _prepareImageData(): { src: string; thumbSrc: string; id: string; filename: string; color?: string; caption?: string }[] {
    if (!this._view) return [];
    const images = this._getImages();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || images.length === 0) return [];

    return images.map(img => {
      const mainUri = this._view!.webview.asWebviewUri(
        vscode.Uri.joinPath(workspaceFolder.uri, img.path)
      );
      const thumbPath = img.thumbnail || img.path;
      const thumbUri = this._view!.webview.asWebviewUri(
        vscode.Uri.joinPath(workspaceFolder.uri, thumbPath)
      );
      return {
        src: mainUri.toString(),
        thumbSrc: thumbUri.toString(),
        id: img.id,
        filename: img.filename,
        color: img.color,
        caption: img.caption
      };
    });
  }

  // ─── SINGLE-PAGE HTML ──────────────────────────────────────────────

  private _getInitialHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    const colorClasses = Object.entries(IMAGE_COLOR_PRESETS).map(([name, hex]) =>
      `.color-bg-${name} { background-color: ${hex}; }
    .thumb.thumb-border-${name} { border-color: ${hex}; }
    .main-img.img-border-${name} { border: 3px solid ${hex}; }`
    ).join("\n    ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' https://unpkg.com; img-src ${webview.cspSource} data:; media-src ${webview.cspSource} data: blob:; connect-src https: data: blob:;">
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-panel-background, var(--vscode-editor-background));
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .mode-toggle {
      display: flex;
      gap: 0;
      padding: 4px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      background: var(--vscode-panel-background, var(--vscode-editor-background));
    }
    .mode-btn {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid var(--vscode-panel-border);
      background: transparent;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      transition: all 0.15s;
    }
    .mode-btn:first-child { border-radius: 3px 0 0 3px; }
    .mode-btn:last-child { border-radius: 0 3px 3px 0; border-left: none; }
    .mode-btn.active {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-foreground);
      font-weight: 500;
    }
    .mode-btn:hover:not(.active) {
      background: var(--vscode-list-hoverBackground);
    }
    .mode-container { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .mode-container.hidden { display: none; }
    .content-panel {
      display: none;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .content-panel.visible { display: flex; }
    .empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      text-align: center;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    /* ── Image Mode ── */
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .counter {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-right: auto;
    }
    ${colorClasses}
    .color-btn {
      width: 18px; height: 18px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.15s;
    }
    .color-btn:hover { transform: scale(1.2); }
    .color-btn.color-active { border-color: var(--vscode-foreground); }
    .nav-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      width: 24px; height: 24px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      display: flex; align-items: center; justify-content: center;
    }
    .nav-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .image-area {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
      min-height: 0;
    }
    .main-img {
      max-width: 95%; max-height: 95%;
      object-fit: contain;
      border-radius: 4px;
      cursor: grab;
      user-select: none;
      -webkit-user-drag: none;
      transition: transform 0.15s ease;
    }
    .main-img.dragging { cursor: grabbing; transition: none; }
    .caption-bar {
      padding: 4px 10px;
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .caption-input {
      width: 100%;
      background: transparent;
      border: 1px solid var(--vscode-input-border, transparent);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: 12px;
      padding: 3px 6px;
      border-radius: 3px;
      outline: none;
    }
    .caption-input:focus { border-color: var(--vscode-focusBorder); }
    .thumb-strip {
      display: flex;
      gap: 6px;
      padding: 6px 10px;
      overflow-x: auto;
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      align-items: center;
      scroll-behavior: smooth;
    }
    .thumb-strip::-webkit-scrollbar { height: 4px; }
    .thumb-strip::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 2px;
    }
    .thumb {
      width: 56px; height: 42px;
      object-fit: cover;
      border-radius: 3px;
      cursor: pointer;
      border: 2px solid transparent;
      flex-shrink: 0;
      transition: transform 0.15s;
    }
    .thumb:hover { transform: scale(1.08); }
    .thumb.active {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    /* ── Audio Mode ── */
    .audio-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .player-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: auto;
      padding: 10px;
      min-height: 0;
    }
    .waveform-box {
      position: relative;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      overflow: hidden;
      margin-bottom: 10px;
      /* Constrain height so double-render can't double the box size */
      max-height: 100px;
    }
    #waveform { height: 80px; overflow: hidden; }
    #waveformProgress {
      position: absolute;
      top: 0; left: 0; bottom: 0;
      width: 0;
      background: rgba(74, 222, 128, 0.13);
      pointer-events: none;
      z-index: 1;
    }
    #waveformCursor {
      position: absolute;
      top: 0; bottom: 0;
      left: 0;
      width: 2px;
      background: #ffc107;
      pointer-events: none;
      z-index: 2;
    }
    .waveform-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 80px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      font-size: 12px;
    }
    .playback-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      background: var(--vscode-input-background);
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .play-btn {
      width: 36px; height: 36px;
      border-radius: 50%;
      border: none;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 16px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .play-btn:hover { background: var(--vscode-button-hoverBackground); }
    .play-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .time-display {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 8px;
      min-width: 70px;
      text-align: center;
    }
    .speed-select {
      padding: 3px 6px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
    }
    .volume-group {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }
    .volume-icon { font-size: 12px; }
    .volume-slider {
      width: 60px; height: 3px;
      border-radius: 2px;
      background: var(--vscode-input-border);
      outline: none; cursor: pointer;
      -webkit-appearance: none;
    }
    .volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 10px; height: 10px;
      border-radius: 50%;
      background: var(--vscode-button-background);
      cursor: pointer;
    }
    .zoom-group {
      display: flex; gap: 3px;
    }
    .zoom-btn {
      width: 22px; height: 22px;
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 3px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px;
    }
    .zoom-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .audio-title {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      padding: 4px 10px;
      display: flex; align-items: center; gap: 6px;
    }
    .playing-indicator {
      display: inline-flex; gap: 1px;
    }
    .playing-bar {
      width: 2px;
      background: var(--vscode-charts-green, #22863a);
      animation: audioBar 1.2s ease-in-out infinite;
    }
    .playing-bar:nth-child(1) { height: 10px; animation-delay: 0s; }
    .playing-bar:nth-child(2) { height: 14px; animation-delay: 0.1s; }
    .playing-bar:nth-child(3) { height: 12px; animation-delay: 0.2s; }
    .playing-bar:nth-child(4) { height: 15px; animation-delay: 0.3s; }
    @keyframes audioBar {
      0%, 40%, 100% { transform: scaleY(0.4); }
      20% { transform: scaleY(1.0); }
    }
    .transcript-box {
      margin-top: 6px;
      padding: 8px 10px;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      border-radius: 0 3px 3px 0;
      font-size: 11px;
      font-style: italic;
      color: var(--vscode-textBlockQuote-foreground);
      line-height: 1.5;
    }
    .transcript-label { font-weight: 600; margin-bottom: 4px; font-style: normal; }
    .error-msg {
      padding: 6px 10px;
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground);
      border-radius: 3px;
      font-size: 11px;
      display: none;
    }
    .audio-strip {
      display: flex;
      gap: 6px;
      padding: 6px 10px;
      overflow-x: auto;
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      align-items: center;
      scroll-behavior: smooth;
    }
    .audio-strip::-webkit-scrollbar { height: 4px; }
    .audio-strip::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 2px;
    }
    .audio-thumb {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      transition: all 0.15s;
      max-width: 100px;
      overflow: hidden;
    }
    .audio-thumb:hover { background: var(--vscode-list-hoverBackground); }
    .audio-thumb.active {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .audio-thumb-icon { font-size: 12px; }
    .audio-thumb-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="mode-toggle">
    <button class="mode-btn active" id="modeBtnImages" data-action="switchMode" data-mode="images">Images</button>
    <button class="mode-btn" id="modeBtnAudio" data-action="switchMode" data-mode="audio">Audio</button>
  </div>

  <!-- IMAGE MODE (visible by default) -->
  <div id="imageMode" class="mode-container">
    <div id="imageEmpty" class="empty" style="display:none"><p>No images for this step. Use Cmd+V to paste an image.</p></div>
    <div id="imageContent" class="content-panel">
      <div class="controls">
        <span class="counter" id="imageCounter">0 / 0</span>
        <span id="colorButtons"></span>
        <button class="nav-btn" data-action="navPrev" title="Previous (Left Arrow)">&#x276E;</button>
        <button class="nav-btn" data-action="navNext" title="Next (Right Arrow)">&#x276F;</button>
      </div>
      <div class="image-area" id="imageArea">
        <img class="main-img" id="mainImg" src="" alt="" />
      </div>
      <div class="caption-bar">
        <input class="caption-input" id="captionInput" type="text" placeholder="Add a caption..." value="" data-image-id="" />
      </div>
      <div class="thumb-strip" id="thumbStrip"></div>
    </div>
  </div>

  <!-- AUDIO MODE (hidden by default) -->
  <div id="audioMode" class="mode-container hidden">
    <div id="audioEmpty" class="empty" style="display:none"><p>No audio recordings for this step.</p></div>
    <div id="audioContent" class="content-panel">
      <div class="audio-controls">
        <span class="counter" id="audioCounter">0 / 0</span>
        <button class="nav-btn" data-action="audioNavPrev" title="Previous">&#x276E;</button>
        <button class="nav-btn" data-action="audioNavNext" title="Next">&#x276F;</button>
      </div>
      <div class="player-area">
        <div class="waveform-box">
          <div class="waveform-loading" id="waveformLoading">Loading waveform...</div>
          <div id="waveform"></div>
          <div id="waveformProgress"></div>
          <div id="waveformCursor"></div>
        </div>
        <div class="playback-controls">
          <button class="play-btn" id="playPauseBtn" disabled>&#x25B6;</button>
          <div class="time-display" id="timeDisplay">0:00 / 0:00</div>
          <select class="speed-select" id="speedSelector">
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1" selected>1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <div class="volume-group">
            <span class="volume-icon" id="volumeIcon">&#x1F50A;</span>
            <input type="range" id="volumeSlider" class="volume-slider" min="0" max="100" value="100">
          </div>
          <div class="zoom-group">
            <button class="zoom-btn" id="zoomOutBtn" title="Zoom Out">-</button>
            <button class="zoom-btn" id="zoomInBtn" title="Zoom In">+</button>
          </div>
        </div>
        <div class="audio-title" id="audioTitle">
          <span id="titleText"></span>
          <div id="playingIndicator" class="playing-indicator" style="display:none;">
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
            <div class="playing-bar"></div>
          </div>
        </div>
        <div class="caption-bar audio-caption-bar">
          <input class="caption-input" id="audioCaptionInput" type="text" placeholder="Add a caption..." value="" data-audio-id="" />
        </div>
        <div id="transcriptBox" class="transcript-box" style="display:none;">
          <div class="transcript-label">Transcript</div>
          <div id="transcriptText"></div>
        </div>
        <div class="error-msg" id="errorMessage"></div>
      </div>
      <div class="audio-strip" id="audioStrip"></div>
    </div>
  </div>

  <div id="noTourOverlay" class="empty" style="display:none"><p>No tour is active.</p></div>

  <script nonce="${nonce}" src="https://unpkg.com/wavesurfer.js@7.4.0/dist/wavesurfer.min.js"></script>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();

      // ── State ──
      var currentMode = 'images';
      var images = [];
      var imageIndex = 0;
      var audios = [];
      var audioIndex = 0;
      var colorPresets = [];
      var wavesurfer = null;
      var wsInitializing = false;
      var wsReady = false;
      var currentAudioSrc = null;
      var autoPlayOnReady = false;

      // ── DOM refs ──
      var el = {
        modeBtnImages: document.getElementById('modeBtnImages'),
        modeBtnAudio: document.getElementById('modeBtnAudio'),
        imageMode: document.getElementById('imageMode'),
        audioMode: document.getElementById('audioMode'),
        imageEmpty: document.getElementById('imageEmpty'),
        imageContent: document.getElementById('imageContent'),
        audioEmpty: document.getElementById('audioEmpty'),
        audioContent: document.getElementById('audioContent'),
        noTourOverlay: document.getElementById('noTourOverlay'),
        imageCounter: document.getElementById('imageCounter'),
        colorButtons: document.getElementById('colorButtons'),
        mainImg: document.getElementById('mainImg'),
        captionInput: document.getElementById('captionInput'),
        thumbStrip: document.getElementById('thumbStrip'),
        imageArea: document.getElementById('imageArea'),
        audioCounter: document.getElementById('audioCounter'),
        audioStrip: document.getElementById('audioStrip'),
        playPauseBtn: document.getElementById('playPauseBtn'),
        timeDisplay: document.getElementById('timeDisplay'),
        speedSelector: document.getElementById('speedSelector'),
        volumeSlider: document.getElementById('volumeSlider'),
        volumeIcon: document.getElementById('volumeIcon'),
        zoomInBtn: document.getElementById('zoomInBtn'),
        zoomOutBtn: document.getElementById('zoomOutBtn'),
        waveformLoading: document.getElementById('waveformLoading'),
        titleText: document.getElementById('titleText'),
        playingIndicator: document.getElementById('playingIndicator'),
        transcriptBox: document.getElementById('transcriptBox'),
        transcriptText: document.getElementById('transcriptText'),
        errorMessage: document.getElementById('errorMessage'),
        waveformProgress: document.getElementById('waveformProgress'),
        waveformCursor: document.getElementById('waveformCursor'),
        audioCaptionInput: document.getElementById('audioCaptionInput')
      };

      // ── Message handler ──
      window.addEventListener('message', function(e) {
        var msg = e.data;
        switch (msg.type) {
          case 'setMode':
            setMode(msg.mode);
            break;
          case 'fullUpdate':
            colorPresets = msg.colorPresets || [];
            images = msg.images || [];
            imageIndex = msg.imageIndex || 0;
            audios = msg.audios || [];
            audioIndex = msg.audioIndex || 0;
            setMode(msg.mode);
            updateImages();
            updateAudio();
            if (msg.autoPlay && audios.length > 0) {
              if (wavesurfer && wsReady) {
                safePlay();
              } else {
                autoPlayOnReady = true;
              }
            }
            break;
          case 'setImageIndex':
            imageIndex = msg.index;
            showImage(msg);
            break;
          case 'setAudioIndex':
            audioIndex = msg.index;
            showAudioByIndex();
            break;
          case 'stopPlayback':
            if (wavesurfer && wavesurfer.isPlaying()) {
              wavesurfer.pause();
            }
            break;
          case 'togglePlayback':
            if (wavesurfer) wavesurfer.playPause();
            break;
          case 'noTour':
            el.imageMode.classList.add('hidden');
            el.audioMode.classList.add('hidden');
            el.noTourOverlay.style.display = 'flex';
            break;
        }
      });

      // ── Mode switching ──
      function setMode(mode) {
        currentMode = mode;
        el.noTourOverlay.style.display = 'none';
        el.imageMode.classList.toggle('hidden', mode !== 'images');
        el.audioMode.classList.toggle('hidden', mode !== 'audio');
        el.modeBtnImages.className = 'mode-btn' + (mode === 'images' ? ' active' : '');
        el.modeBtnAudio.className = 'mode-btn' + (mode === 'audio' ? ' active' : '');
        // Update button labels with counts
        el.modeBtnImages.textContent = 'Images' + (images.length > 0 ? ' (' + images.length + ')' : '');
        el.modeBtnAudio.textContent = 'Audio' + (audios.length > 0 ? ' (' + audios.length + ')' : '');
      }

      // ── Image functions ──
      function updateImages() {
        if (images.length === 0) {
          el.imageEmpty.style.display = 'flex';
          el.imageContent.classList.remove('visible');
          return;
        }
        el.imageEmpty.style.display = 'none';
        el.imageContent.classList.add('visible');

        // Update counter
        el.imageCounter.textContent = (imageIndex + 1) + ' / ' + images.length;

        // Update main image
        var img = images[imageIndex];
        if (img) {
          el.mainImg.src = img.src;
          el.mainImg.alt = img.filename;
          // Remove old border classes, add new
          el.mainImg.className = 'main-img' + (img.color ? ' img-border-' + img.color : '');
          el.captionInput.value = img.caption || '';
          el.captionInput.setAttribute('data-image-id', img.id);
          // Reset zoom on image change
          zoom = 1; panX = 0; panY = 0;
          el.mainImg.style.transform = '';
        }

        // Update color buttons
        if (img) {
          var html = '';
          for (var c = 0; c < colorPresets.length; c++) {
            var name = colorPresets[c];
            var isActive = img.color === name;
            html += '<button class="color-btn color-bg-' + name + (isActive ? ' color-active' : '') + '"'
              + ' data-action="setColor" data-image-id="' + img.id + '"'
              + ' data-color="' + (isActive ? '' : name) + '"'
              + ' title="' + name + '"></button>';
          }
          el.colorButtons.innerHTML = html;
        }

        // Update thumbs
        var thumbHtml = '';
        for (var t = 0; t < images.length; t++) {
          var ti = images[t];
          var active = t === imageIndex ? ' active' : '';
          var borderCls = ti.color ? ' thumb-border-' + ti.color : '';
          thumbHtml += '<img class="thumb' + active + borderCls + '"'
            + ' src="' + ti.thumbSrc + '"'
            + ' alt="' + esc(ti.filename) + '"'
            + ' data-action="navigateTo" data-index="' + t + '"'
            + ' title="' + esc(ti.caption || ti.filename) + '" />';
        }
        el.thumbStrip.innerHTML = thumbHtml;

        // Scroll active thumb into view
        setTimeout(function() {
          var act = el.thumbStrip.querySelector('.thumb.active');
          if (act) act.scrollIntoView({ behavior: 'auto', inline: 'center' });
        }, 30);
      }

      function showImage(msg) {
        if (!msg || images.length === 0) return;
        // Update from targeted message with precomputed data
        imageIndex = msg.index;
        var img = images[imageIndex];
        if (!img) return;
        // Update src/color/caption from message (most current)
        img.src = msg.src || img.src;
        img.color = msg.color || '';
        img.caption = msg.caption || '';
        img.id = msg.imageId || img.id;

        el.imageCounter.textContent = (imageIndex + 1) + ' / ' + (msg.total || images.length);
        el.mainImg.src = img.src;
        el.mainImg.alt = img.filename;
        el.mainImg.className = 'main-img' + (img.color ? ' img-border-' + img.color : '');
        el.captionInput.value = img.caption;
        el.captionInput.setAttribute('data-image-id', img.id);
        zoom = 1; panX = 0; panY = 0;
        el.mainImg.style.transform = '';

        // Update color buttons
        var html = '';
        for (var c = 0; c < colorPresets.length; c++) {
          var name = colorPresets[c];
          var isActive = img.color === name;
          html += '<button class="color-btn color-bg-' + name + (isActive ? ' color-active' : '') + '"'
            + ' data-action="setColor" data-image-id="' + img.id + '"'
            + ' data-color="' + (isActive ? '' : name) + '"'
            + ' title="' + name + '"></button>';
        }
        el.colorButtons.innerHTML = html;

        // Update thumb active states
        var thumbs = el.thumbStrip.querySelectorAll('.thumb');
        for (var i = 0; i < thumbs.length; i++) {
          thumbs[i].classList.toggle('active', i === imageIndex);
        }
        var act = thumbs[imageIndex];
        if (act) act.scrollIntoView({ behavior: 'auto', inline: 'center' });
      }

      // ── Audio functions ──
      function updateAudio() {
        if (audios.length === 0) {
          el.audioEmpty.style.display = 'flex';
          el.audioContent.classList.remove('visible');
          return;
        }
        el.audioEmpty.style.display = 'none';
        el.audioContent.classList.add('visible');

        el.audioCounter.textContent = (audioIndex + 1) + ' / ' + audios.length;

        // Build audio strip
        var stripHtml = '';
        for (var a = 0; a < audios.length; a++) {
          var au = audios[a];
          var act = a === audioIndex ? ' active' : '';
          var fname = au.filename.replace(/\\.[^.]+$/, '');
          stripHtml += '<div class="audio-thumb' + act + '" data-action="audioNavigateTo" data-index="' + a + '"'
            + ' title="' + esc(au.filename) + '">'
            + '<span class="audio-thumb-icon">&#x266B;</span>'
            + '<span class="audio-thumb-name">' + esc(fname) + '</span></div>';
        }
        el.audioStrip.innerHTML = stripHtml;

        // Load the current audio
        var cur = audios[audioIndex];
        if (cur) {
          el.titleText.textContent = cur.filename;
          el.audioCaptionInput.value = cur.caption || '';
          el.audioCaptionInput.setAttribute('data-audio-id', cur.id);
          if (cur.transcript) {
            el.transcriptBox.style.display = 'block';
            el.transcriptText.textContent = cur.transcript;
          } else {
            el.transcriptBox.style.display = 'none';
          }

          var src = cur.dataUrl;
          if (src && src !== currentAudioSrc) {
            currentAudioSrc = src;
            loadAudioInWaveSurfer(src);
          }
        }

        setTimeout(function() {
          var act = el.audioStrip.querySelector('.audio-thumb.active');
          if (act) act.scrollIntoView({ behavior: 'auto', inline: 'center' });
        }, 30);
      }

      function showAudioByIndex() {
        if (audios.length === 0) return;
        if (audioIndex >= audios.length) audioIndex = audios.length - 1;

        el.audioCounter.textContent = (audioIndex + 1) + ' / ' + audios.length;

        // Update strip active
        var thumbs = el.audioStrip.querySelectorAll('.audio-thumb');
        for (var i = 0; i < thumbs.length; i++) {
          thumbs[i].classList.toggle('active', i === audioIndex);
        }
        var act = thumbs[audioIndex];
        if (act) act.scrollIntoView({ behavior: 'auto', inline: 'center' });

        var cur = audios[audioIndex];
        if (cur) {
          el.titleText.textContent = cur.filename;
          el.audioCaptionInput.value = cur.caption || '';
          el.audioCaptionInput.setAttribute('data-audio-id', cur.id);
          if (cur.transcript) {
            el.transcriptBox.style.display = 'block';
            el.transcriptText.textContent = cur.transcript;
          } else {
            el.transcriptBox.style.display = 'none';
          }

          var src = cur.dataUrl;
          if (src && src !== currentAudioSrc) {
            currentAudioSrc = src;
            loadAudioInWaveSurfer(src);
          }
        }
      }

      // ── WaveSurfer ──
      // Autoplay warm-up: first user gesture in this webview unlocks
      // media playback for all future programmatic play() calls.
      var audioUnlocked = false;
      var pendingPlay = false;
      var SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

      document.addEventListener('click', function() {
        if (!audioUnlocked) {
          audioUnlocked = true;
          var s = new Audio(SILENCE);
          s.volume = 0;
          s.play().then(function() { s.pause(); }).catch(function(){});
        }
        if (pendingPlay && wavesurfer && wsReady) {
          pendingPlay = false;
          wavesurfer.play();
        }
      });

      function safePlay() {
        if (!wavesurfer) return;
        try {
          var result = wavesurfer.play();
          if (result && typeof result.catch === 'function') {
            result.catch(function() { pendingPlay = true; });
          }
        } catch(e) { pendingPlay = true; }
      }

      // pendingAudioSrc: set when loadAudioInWaveSurfer is called before
      // WaveSurfer is created. Consumed once initWaveSurfer completes.
      var pendingAudioSrc = null;

      function initWaveSurfer() {
        if (wavesurfer || wsInitializing) return;
        if (typeof WaveSurfer === 'undefined') {
          setTimeout(initWaveSurfer, 100);
          return;
        }
        wsInitializing = true;
        try {
          document.getElementById('waveform').innerHTML = '';
          wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: '#4a90d9',
            progressColor: '#4a90d9',
            cursorColor: 'transparent',
            cursorWidth: 0,
            barWidth: 2,
            barRadius: 3,
            responsive: true,
            height: 80,
            normalize: true,
            interact: true,
            hideScrollbar: false
          });

          wavesurfer.on('ready', function() {
            wsReady = true;
            el.waveformLoading.style.display = 'none';
            el.playPauseBtn.disabled = false;
            updateWsTime();
            if (autoPlayOnReady) {
              autoPlayOnReady = false;
              safePlay();
            }
          });
          wavesurfer.on('loading', function(p) {
            el.waveformLoading.textContent = 'Loading waveform... ' + p + '%';
            el.waveformLoading.style.display = 'flex';
          });
          wavesurfer.on('play', function() {
            el.playPauseBtn.textContent = '\\u23F8';
            el.playingIndicator.style.display = 'inline-flex';
            vscode.postMessage({ type: 'audioPlaybackStarted', index: audioIndex });
          });
          wavesurfer.on('pause', function() {
            el.playPauseBtn.textContent = '\\u25B6';
            el.playingIndicator.style.display = 'none';
            vscode.postMessage({ type: 'audioPlaybackStopped' });
          });
          wavesurfer.on('finish', function() {
            el.playPauseBtn.textContent = '\\u25B6';
            el.playingIndicator.style.display = 'none';
            vscode.postMessage({ type: 'audioPlaybackStopped' });
          });
          wavesurfer.on('timeupdate', updateWsTime);
          wavesurfer.on('error', function(err) {
            el.errorMessage.textContent = 'Audio error: ' + (err.message || err);
            el.errorMessage.style.display = 'block';
            el.waveformLoading.style.display = 'none';
          });

          // Load the pending audio now that WaveSurfer is ready
          if (pendingAudioSrc) {
            doLoad(pendingAudioSrc);
            pendingAudioSrc = null;
          }
        } catch (err) {
          wsInitializing = false;
          el.errorMessage.textContent = 'Failed to init player: ' + err.message;
          el.errorMessage.style.display = 'block';
        }
      }

      function loadAudioInWaveSurfer(src) {
        // Always update pendingAudioSrc — this is the single source of truth
        // for what should be loaded. If WaveSurfer is still initializing,
        // it will pick up the latest value when it's ready.
        pendingAudioSrc = src;

        if (!wavesurfer && !wsInitializing) {
          // First call — kick off WaveSurfer creation
          initWaveSurfer();
          return;
        }
        if (!wavesurfer) {
          // WaveSurfer is still initializing — pendingAudioSrc is set,
          // initWaveSurfer will load it when done
          return;
        }
        // WaveSurfer exists — load directly
        pendingAudioSrc = null;
        doLoad(src);
      }

      function doLoad(src) {
        if (!wavesurfer) return;
        wsReady = false;
        el.waveformLoading.style.display = 'flex';
        el.waveformLoading.textContent = 'Loading waveform...';
        el.playPauseBtn.disabled = true;
        el.errorMessage.style.display = 'none';
        wavesurfer.load(src);
      }

      function updateWsTime() {
        if (!wavesurfer) return;
        var curSec = wavesurfer.getCurrentTime() || 0;
        var durSec = wavesurfer.getDuration() || 0;
        el.timeDisplay.textContent = fmtTime(curSec) + ' / ' + fmtTime(durSec);
        var pct = durSec > 0 ? (curSec / durSec * 100) : 0;
        el.waveformProgress.style.width = pct + '%';
        el.waveformCursor.style.left = pct + '%';
      }

      function fmtTime(s) {
        if (!s || !isFinite(s)) return '0:00';
        var m = Math.floor(s / 60);
        var sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
      }

      // ── Events ──
      // Click delegation
      document.addEventListener('click', function(e) {
        var t = e.target;
        for (var i = 0; i < 3 && t && t !== document; i++) {
          var action = t.getAttribute && t.getAttribute('data-action');
          if (action) {
            switch (action) {
              case 'switchMode':
                vscode.postMessage({ type: 'switchMode', mode: t.getAttribute('data-mode') });
                break;
              case 'navPrev':
                vscode.postMessage({ type: 'navigatePrev' });
                break;
              case 'navNext':
                vscode.postMessage({ type: 'navigateNext' });
                break;
              case 'navigateTo':
                vscode.postMessage({ type: 'navigateTo', index: parseInt(t.getAttribute('data-index')) });
                break;
              case 'setColor':
                vscode.postMessage({
                  type: 'setColor',
                  imageId: t.getAttribute('data-image-id'),
                  color: t.getAttribute('data-color')
                });
                break;
              case 'audioNavPrev':
                vscode.postMessage({ type: 'audioNavigatePrev' });
                break;
              case 'audioNavNext':
                vscode.postMessage({ type: 'audioNavigateNext' });
                break;
              case 'audioNavigateTo':
                vscode.postMessage({ type: 'audioNavigateTo', index: parseInt(t.getAttribute('data-index')) });
                break;
            }
            return;
          }
          t = t.parentElement;
        }
      });

      // Caption input debounce
      var captionTimer;
      el.captionInput.addEventListener('input', function() {
        clearTimeout(captionTimer);
        captionTimer = setTimeout(function() {
          vscode.postMessage({
            type: 'setCaption',
            imageId: el.captionInput.getAttribute('data-image-id'),
            caption: el.captionInput.value
          });
        }, 500);
      });

      // Audio caption input debounce
      var audioCaptionTimer;
      el.audioCaptionInput.addEventListener('input', function() {
        clearTimeout(audioCaptionTimer);
        audioCaptionTimer = setTimeout(function() {
          vscode.postMessage({
            type: 'setAudioCaption',
            audioId: el.audioCaptionInput.getAttribute('data-audio-id'),
            caption: el.audioCaptionInput.value
          });
        }, 500);
      });

      // Audio playback controls
      el.playPauseBtn.addEventListener('click', function() {
        if (wavesurfer) wavesurfer.playPause();
      });
      el.speedSelector.addEventListener('change', function() {
        if (wavesurfer) wavesurfer.setPlaybackRate(parseFloat(el.speedSelector.value));
      });
      el.volumeSlider.addEventListener('input', function() {
        if (!wavesurfer) return;
        var v = parseInt(el.volumeSlider.value) / 100;
        wavesurfer.setVolume(v);
        el.volumeIcon.textContent = v === 0 ? '\\uD83D\\uDD07' : v < 0.5 ? '\\uD83D\\uDD09' : '\\uD83D\\uDD0A';
      });
      el.zoomInBtn.addEventListener('click', function() {
        if (wavesurfer) wavesurfer.zoom(wavesurfer.options.minPxPerSec * 1.5);
      });
      el.zoomOutBtn.addEventListener('click', function() {
        if (wavesurfer) wavesurfer.zoom(wavesurfer.options.minPxPerSec * 0.75);
      });

      // ── Image zoom/pan ──
      var zoom = 1, panX = 0, panY = 0;

      function updateTransform() {
        el.mainImg.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
      }

      el.imageArea.addEventListener('wheel', function(e) {
        e.preventDefault();
        if (e.deltaY < 0) zoom = Math.min(5, zoom + 0.2);
        else { zoom = Math.max(0.5, zoom - 0.2); if (zoom <= 1) { panX = 0; panY = 0; } }
        updateTransform();
      });

      var dragging = false, dragX, dragY, startPX, startPY;
      el.mainImg.addEventListener('mousedown', function(e) {
        if (zoom > 1) {
          e.preventDefault();
          dragging = true;
          dragX = e.clientX; dragY = e.clientY;
          startPX = panX; startPY = panY;
          el.mainImg.classList.add('dragging');
        }
      });
      document.addEventListener('mousemove', function(e) {
        if (dragging) {
          panX = startPX + (e.clientX - dragX);
          panY = startPY + (e.clientY - dragY);
          updateTransform();
        }
      });
      document.addEventListener('mouseup', function() {
        if (dragging) { dragging = false; el.mainImg.classList.remove('dragging'); }
      });

      // ── Keyboard shortcuts ──
      document.addEventListener('keydown', function(e) {
        if (e.target === el.captionInput || e.target === el.audioCaptionInput || e.target.tagName === 'SELECT') return;
        if (currentMode === 'images') {
          switch (e.key) {
            case 'ArrowLeft': e.preventDefault(); vscode.postMessage({ type: 'navigatePrev' }); break;
            case 'ArrowRight': e.preventDefault(); vscode.postMessage({ type: 'navigateNext' }); break;
            case '+': case '=': e.preventDefault(); zoom = Math.min(5, zoom + 0.2); updateTransform(); break;
            case '-': e.preventDefault(); zoom = Math.max(0.5, zoom - 0.2); if (zoom <= 1) { panX = 0; panY = 0; } updateTransform(); break;
            case '0': e.preventDefault(); zoom = 1; panX = 0; panY = 0; updateTransform(); break;
            case '1': case '2': case '3': case '4':
              var ci = parseInt(e.key) - 1;
              if (ci < colorPresets.length && images[imageIndex]) {
                var n = colorPresets[ci];
                vscode.postMessage({ type: 'setColor', imageId: images[imageIndex].id, color: images[imageIndex].color === n ? '' : n });
              }
              break;
          }
        } else {
          switch (e.code) {
            case 'Space': e.preventDefault(); if (wavesurfer) wavesurfer.playPause(); break;
            case 'ArrowLeft': e.preventDefault(); if (wavesurfer) wavesurfer.skip(-5); break;
            case 'ArrowRight': e.preventDefault(); if (wavesurfer) wavesurfer.skip(5); break;
          }
        }
      });

      // ── Paste handler ──
      document.addEventListener('paste', function(e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (items) {
          for (var i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
              var file = items[i].getAsFile();
              if (file) {
                var reader = new FileReader();
                reader.onload = function() {
                  vscode.postMessage({ type: 'paste', dataUrl: reader.result });
                };
                reader.readAsDataURL(file);
                e.preventDefault();
                return;
              }
            }
          }
        }
        vscode.postMessage({ type: 'paste' });
      });

      // ── Utility ──
      function esc(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
    })();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

