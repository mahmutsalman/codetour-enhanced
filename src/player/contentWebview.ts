// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { CodeTour, CodeTourStep, store } from "../store";
import { getWorkspaceUri } from "../utils";

let currentPanel: vscode.WebviewPanel | undefined;

/**
 * Shows the full step content in a dedicated webview panel with proper scrolling.
 * This is used as a fallback for steps with very long content that cannot
 * be properly scrolled in VS Code's CommentThread due to max-height limitations.
 */
export async function showFullContentPanel(stepIndex?: number): Promise<void> {
  if (!store.activeTour) {
    vscode.window.showWarningMessage("No active tour.");
    return;
  }

  const tour = store.activeTour.tour;
  const step = tour.steps[stepIndex ?? store.activeTour.step];

  if (!step) {
    vscode.window.showWarningMessage("Step not found.");
    return;
  }

  // Reuse existing panel or create new one
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      "codetourFullContent",
      "Tour Step Content",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  }

  currentPanel.title = `Step ${(stepIndex ?? store.activeTour.step) + 1}: ${step.title || "Content"}`;
  currentPanel.webview.html = generateWebviewContent(step, tour);
}

/**
 * Shows the media gallery for a step in a dedicated webview panel.
 */
export async function showMediaGalleryPanel(stepIndex?: number): Promise<void> {
  if (!store.activeTour) {
    vscode.window.showWarningMessage("No active tour.");
    return;
  }

  const tour = store.activeTour.tour;
  const step = tour.steps[stepIndex ?? store.activeTour.step];

  if (!step) {
    vscode.window.showWarningMessage("Step not found.");
    return;
  }

  const imageCount = step.images?.length || 0;
  const audioCount = step.audios?.length || 0;

  if (imageCount === 0 && audioCount === 0) {
    vscode.window.showInformationMessage("This step has no attachments.");
    return;
  }

  // Reuse existing panel or create new one
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      "codetourMediaGallery",
      "Step Media",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: getLocalResourceRoots(tour)
      }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  }

  currentPanel.title = `Step ${(stepIndex ?? store.activeTour.step) + 1}: Media`;
  currentPanel.webview.html = generateMediaGalleryContent(step, tour, currentPanel.webview);
}

function getLocalResourceRoots(tour: CodeTour): vscode.Uri[] {
  const roots: vscode.Uri[] = [];
  const workspaceUri = getWorkspaceUri(tour);
  if (workspaceUri) {
    roots.push(workspaceUri);
  }
  return roots;
}

function generateWebviewContent(step: CodeTourStep, _tour: CodeTour): string {
  // Basic markdown to HTML conversion for code blocks
  let content = step.description || "";

  // Convert code blocks
  content = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`;
  });

  // Convert inline code
  content = content.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Convert headers
  content = content.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  content = content.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  content = content.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Convert bold and italic
  content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Convert line breaks to paragraphs
  content = content.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tour Step Content</title>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 14px);
      line-height: 1.6;
      color: var(--vscode-foreground, #333);
      background-color: var(--vscode-editor-background, #fff);
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }

    h1, h2, h3 {
      color: var(--vscode-textLink-foreground, #0066cc);
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }

    h1 { font-size: 1.5em; }
    h2 { font-size: 1.3em; }
    h3 { font-size: 1.1em; }

    pre {
      background-color: var(--vscode-textBlockQuote-background, #f4f4f4);
      border: 1px solid var(--vscode-panel-border, #ddd);
      border-radius: 4px;
      padding: 12px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
      font-size: 0.9em;
    }

    code {
      background-color: var(--vscode-textBlockQuote-background, #f4f4f4);
      padding: 2px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
    }

    pre code {
      background: none;
      padding: 0;
    }

    p {
      margin: 0.8em 0;
    }

    strong {
      font-weight: 600;
    }

    .step-title {
      font-size: 1.2em;
      font-weight: 600;
      margin-bottom: 1em;
      padding-bottom: 0.5em;
      border-bottom: 1px solid var(--vscode-panel-border, #ddd);
    }
  </style>
</head>
<body>
  ${step.title ? `<div class="step-title">${escapeHtml(step.title)}</div>` : ''}
  <div class="content">
    ${content}
  </div>
</body>
</html>`;
}

function generateMediaGalleryContent(step: CodeTourStep, tour: CodeTour, webview: vscode.Webview): string {
  const workspaceUri = getWorkspaceUri(tour);

  let imageContent = '';
  if (step.images && step.images.length > 0 && workspaceUri) {
    imageContent = `
      <h2>Images (${step.images.length})</h2>
      <div class="image-gallery">
        ${step.images.map(img => {
          const imageUri = vscode.Uri.joinPath(workspaceUri, img.path);
          const webviewUri = webview.asWebviewUri(imageUri);
          return `
            <div class="image-item">
              <img src="${webviewUri}" alt="${escapeHtml(img.caption || img.filename)}" />
              <div class="image-caption">${escapeHtml(img.caption || img.filename)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  let audioContent = '';
  if (step.audios && step.audios.length > 0 && workspaceUri) {
    audioContent = `
      <h2>Audio Recordings (${step.audios.length})</h2>
      <div class="audio-list">
        ${step.audios.map(audio => {
          const audioUri = vscode.Uri.joinPath(workspaceUri, audio.path);
          const webviewUri = webview.asWebviewUri(audioUri);
          const minutes = Math.floor(audio.duration / 60);
          const seconds = Math.floor(audio.duration % 60);
          const durationText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          return `
            <div class="audio-item">
              <div class="audio-info">
                <span class="audio-name">${escapeHtml(audio.filename)}</span>
                <span class="audio-duration">${durationText}</span>
              </div>
              <audio controls src="${webviewUri}"></audio>
              ${audio.transcript ? `<div class="audio-transcript">"${escapeHtml(audio.transcript)}"</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Step Media</title>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 14px);
      line-height: 1.6;
      color: var(--vscode-foreground, #333);
      background-color: var(--vscode-editor-background, #fff);
      padding: 20px;
    }

    h2 {
      color: var(--vscode-textLink-foreground, #0066cc);
      margin-top: 1em;
      margin-bottom: 0.5em;
      font-size: 1.2em;
    }

    .image-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }

    .image-item {
      border: 1px solid var(--vscode-panel-border, #ddd);
      border-radius: 8px;
      overflow: hidden;
      background: var(--vscode-textBlockQuote-background, #f4f4f4);
    }

    .image-item img {
      width: 100%;
      height: auto;
      display: block;
      cursor: pointer;
    }

    .image-item img:hover {
      opacity: 0.9;
    }

    .image-caption {
      padding: 8px 12px;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground, #666);
    }

    .audio-list {
      margin-top: 16px;
    }

    .audio-item {
      border: 1px solid var(--vscode-panel-border, #ddd);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      background: var(--vscode-textBlockQuote-background, #f4f4f4);
    }

    .audio-info {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .audio-name {
      font-weight: 500;
    }

    .audio-duration {
      color: var(--vscode-descriptionForeground, #666);
      font-size: 0.9em;
    }

    .audio-item audio {
      width: 100%;
      margin-top: 8px;
    }

    .audio-transcript {
      margin-top: 8px;
      font-style: italic;
      color: var(--vscode-descriptionForeground, #666);
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <h1>Step ${(store.activeTour?.step ?? 0) + 1} Media</h1>
  ${imageContent}
  ${audioContent}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
