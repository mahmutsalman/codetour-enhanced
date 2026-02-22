import { reaction } from "mobx";
import * as vscode from "vscode";
import { store, CodeTourStepAudio } from "../store";
import { saveTour } from "../recorder/commands";
import { removeAudioFromStep } from "../utils/audioStorage";
import { ImageGalleryPanelProvider } from "./imageGalleryPanel";

export class StepAudioViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codetourEnhanced.stepAudio";

  private _view?: vscode.WebviewView;
  private _mediaProvider?: ImageGalleryPanelProvider;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public setMediaProvider(provider: ImageGalleryPanelProvider) {
    this._mediaProvider = provider;
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
          step?.audios?.length ?? 0,
          step?.audios?.map(a => a.id).join(","),
          store.isAudioRecording,
          store.isRecording || store.isEditing
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

  private _getAudios(): CodeTourStepAudio[] {
    if (!store.activeTour) return [];
    const step = store.activeTour.tour.steps[store.activeTour.step];
    return step?.audios ?? [];
  }

  private async _handleMessage(message: any) {
    switch (message.type) {
      case "openInPlayer": {
        if (this._mediaProvider) {
          this._mediaProvider.focusAudio(message.index);
          vscode.commands.executeCommand("codetourEnhanced.imageGallery.focus");
        }
        break;
      }

      case "record": {
        vscode.commands.executeCommand("codetour.startAudioRecording");
        break;
      }

      case "stopRecording": {
        vscode.commands.executeCommand("codetour.stopAudioRecording");
        break;
      }

      case "remove": {
        if (!store.activeTour) return;
        const confirm = await vscode.window.showWarningMessage(
          "Remove this audio recording?", { modal: true }, "Remove"
        );
        if (confirm !== "Remove") return;
        await removeAudioFromStep(store.activeTour.tour, store.activeTour.step, message.audioId);
        await saveTour(store.activeTour.tour);
        this._updateContent();
        break;
      }

      case "addFromFile": {
        vscode.commands.executeCommand("codetour.addAudioFromFile");
        break;
      }
    }
  }

  private _updateContent() {
    if (!this._view) return;
    this._view.webview.html = this._getHtml(this._view.webview);
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const audios = this._getAudios();
    const isEditMode = store.isRecording || store.isEditing;
    const isRecording = store.isAudioRecording;

    if (!store.activeTour) {
      return this._emptyHtml(nonce, "No tour is active.");
    }

    const stepNum = store.activeTour.step + 1;
    const totalSteps = store.activeTour.tour.steps.length;

    if (audios.length === 0 && !isRecording) {
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
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
    .empty-zone {
      border: 2px dashed var(--vscode-panel-border);
      border-radius: 6px;
      padding: 16px;
      text-align: center;
    }
    .empty-hint { font-size: 11px; margin-top: 4px; }
    .btn-row { display: flex; gap: 6px; justify-content: center; margin-top: 8px; }
    .action-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .action-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .action-btn.record-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .action-btn.record-btn:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="header">Step ${stepNum} of ${totalSteps} &mdash; No audio</div>
  <div class="empty-zone">
    <div>No audio recordings</div>
    <div class="empty-hint">Record or add audio to this step</div>
    <div class="btn-row">
      <button class="action-btn record-btn" data-action="record" ${!isEditMode ? 'disabled title="Enter edit mode first"' : ''}>Record</button>
      <button class="action-btn" data-action="addFromFile" ${!isEditMode ? 'disabled' : ''}>From File</button>
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
            if (el.disabled) return;
            vscode.postMessage({ type: action });
            return;
          }
          el = el.parentElement;
        }
      });
    })();
  </script>
</body>
</html>`;
    }

    // Has audios or is recording
    const audioListHtml = audios.map((audio, idx) => {
      const duration = formatDuration(audio.duration);
      const format = audio.format.toUpperCase();
      return `<div class="audio-item" data-action="openInPlayer" data-index="${idx}">
        <div class="audio-icon">&#x266B;</div>
        <div class="audio-info">
          <div class="audio-name">${escapeHtml(audio.filename)}</div>
          <div class="audio-meta">
            <span class="badge">${duration}</span>
            <span class="badge">${format}</span>
          </div>
        </div>
        <button class="remove-btn" data-action="remove" data-audio-id="${audio.id}" title="Remove">&times;</button>
      </div>`;
    }).join("");

    const recordingIndicator = isRecording ? `
      <div class="recording-indicator">
        <span class="rec-dot"></span>
        <span>Recording...</span>
        <button class="action-btn stop-btn" data-action="stopRecording">Stop</button>
      </div>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 8px;
      font-size: 12px;
    }
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
    .header-actions {
      display: flex;
      gap: 4px;
    }
    .action-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 2px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .action-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .action-btn.record-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .action-btn.record-btn:hover { background: var(--vscode-button-hoverBackground); }
    .action-btn.stop-btn {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #fff);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    }
    .recording-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      margin-bottom: 8px;
      background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1));
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      border-radius: 4px;
      font-size: 11px;
      color: var(--vscode-inputValidation-errorForeground, #f48771);
    }
    .rec-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #e51400;
      animation: pulse 1s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .audio-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .audio-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s;
      position: relative;
    }
    .audio-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .audio-icon {
      font-size: 14px;
      flex-shrink: 0;
    }
    .audio-info {
      flex: 1;
      min-width: 0;
    }
    .audio-name {
      font-size: 11px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .audio-meta {
      display: flex;
      gap: 4px;
      margin-top: 2px;
    }
    .badge {
      font-size: 10px;
      padding: 1px 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 6px;
    }
    .remove-btn {
      position: absolute;
      top: 3px; right: 3px;
      width: 16px; height: 16px;
      background: rgba(0,0,0,0.5);
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
    .audio-item:hover .remove-btn { display: flex; }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-info">Step ${stepNum} &mdash; ${audios.length} audio${audios.length !== 1 ? 's' : ''}</span>
    <div class="header-actions">
      ${!isRecording ? `
        <button class="action-btn record-btn" data-action="record" ${!isEditMode ? 'disabled title="Enter edit mode first"' : ''}>Rec</button>
        <button class="action-btn" data-action="addFromFile" ${!isEditMode ? 'disabled' : ''}>+</button>
      ` : ''}
    </div>
  </div>

  ${recordingIndicator}

  <div class="audio-list">
    ${audioListHtml}
  </div>

  <script nonce="${nonce}">
    (function() {
      var vscode = acquireVsCodeApi();
      document.addEventListener('click', function(e) {
        var el = e.target;
        for (var i = 0; i < 4 && el && el !== document; i++) {
          var action = el.getAttribute && el.getAttribute('data-action');
          if (action) {
            if (el.disabled) return;
            switch (action) {
              case 'openInPlayer':
                vscode.postMessage({ type: 'openInPlayer', index: parseInt(el.getAttribute('data-index')) });
                break;
              case 'remove':
                e.stopPropagation();
                vscode.postMessage({ type: 'remove', audioId: el.getAttribute('data-audio-id') });
                break;
              case 'record':
                vscode.postMessage({ type: 'record' });
                break;
              case 'stopRecording':
                vscode.postMessage({ type: 'stopRecording' });
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

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
