import { reaction } from "mobx";
import * as vscode from "vscode";
import { store } from "../store";
import { saveTour } from "../recorder/commands";
import { markdownToDelta, deltaToMarkdown } from "../utils/markdownQuillConverter";

export class StepContentViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codetourEnhanced.stepContent";

  private _view?: vscode.WebviewView;
  private _isEditing = false;
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
        vscode.Uri.joinPath(this._extensionUri, "dist", "assets")
      ]
    };

    webviewView.webview.onDidReceiveMessage(
      (message) => this._handleMessage(message),
      undefined,
      this._disposables
    );

    // MobX reaction: auto-update when step changes
    const dispose = reaction(
      () =>
        store.activeTour
          ? [store.activeTour.step, store.activeTour.tour.title]
          : null,
      () => {
        if (!this._isEditing) {
          this._updateContent();
        }
      }
    );
    this._disposables.push({ dispose });

    webviewView.onDidDispose(() => {
      this._disposables.forEach((d) => d.dispose());
      this._disposables = [];
    });

    this._updateContent();
  }

  public enterEditMode() {
    this._isEditing = true;
    this._updateContent();
  }

  public cancelEdit() {
    this._isEditing = false;
    this._updateContent();
  }

  private async _handleMessage(message: any) {
    switch (message.type) {
      case "save": {
        if (!store.activeTour) return;

        const step =
          store.activeTour.tour.steps[store.activeTour.step];
        if (!step) return;

        step.richDescription = {
          delta: message.delta,
          html: message.html
        };

        // Also update plain description for backward compatibility (lossy for colors)
        step.description = deltaToMarkdown(message.delta);

        await saveTour(store.activeTour.tour);

        this._isEditing = false;
        this._updateContent();
        break;
      }
      case "cancel": {
        this._isEditing = false;
        this._updateContent();
        break;
      }
      case "ready": {
        // Webview loaded, send current content
        this._sendContentToWebview();
        break;
      }
      case "requestEdit": {
        this._isEditing = true;
        this._updateContent();
        break;
      }
    }
  }

  private _updateContent() {
    if (!this._view) return;
    this._view.webview.html = this._getHtml(this._view.webview);
  }

  private _sendContentToWebview() {
    if (!this._view || !store.activeTour) return;

    const step =
      store.activeTour.tour.steps[store.activeTour.step];
    if (!step) return;

    const delta = step.richDescription?.delta || markdownToDelta(step.description);

    this._view.webview.postMessage({
      type: "setContent",
      delta,
      html: step.richDescription?.html || ""
    });
  }

  private _getHtml(webview: vscode.Webview): string {
    const quillCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "assets", "quill.snow.css")
    );
    const quillJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "assets", "quill.js")
    );

    const nonce = getNonce();

    if (!store.activeTour) {
      return `<!DOCTYPE html>
<html><body><p style="color: var(--vscode-descriptionForeground); padding: 12px;">
No tour is active. Start a tour to see step content here.
</p></body></html>`;
    }

    const step = store.activeTour.tour.steps[store.activeTour.step];
    if (!step) {
      return `<!DOCTYPE html>
<html><body><p style="color: var(--vscode-descriptionForeground); padding: 12px;">
No step selected.
</p></body></html>`;
    }

    const currentStep = store.activeTour.step;
    const totalSteps = store.activeTour.tour.steps.length;
    const stepTitle = step.title || `Step ${currentStep + 1}`;

    if (this._isEditing) {
      return this._getEditHtml(webview, quillCssUri, quillJsUri, nonce, step, stepTitle, currentStep, totalSteps);
    }

    const hasRichContent = !!step.richDescription;
    if (hasRichContent) {
      return this._getRichViewHtml(webview, quillCssUri, quillJsUri, nonce, step, stepTitle, currentStep, totalSteps);
    }

    return this._getPlainViewHtml(nonce, step, stepTitle, currentStep, totalSteps);
  }

  /** Rich view: uses Quill in read-only mode so colors render perfectly */
  private _getRichViewHtml(
    webview: vscode.Webview,
    quillCssUri: vscode.Uri,
    quillJsUri: vscode.Uri,
    nonce: string,
    step: any,
    stepTitle: string,
    currentStep: number,
    totalSteps: number
  ): string {
    const delta = JSON.stringify(step.richDescription.delta);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link href="${quillCssUri}" rel="stylesheet">
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 0;
      margin: 0;
    }
    .header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .step-info {
      font-weight: 600;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .step-title {
      font-weight: 600;
      font-size: 14px;
      margin-top: 2px;
    }
    .edit-btn {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
      border: none;
      padding: 4px 10px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
    }
    .edit-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45484d);
    }
    /* Hide Quill toolbar and borders in read-only mode */
    .ql-toolbar.ql-snow { display: none !important; }
    .ql-container.ql-snow {
      border: none !important;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
    }
    .ql-editor {
      color: var(--vscode-foreground);
      padding: 12px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="step-info">Step ${currentStep + 1} of ${totalSteps}</div>
      <div class="step-title">${escapeHtml(stepTitle)}</div>
    </div>
    <button class="edit-btn" id="editBtn">Edit</button>
  </div>
  <div id="editor"></div>
  <script src="${quillJsUri}" nonce="${nonce}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const quill = new Quill('#editor', {
      theme: 'snow',
      readOnly: true,
      modules: { toolbar: false }
    });
    try {
      quill.setContents(${delta});
    } catch (e) {
      console.error('Failed to load delta:', e);
    }
    document.getElementById('editBtn').addEventListener('click', function() {
      vscode.postMessage({ type: 'requestEdit' });
    });
  </script>
</body>
</html>`;
  }

  /** Plain view: for steps without richDescription */
  private _getPlainViewHtml(
    nonce: string,
    step: any,
    stepTitle: string,
    currentStep: number,
    totalSteps: number
  ): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 0;
      margin: 0;
    }
    .header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .step-info {
      font-weight: 600;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .step-title {
      font-weight: 600;
      font-size: 14px;
      margin-top: 2px;
    }
    .edit-btn {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
      border: none;
      padding: 4px 10px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
    }
    .edit-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45484d);
    }
    .content {
      padding: 12px;
      line-height: 1.5;
      word-wrap: break-word;
      overflow-wrap: break-word;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="step-info">Step ${currentStep + 1} of ${totalSteps}</div>
      <div class="step-title">${escapeHtml(stepTitle)}</div>
    </div>
    <button class="edit-btn" id="editBtn">Edit</button>
  </div>
  <div class="content">${escapeHtml(step.description || '')}</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('editBtn').addEventListener('click', function() {
      vscode.postMessage({ type: 'requestEdit' });
    });
  </script>
</body>
</html>`;
  }

  private _getEditHtml(
    webview: vscode.Webview,
    quillCssUri: vscode.Uri,
    quillJsUri: vscode.Uri,
    nonce: string,
    step: any,
    stepTitle: string,
    currentStep: number,
    totalSteps: number
  ): string {
    const delta = step.richDescription?.delta
      ? JSON.stringify(step.richDescription.delta)
      : JSON.stringify(markdownToDelta(step.description || ""));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link href="${quillCssUri}" rel="stylesheet">
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
    }
    .step-info {
      font-weight: 600;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .step-title {
      font-weight: 600;
      font-size: 14px;
      margin-top: 2px;
    }
    .editor-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #editor {
      flex: 1;
      overflow-y: auto;
    }
    .ql-toolbar.ql-snow {
      border: none !important;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border)) !important;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    .ql-container.ql-snow {
      border: none !important;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
    }
    .ql-editor {
      color: var(--vscode-foreground);
      padding: 12px;
      min-height: 100px;
    }
    .ql-editor.ql-blank::before {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    /* Theme-aware Quill toolbar icons */
    .ql-snow .ql-stroke {
      stroke: var(--vscode-foreground) !important;
    }
    .ql-snow .ql-fill {
      fill: var(--vscode-foreground) !important;
    }
    .ql-snow .ql-picker-label {
      color: var(--vscode-foreground) !important;
    }
    .ql-snow .ql-picker-options {
      background: var(--vscode-dropdown-background, #252526) !important;
      border-color: var(--vscode-dropdown-border, #3c3c3c) !important;
    }
    .ql-snow .ql-picker-item {
      color: var(--vscode-dropdown-foreground, #ccc) !important;
    }
    .ql-snow .ql-active .ql-stroke {
      stroke: var(--vscode-focusBorder, #007acc) !important;
    }
    .ql-snow .ql-active .ql-fill {
      fill: var(--vscode-focusBorder, #007acc) !important;
    }
    .ql-snow .ql-active {
      color: var(--vscode-focusBorder, #007acc) !important;
    }
    .button-bar {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    .btn-save {
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      padding: 6px 14px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-save:hover {
      background: var(--vscode-button-hoverBackground, #026ec1);
    }
    .btn-cancel {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
      border: none;
      padding: 6px 14px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-cancel:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45484d);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="step-info">Editing Step ${currentStep + 1} of ${totalSteps}</div>
    <div class="step-title">${escapeHtml(stepTitle)}</div>
  </div>
  <div class="editor-container">
    <div id="editor"></div>
  </div>
  <div class="button-bar">
    <button class="btn-save" id="saveBtn">Save</button>
    <button class="btn-cancel" id="cancelBtn">Cancel</button>
  </div>
  <script src="${quillJsUri}" nonce="${nonce}"></script>
  <script nonce="${nonce}">
    const vsCode = acquireVsCodeApi();

    const quill = new Quill('#editor', {
      theme: 'snow',
      placeholder: 'Write step content...',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'color': [] }, { 'background': [] }],
          [{ 'header': [1, 2, 3, false] }],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }],
          ['code-block', 'blockquote', 'link'],
          ['clean']
        ]
      }
    });

    // Load initial content
    try {
      const delta = ${delta};
      quill.setContents(delta);
    } catch (e) {
      console.error('Failed to load delta:', e);
    }

    // Focus editor
    quill.focus();

    document.getElementById('saveBtn').addEventListener('click', () => {
      const delta = quill.getContents();
      const html = quill.root.innerHTML;
      vsCode.postMessage({ type: 'save', delta: delta, html: html });
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vsCode.postMessage({ type: 'cancel' });
    });

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'setContent') {
        quill.setContents(msg.delta);
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
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
