import { reaction } from "mobx";
import * as vscode from "vscode";
import { store, CodeTourStepImage } from "../store";
import { IMAGE_COLOR_PRESETS } from "../constants";
import { saveTour } from "../recorder/commands";
import { addImageToStep, updateImageColor, updateImageCaption } from "../utils/imageStorage";
import { getClipboardImage } from "../utils/clipboard";

export class ImageGalleryPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codetourEnhanced.imageGallery";

  private _view?: vscode.WebviewView;
  private _currentIndex = 0;
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
          step?.images?.map(i => `${i.id}:${i.color ?? ""}:${i.caption ?? ""}`).join(",")
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
    this._currentIndex = index;
    this._updateContent();
  }

  private _getImages(): CodeTourStepImage[] {
    if (!store.activeTour) return [];
    const step = store.activeTour.tour.steps[store.activeTour.step];
    return step?.images ?? [];
  }

  private async _handleMessage(message: any) {
    switch (message.type) {
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
    this._updateContent();
  }

  private _updateContent() {
    if (!this._view) return;
    this._view.webview.html = this._getHtml(this._view.webview);
  }

  private _getHtml(webview: vscode.Webview): string {
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
      `.color-bg-${name} { background-color: ${hex}; }\n    .thumb-border-${name} { border-color: ${hex}; }`
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
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
  <div class="controls">
    <span class="counter">${this._currentIndex + 1} / ${images.length}</span>
    ${colorButtonsHtml}
    <button class="nav-btn" data-action="navPrev" title="Previous (Left Arrow)">&#x276E;</button>
    <button class="nav-btn" data-action="navNext" title="Next (Right Arrow)">&#x276F;</button>
  </div>

  <div class="image-area" id="imageArea">
    <img class="main-img" id="mainImg" src="${mainImageUri}" alt="${escapeHtml(currentImage.filename)}" />
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

      // Event delegation: handle all clicks via data-action attributes
      document.addEventListener('click', function(e) {
        var el = e.target;
        // Walk up to find element with data-action (max 3 levels)
        for (var i = 0; i < 3 && el && el !== document; i++) {
          var action = el.getAttribute && el.getAttribute('data-action');
          if (action) {
            switch (action) {
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

      // Caption editing with debounce
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

      // Zoom & pan
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

      // Keyboard shortcuts
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

      // Paste (Cmd+V)
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

      // Scroll active thumbnail into view
      setTimeout(function() {
        var active = document.querySelector('.thumb.active');
        if (active) active.scrollIntoView({ behavior: 'auto', inline: 'center' });
      }, 50);
    })();
  </script>
</body>
</html>`;
  }

  private _emptyHtml(nonce: string, webview: vscode.Webview, message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-panel-background, var(--vscode-editor-background));
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 16px;
      text-align: center;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <p>${escapeHtml(message)}</p>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
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
