import { reaction } from "mobx";
import * as vscode from "vscode";
import { store, CodeTourStepImage } from "../store";
import { IMAGE_COLOR_PRESETS } from "../constants";
import { saveTour } from "../recorder/commands";
import { addImageToStep, removeImageFromStep } from "../utils/imageStorage";
import { getClipboardImage } from "../utils/clipboard";
import { ImageGalleryPanelProvider } from "./imageGalleryPanel";

export class StepImagesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codetourEnhanced.stepImages";

  private _view?: vscode.WebviewView;
  private _galleryProvider?: ImageGalleryPanelProvider;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public setGalleryProvider(provider: ImageGalleryPanelProvider) {
    this._galleryProvider = provider;
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

  private _getImages(): CodeTourStepImage[] {
    if (!store.activeTour) return [];
    const step = store.activeTour.tour.steps[store.activeTour.step];
    return step?.images ?? [];
  }

  private async _handleMessage(message: any) {
    switch (message.type) {
      case "openInGallery": {
        if (this._galleryProvider) {
          this._galleryProvider.focusImage(message.index);
          vscode.commands.executeCommand("codetourEnhanced.imageGallery.focus");
        }
        break;
      }

      case "remove": {
        if (!store.activeTour) return;
        const confirm = await vscode.window.showWarningMessage(
          "Remove this image?", { modal: true }, "Remove"
        );
        if (confirm !== "Remove") return;
        await removeImageFromStep(store.activeTour.tour, store.activeTour.step, message.imageId);
        await saveTour(store.activeTour.tour);
        this._updateContent();
        break;
      }

      case "paste": {
        await this._handlePaste(message.dataUrl);
        break;
      }

      case "addFromFile": {
        await this._addFromFile();
        break;
      }

      case "addImage": {
        await this._addImageSmartly();
        break;
      }
    }
  }

  private async _addImageSmartly() {
    if (!store.activeTour) return;

    const clip = await getClipboardImage();
    if (clip) {
      await addImageToStep(store.activeTour.tour, store.activeTour.step, new Uint8Array(clip.data));
      await saveTour(store.activeTour.tour);
      this._updateContent();
      return;
    }

    const choice = await vscode.window.showQuickPick(
      [
        { label: "$(file-media) From File", description: "Select an image file", value: "file" },
        { label: "$(clippy) From Clipboard", description: "Copy an image first, then try again", value: "clipboard" }
      ],
      { placeHolder: "No clipboard image found. Add image from..." }
    );

    if (choice?.value === "file") {
      await this._addFromFile();
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
    this._updateContent();
  }

  private async _addFromFile() {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Images: ["png", "jpg", "jpeg", "gif", "webp"] },
      title: "Select an image"
    });
    if (!uris || uris.length === 0 || !store.activeTour) return;

    const fileData = await vscode.workspace.fs.readFile(uris[0]);
    const filename = uris[0].path.split("/").pop() || "image.png";
    await addImageToStep(store.activeTour.tour, store.activeTour.step, fileData, filename);
    await saveTour(store.activeTour.tour);
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
      return this._emptyHtml(nonce, "No tour is active.");
    }

    const stepNum = store.activeTour.step + 1;
    const totalSteps = store.activeTour.tour.steps.length;

    const colorClasses = Object.entries(IMAGE_COLOR_PRESETS).map(([name, hex]) =>
      `.thumb-wrapper.thumb-border-${name} { border-color: ${hex}; }`
    ).join("\n    ");

    if (images.length === 0) {
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
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 12px;
      font-size: 12px;
    }
    .header {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 10px;
    }
    .paste-zone {
      border: 2px dashed var(--vscode-panel-border);
      border-radius: 6px;
      padding: 16px;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .paste-zone:hover {
      border-color: var(--vscode-focusBorder);
    }
    .paste-hint { font-size: 11px; margin-top: 4px; }
    .btn-row { display: flex; gap: 6px; justify-content: center; margin-top: 8px; }
    .add-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .add-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <div class="header">Step ${stepNum} of ${totalSteps} &mdash; No images</div>
  <div class="paste-zone">
    <div>Paste (Cmd+V) or click to add</div>
    <div class="paste-hint">Add an image to this step</div>
    <div class="btn-row">
      <button class="add-btn" data-action="addImage">+ Clipboard</button>
      <button class="add-btn" data-action="addFromFile">From File</button>
    </div>
  </div>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();

      document.addEventListener('click', function(e) {
        var el = e.target;
        for (var i = 0; i < 3 && el && el !== document; i++) {
          var action = el.getAttribute && el.getAttribute('data-action');
          if (action) {
            if (action === 'addImage') vscode.postMessage({ type: 'addImage' });
            else if (action === 'addFromFile') vscode.postMessage({ type: 'addFromFile' });
            return;
          }
          el = el.parentElement;
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

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return this._emptyHtml(nonce, "No workspace folder.");

    const thumbsHtml = images.map((img, idx) => {
      const thumbPath = img.thumbnail || img.path;
      const thumbUri = webview.asWebviewUri(vscode.Uri.joinPath(workspaceFolder.uri, thumbPath));
      const borderClass = img.color ? `thumb-border-${img.color}` : "";
      const captionSnippet = img.caption
        ? `<span class="caption">${escapeHtml(img.caption)}</span>`
        : "";
      return `<div class="thumb-card">
        <div class="thumb-wrapper ${borderClass}">
          <img class="thumb" src="${thumbUri}" alt="${escapeHtml(img.filename)}"
               data-action="openInGallery" data-index="${idx}" title="Click to view in gallery" />
          <button class="remove-btn" data-action="remove" data-image-id="${img.id}" title="Remove">&times;</button>
        </div>
        ${captionSnippet}
      </div>`;
    }).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 8px;
      font-size: 12px;
    }
    ${colorClasses}
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      padding: 0 4px;
    }
    .header-info {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .add-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      width: 22px; height: 22px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      display: flex; align-items: center; justify-content: center;
    }
    .add-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .thumb-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 4px 0;
    }
    .thumb-card {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      max-width: 80px;
    }
    .thumb-wrapper {
      position: relative;
      border: 3px solid var(--vscode-panel-border);
      border-radius: 5px;
      overflow: hidden;
    }
    .thumb {
      width: 72px; height: 54px;
      object-fit: cover;
      display: block;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .thumb:hover { opacity: 0.85; }
    .remove-btn {
      position: absolute;
      top: 1px; right: 1px;
      width: 16px; height: 16px;
      background: rgba(0,0,0,0.6);
      color: #fff;
      border: none;
      border-radius: 2px;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .thumb-wrapper:hover .remove-btn { display: flex; }
    .caption {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 72px;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-info">Step ${stepNum} &mdash; ${images.length} image${images.length !== 1 ? "s" : ""}</span>
    <button class="add-btn" data-action="addImage" title="Add image (clipboard or file)">+</button>
  </div>
  <div class="thumb-strip">
    ${thumbsHtml}
  </div>
  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();

      // Event delegation for all click actions
      document.addEventListener('click', function(e) {
        var el = e.target;
        for (var i = 0; i < 3 && el && el !== document; i++) {
          var action = el.getAttribute && el.getAttribute('data-action');
          if (action) {
            switch (action) {
              case 'openInGallery':
                vscode.postMessage({ type: 'openInGallery', index: parseInt(el.getAttribute('data-index')) });
                break;
              case 'remove':
                vscode.postMessage({ type: 'remove', imageId: el.getAttribute('data-image-id') });
                break;
              case 'addImage':
                vscode.postMessage({ type: 'addImage' });
                break;
              case 'addFromFile':
                vscode.postMessage({ type: 'addFromFile' });
                break;
            }
            return;
          }
          el = el.parentElement;
        }
      });

      // Paste handler
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

  private _emptyHtml(nonce: string, message: string): string {
    return `<!DOCTYPE html>
<html><head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 12px;
      font-size: 12px;
    }
  </style>
</head>
<body><p>${escapeHtml(message)}</p></body></html>`;
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
