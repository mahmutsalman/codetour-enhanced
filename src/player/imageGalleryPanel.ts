import { reaction } from "mobx";
import * as vscode from "vscode";
import { store, CodeTourStepImage, CodeTourStepAudio } from "../store";
import { IMAGE_COLOR_PRESETS } from "../constants";
import { saveTour } from "../recorder/commands";
import { addImageToStep, updateImageColor, updateImageCaption } from "../utils/imageStorage";
import { getClipboardImage } from "../utils/clipboard";
import { getAudioUri } from "../utils/audioStorage";

export class ImageGalleryPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codetourEnhanced.imageGallery";

  private _view?: vscode.WebviewView;
  private _currentIndex = 0;
  private _mode: 'images' | 'audio' = 'images';
  private _audioIndex = 0;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

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
          step?.audios?.map(a => a.id).join(",")
        ];
      },
      () => this._updateContent()
    );
    this._disposables.push({ dispose });

    webviewView.onDidDispose(() => {
      this._disposables.forEach(d => d.dispose());
      this._disposables = [];
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
    this._updateContent();
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
      // Mode switching
      case "switchMode":
        this._mode = message.mode;
        this._updateContent();
        break;

      // Image navigation
      case "navigatePrev": {
        const images = this._getImages();
        if (images.length <= 1) return;
        this._currentIndex = (this._currentIndex - 1 + images.length) % images.length;
        this._updateContent();
        break;
      }

      case "navigateNext": {
        const images = this._getImages();
        if (images.length <= 1) return;
        this._currentIndex = (this._currentIndex + 1) % images.length;
        this._updateContent();
        break;
      }

      case "navigateTo":
        this._currentIndex = message.index;
        this._updateContent();
        break;

      // Audio navigation
      case "audioNavigatePrev": {
        const audios = this._getAudios();
        if (audios.length <= 1) return;
        this._audioIndex = (this._audioIndex - 1 + audios.length) % audios.length;
        this._updateContent();
        break;
      }

      case "audioNavigateNext": {
        const audios = this._getAudios();
        if (audios.length <= 1) return;
        this._audioIndex = (this._audioIndex + 1) % audios.length;
        this._updateContent();
        break;
      }

      case "audioNavigateTo":
        this._audioIndex = message.index;
        this._updateContent();
        break;

      // Image actions
      case "setColor": {
        if (!store.activeTour) return;
        const { imageId, color } = message;
        updateImageColor(store.activeTour.tour, store.activeTour.step, imageId, color || undefined);
        await saveTour(store.activeTour.tour);
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

      case "paste": {
        await this._handlePaste(message.dataUrl);
        break;
      }
    }
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

  private _updateContent() {
    if (!this._view) return;
    if (this._mode === 'audio') {
      this._updateAudioContent();
    } else {
      this._view.webview.html = this._getImageHtml(this._view.webview);
    }
  }

  private async _updateAudioContent() {
    if (!this._view) return;
    this._view.webview.html = await this._getAudioHtml(this._view.webview);
  }

  private _getModeToggleHtml(nonce: string): string {
    return `
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
    }`;
  }

  private _getModeToggleBodyHtml(): string {
    const imageCount = this._getImages().length;
    const audioCount = this._getAudios().length;
    return `<div class="mode-toggle">
      <button class="mode-btn ${this._mode === 'images' ? 'active' : ''}"
              data-action="switchMode" data-mode="images">Images${imageCount > 0 ? ` (${imageCount})` : ''}</button>
      <button class="mode-btn ${this._mode === 'audio' ? 'active' : ''}"
              data-action="switchMode" data-mode="audio">Audio${audioCount > 0 ? ` (${audioCount})` : ''}</button>
    </div>`;
  }

  // ─── IMAGE MODE HTML (existing, extracted) ────────────────────────────

  private _getImageHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const images = this._getImages();

    if (!store.activeTour) {
      return this._emptyHtml(nonce, webview, "No tour is active.");
    }

    if (images.length === 0) {
      return this._emptyHtml(nonce, webview, "No images for this step. Use Cmd+V to paste an image.");
    }

    if (this._currentIndex >= images.length) this._currentIndex = images.length - 1;
    if (this._currentIndex < 0) this._currentIndex = 0;

    const currentImage = images[this._currentIndex];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return this._emptyHtml(nonce, webview, "No workspace folder.");

    const mainImageUri = webview.asWebviewUri(
      vscode.Uri.joinPath(workspaceFolder.uri, currentImage.path)
    );

    const colorClasses = Object.entries(IMAGE_COLOR_PRESETS).map(([name, hex]) =>
      `.color-bg-${name} { background-color: ${hex}; }\n    .thumb.thumb-border-${name} { border-color: ${hex}; }\n    .main-img.img-border-${name} { border: 3px solid ${hex}; }`
    ).join("\n    ");

    const thumbsHtml = images.map((img, idx) => {
      const thumbPath = img.thumbnail || img.path;
      const thumbUri = webview.asWebviewUri(vscode.Uri.joinPath(workspaceFolder.uri, thumbPath));
      const active = idx === this._currentIndex ? "active" : "";
      const borderClass = img.color ? `thumb-border-${img.color}` : "";
      return `<img class="thumb ${active} ${borderClass}" src="${thumbUri}" alt="${escapeHtml(img.filename)}"
                   data-action="navigateTo" data-index="${idx}" title="${escapeHtml(img.caption || img.filename)}" />`;
    }).join("");

    const colorButtonsHtml = Object.keys(IMAGE_COLOR_PRESETS).map(name => {
      const isActive = currentImage.color === name;
      return `<button class="color-btn color-bg-${name} ${isActive ? 'color-active' : ''}"
                      data-action="setColor" data-image-id="${currentImage.id}" data-color="${isActive ? '' : name}"
                      title="${name}"></button>`;
    }).join("");

    const captionValue = escapeHtml(currentImage.caption || "");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource} data: blob:; connect-src https: data: blob:;">
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
    ${this._getModeToggleHtml(nonce)}
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
  </style>
</head>
<body>
  ${this._getModeToggleBodyHtml()}

  <div class="controls">
    <span class="counter">${this._currentIndex + 1} / ${images.length}</span>
    ${colorButtonsHtml}
    <button class="nav-btn" data-action="navPrev" title="Previous (Left Arrow)">&#x276E;</button>
    <button class="nav-btn" data-action="navNext" title="Next (Right Arrow)">&#x276F;</button>
  </div>

  <div class="image-area" id="imageArea">
    <img class="main-img ${currentImage.color ? `img-border-${currentImage.color}` : ''}" id="mainImg" src="${mainImageUri}" alt="${escapeHtml(currentImage.filename)}" />
  </div>

  <div class="caption-bar">
    <input class="caption-input" id="captionInput" type="text"
           placeholder="Add a caption..."
           value="${captionValue}"
           data-image-id="${currentImage.id}" />
  </div>

  <div class="thumb-strip" id="thumbStrip">
    ${thumbsHtml}
  </div>

  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      var colorNames = ${JSON.stringify(Object.keys(IMAGE_COLOR_PRESETS))};
      var currentImageId = '${currentImage.id}';
      var currentColor = ${currentImage.color ? `'${currentImage.color}'` : 'null'};

      document.addEventListener('click', function(e) {
        var el = e.target;
        for (var i = 0; i < 3 && el && el !== document; i++) {
          var action = el.getAttribute && el.getAttribute('data-action');
          if (action) {
            switch (action) {
              case 'switchMode':
                vscode.postMessage({ type: 'switchMode', mode: el.getAttribute('data-mode') });
                break;
              case 'navPrev':
                vscode.postMessage({ type: 'navigatePrev' });
                break;
              case 'navNext':
                vscode.postMessage({ type: 'navigateNext' });
                break;
              case 'navigateTo':
                vscode.postMessage({ type: 'navigateTo', index: parseInt(el.getAttribute('data-index')) });
                break;
              case 'setColor':
                vscode.postMessage({
                  type: 'setColor',
                  imageId: el.getAttribute('data-image-id'),
                  color: el.getAttribute('data-color')
                });
                break;
            }
            return;
          }
          el = el.parentElement;
        }
      });

      var captionInput = document.getElementById('captionInput');
      var captionTimer;
      captionInput.addEventListener('input', function() {
        clearTimeout(captionTimer);
        captionTimer = setTimeout(function() {
          vscode.postMessage({
            type: 'setCaption',
            imageId: captionInput.getAttribute('data-image-id'),
            caption: captionInput.value
          });
        }, 500);
      });

      var zoom = 1, panX = 0, panY = 0;
      var mainImg = document.getElementById('mainImg');
      var imageArea = document.getElementById('imageArea');

      function updateTransform() {
        mainImg.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
      }

      imageArea.addEventListener('wheel', function(e) {
        e.preventDefault();
        if (e.deltaY < 0) zoom = Math.min(5, zoom + 0.2);
        else { zoom = Math.max(0.5, zoom - 0.2); if (zoom <= 1) { panX = 0; panY = 0; } }
        updateTransform();
      });

      var dragging = false, dragX, dragY, startPX, startPY;
      mainImg.addEventListener('mousedown', function(e) {
        if (zoom > 1) {
          e.preventDefault();
          dragging = true;
          dragX = e.clientX; dragY = e.clientY;
          startPX = panX; startPY = panY;
          mainImg.classList.add('dragging');
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
        if (dragging) { dragging = false; mainImg.classList.remove('dragging'); }
      });

      document.addEventListener('keydown', function(e) {
        if (e.target === captionInput) return;
        switch (e.key) {
          case 'ArrowLeft': e.preventDefault(); vscode.postMessage({ type: 'navigatePrev' }); break;
          case 'ArrowRight': e.preventDefault(); vscode.postMessage({ type: 'navigateNext' }); break;
          case '+': case '=': e.preventDefault(); zoom = Math.min(5, zoom + 0.2); updateTransform(); break;
          case '-': e.preventDefault(); zoom = Math.max(0.5, zoom - 0.2); if (zoom <= 1) { panX = 0; panY = 0; } updateTransform(); break;
          case '0': e.preventDefault(); zoom = 1; panX = 0; panY = 0; updateTransform(); break;
          case '1': case '2': case '3': case '4':
            var idx = parseInt(e.key) - 1;
            if (idx < colorNames.length) {
              var name = colorNames[idx];
              vscode.postMessage({ type: 'setColor', imageId: currentImageId, color: currentColor === name ? '' : name });
            }
            break;
        }
      });

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

      setTimeout(function() {
        var active = document.querySelector('.thumb.active');
        if (active) active.scrollIntoView({ behavior: 'auto', inline: 'center' });
      }, 50);
    })();
  </script>
</body>
</html>`;
  }

  // ─── AUDIO MODE HTML ──────────────────────────────────────────────────

  private async _getAudioHtml(webview: vscode.Webview): Promise<string> {
    const nonce = getNonce();
    const audios = this._getAudios();

    if (!store.activeTour) {
      return this._emptyHtml(nonce, webview, "No tour is active.");
    }

    if (audios.length === 0) {
      return this._audioEmptyHtml(nonce, webview);
    }

    if (this._audioIndex >= audios.length) this._audioIndex = audios.length - 1;
    if (this._audioIndex < 0) this._audioIndex = 0;

    const audioList = await this._convertAudiosForWebview(audios);

    const audioStripHtml = audios.map((audio, idx) => {
      const active = idx === this._audioIndex ? "active" : "";
      const duration = formatDuration(audio.duration);
      return `<div class="audio-thumb ${active}" data-action="audioNavigateTo" data-index="${idx}"
                   title="${escapeHtml(audio.filename)} (${duration})">
        <span class="audio-thumb-icon">&#x266B;</span>
        <span class="audio-thumb-name">${escapeHtml(audio.filename.replace(/\.[^.]+$/, ''))}</span>
      </div>`;
    }).join("");

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
    ${this._getModeToggleHtml(nonce)}
    .audio-controls {
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
    .player-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: auto;
      padding: 10px;
      min-height: 0;
    }
    .waveform-box {
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      overflow: hidden;
      margin-bottom: 10px;
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
  ${this._getModeToggleBodyHtml()}

  <div class="audio-controls">
    <span class="counter">${this._audioIndex + 1} / ${audios.length}</span>
    <button class="nav-btn" data-action="audioNavPrev" title="Previous">&#x276E;</button>
    <button class="nav-btn" data-action="audioNavNext" title="Next">&#x276F;</button>
  </div>

  <div class="player-area">
    <div class="waveform-box">
      <div class="waveform-loading" id="waveformLoading">Loading waveform...</div>
      <div id="waveform"></div>
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
      <span id="titleText">${escapeHtml(audios[this._audioIndex]?.filename || '')}</span>
      <div id="playingIndicator" class="playing-indicator" style="display:none;">
        <div class="playing-bar"></div>
        <div class="playing-bar"></div>
        <div class="playing-bar"></div>
        <div class="playing-bar"></div>
      </div>
    </div>

    ${audios[this._audioIndex]?.transcript ? `
    <div class="transcript-box">
      <div class="transcript-label">Transcript</div>
      <div>${escapeHtml(audios[this._audioIndex].transcript!)}</div>
    </div>` : ''}

    <div class="error-msg" id="errorMessage"></div>
  </div>

  <div class="audio-strip" id="audioStrip">
    ${audioStripHtml}
  </div>

  <script nonce="${nonce}" src="https://unpkg.com/wavesurfer.js@7.10.1/dist/wavesurfer.min.js"></script>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      var audios = ${JSON.stringify(audioList)};
      var currentAudioIdx = ${this._audioIndex};
      var wavesurfer = null;
      var isPlaying = false;

      var el = {
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
        errorMessage: document.getElementById('errorMessage')
      };

      init();

      function init() {
        if (typeof WaveSurfer === 'undefined') {
          setTimeout(init, 100);
          return;
        }
        initWaveSurfer();
        setupEvents();
        if (audios.length > 0) {
          loadAudio(audios[currentAudioIdx] || audios[0]);
        }
      }

      function initWaveSurfer() {
        try {
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
            interact: true,
            hideScrollbar: false
          });

          wavesurfer.on('ready', function() {
            el.waveformLoading.style.display = 'none';
            el.playPauseBtn.disabled = false;
            updateTime();
          });
          wavesurfer.on('loading', function(p) {
            el.waveformLoading.textContent = 'Loading waveform... ' + p + '%';
            el.waveformLoading.style.display = 'flex';
          });
          wavesurfer.on('play', function() {
            isPlaying = true;
            el.playPauseBtn.textContent = '\\u23F8';
            el.playingIndicator.style.display = 'inline-flex';
          });
          wavesurfer.on('pause', function() {
            isPlaying = false;
            el.playPauseBtn.textContent = '\\u25B6';
            el.playingIndicator.style.display = 'none';
          });
          wavesurfer.on('finish', function() {
            isPlaying = false;
            el.playPauseBtn.textContent = '\\u25B6';
            el.playingIndicator.style.display = 'none';
          });
          wavesurfer.on('timeupdate', updateTime);
          wavesurfer.on('error', function(err) {
            el.errorMessage.textContent = 'Audio error: ' + (err.message || err);
            el.errorMessage.style.display = 'block';
            el.waveformLoading.style.display = 'none';
          });
        } catch (err) {
          el.errorMessage.textContent = 'Failed to init player: ' + err.message;
          el.errorMessage.style.display = 'block';
        }
      }

      function loadAudio(audio) {
        if (!audio || !wavesurfer) return;
        el.waveformLoading.style.display = 'flex';
        el.waveformLoading.textContent = 'Loading waveform...';
        el.playPauseBtn.disabled = true;
        el.errorMessage.style.display = 'none';
        el.titleText.textContent = audio.filename;
        var src = audio.dataUrl || audio.uri;
        if (src) wavesurfer.load(src);
      }

      function updateTime() {
        if (!wavesurfer) return;
        var cur = fmtTime(wavesurfer.getCurrentTime() || 0);
        var dur = fmtTime(wavesurfer.getDuration() || 0);
        el.timeDisplay.textContent = cur + ' / ' + dur;
      }

      function fmtTime(s) {
        if (!s || !isFinite(s)) return '0:00';
        var m = Math.floor(s / 60);
        var sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
      }

      function setupEvents() {
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

        document.addEventListener('click', function(e) {
          var t = e.target;
          for (var i = 0; i < 3 && t && t !== document; i++) {
            var action = t.getAttribute && t.getAttribute('data-action');
            if (action) {
              switch (action) {
                case 'switchMode':
                  vscode.postMessage({ type: 'switchMode', mode: t.getAttribute('data-mode') });
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

        document.addEventListener('keydown', function(e) {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
          switch (e.code) {
            case 'Space': e.preventDefault(); if (wavesurfer) wavesurfer.playPause(); break;
            case 'ArrowLeft': e.preventDefault(); if (wavesurfer) wavesurfer.skip(-5); break;
            case 'ArrowRight': e.preventDefault(); if (wavesurfer) wavesurfer.skip(5); break;
          }
        });
      }

      setTimeout(function() {
        var active = document.querySelector('.audio-thumb.active');
        if (active) active.scrollIntoView({ behavior: 'auto', inline: 'center' });
      }, 50);
    })();
  </script>
</body>
</html>`;
  }

  private _audioEmptyHtml(nonce: string, webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-panel-background, var(--vscode-editor-background));
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    ${this._getModeToggleHtml(nonce)}
    .empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      text-align: center;
      font-size: 12px;
    }
  </style>
</head>
<body>
  ${this._getModeToggleBodyHtml()}
  <div class="empty"><p>No audio recordings for this step.</p></div>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      document.addEventListener('click', function(e) {
        var t = e.target;
        for (var i = 0; i < 3 && t && t !== document; i++) {
          var action = t.getAttribute && t.getAttribute('data-action');
          if (action === 'switchMode') {
            vscode.postMessage({ type: 'switchMode', mode: t.getAttribute('data-mode') });
            return;
          }
          t = t.parentElement;
        }
      });
    })();
  </script>
</body>
</html>`;
  }

  // ─── AUDIO DATA CONVERSION ────────────────────────────────────────────

  private async _convertAudiosForWebview(audios: CodeTourStepAudio[]): Promise<any[]> {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) return [];

    const results = await Promise.all(audios.map(async (audio) => {
      try {
        const audioUri = getAudioUri(audio, workspaceUri);
        const audioData = await vscode.workspace.fs.readFile(audioUri);
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

    return results;
  }

  // ─── EMPTY HTML (shared) ──────────────────────────────────────────────

  private _emptyHtml(nonce: string, webview: vscode.Webview, message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource} data: blob:; connect-src https: data: blob:;">
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-panel-background, var(--vscode-editor-background));
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    ${this._getModeToggleHtml(nonce)}
    .empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      text-align: center;
      font-size: 12px;
    }
  </style>
</head>
<body>
  ${this._getModeToggleBodyHtml()}
  <div class="empty"><p>${escapeHtml(message)}</p></div>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      document.addEventListener('click', function(e) {
        var t = e.target;
        for (var i = 0; i < 3 && t && t !== document; i++) {
          var action = t.getAttribute && t.getAttribute('data-action');
          if (action === 'switchMode') {
            vscode.postMessage({ type: 'switchMode', mode: t.getAttribute('data-mode') });
            return;
          }
          t = t.parentElement;
        }
      });
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getMimeType(format: string): string {
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
