// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { CodeTourStepImage } from "../store";
import { EXTENSION_NAME } from "../constants";

/**
 * Interface for managing gallery state
 */
interface ImageGalleryState {
  tourId: string;
  stepIndex: number;
  images: CodeTourStepImage[];
  currentIndex: number;
  isOpen: boolean;
}

/**
 * Gallery Manager - Singleton class for managing image gallery webview
 */
export class GalleryManager {
  private static instance: GalleryManager;
  private panel: vscode.WebviewPanel | undefined;
  private state: ImageGalleryState | undefined;
  private extensionUri: vscode.Uri;

  private constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  public static getInstance(extensionUri?: vscode.Uri): GalleryManager {
    if (!GalleryManager.instance) {
      if (!extensionUri) {
        console.warn("GalleryManager: Extension URI not provided for first initialization, using fallback");
        // Try to get extension URI as fallback
        const extension = vscode.extensions.getExtension('vsls-contrib.codetour');
        extensionUri = extension?.extensionUri;
        
        if (!extensionUri) {
          throw new Error("Extension URI required for gallery manager initialization");
        }
      }
      try {
        GalleryManager.instance = new GalleryManager(extensionUri);
        console.log("GalleryManager: Instance created successfully");
      } catch (error) {
        console.error("GalleryManager: Failed to create instance:", error);
        throw error;
      }
    }
    return GalleryManager.instance;
  }

  /**
   * Opens gallery for specific step images
   */
  public async openGallery(
    tourId: string,
    stepIndex: number,
    images: CodeTourStepImage[],
    initialImagePath?: string
  ): Promise<void> {
    
    // Find initial index if specific image path provided
    let currentIndex = 0;
    if (initialImagePath) {
      const foundIndex = images.findIndex(img => img.path === initialImagePath);
      if (foundIndex >= 0) {
        currentIndex = foundIndex;
      }
    }

    // Update state
    this.state = {
      tourId,
      stepIndex,
      images,
      currentIndex,
      isOpen: true
    };

    // Create or show webview panel
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
    } else {
      this.createWebviewPanel();
    }

    // Update webview content
    await this.updateWebviewContent();
  }

  /**
   * Navigate to next image
   */
  public async nextImage(): Promise<void> {
    if (!this.state || !this.state.isOpen) return;

    this.state.currentIndex = (this.state.currentIndex + 1) % this.state.images.length;
    await this.updateWebviewContent();
  }

  /**
   * Navigate to previous image
   */
  public async previousImage(): Promise<void> {
    if (!this.state || !this.state.isOpen) return;

    this.state.currentIndex = this.state.currentIndex === 0 
      ? this.state.images.length - 1 
      : this.state.currentIndex - 1;
    await this.updateWebviewContent();
  }

  /**
   * Navigate to specific image index
   */
  public async goToImage(index: number): Promise<void> {
    if (!this.state || !this.state.isOpen) return;
    if (index < 0 || index >= this.state.images.length) return;

    this.state.currentIndex = index;
    await this.updateWebviewContent();
  }

  /**
   * Close gallery
   */
  public closeGallery(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
    if (this.state) {
      this.state.isOpen = false;
    }
  }

  /**
   * Get current gallery state
   */
  public getState(): ImageGalleryState | undefined {
    return this.state;
  }

  /**
   * Create webview panel
   */
  private createWebviewPanel(): void {
    this.panel = vscode.window.createWebviewPanel(
      'imageGallery',
      'Image Gallery',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [
          this.extensionUri,
          ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri) || [])
        ],
        retainContextWhenHidden: true
      }
    );

    // Handle panel disposal
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      if (this.state) {
        this.state.isOpen = false;
      }
    });

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      message => this.handleWebviewMessage(message),
      undefined
    );
  }

  /**
   * Handle messages from webview
   */
  private async handleWebviewMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'next':
        await this.nextImage();
        break;
      case 'previous':
        await this.previousImage();
        break;
      case 'goto':
        await this.goToImage(message.index);
        break;
      case 'close':
        this.closeGallery();
        break;
      case 'ready':
        // Webview is ready, update content
        await this.updateWebviewContent();
        break;
    }
  }

  /**
   * Update webview content
   */
  private async updateWebviewContent(): Promise<void> {
    if (!this.panel || !this.state || !this.state.isOpen) return;

    const currentImage = this.state.images[this.state.currentIndex];
    if (!currentImage) return;

    // Convert image path to webview URI
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    const imageUri = vscode.Uri.joinPath(workspaceFolder.uri, currentImage.path);
    const webviewImageUri = this.panel.webview.asWebviewUri(imageUri);

    // Generate thumbnail URIs for navigation
    const thumbnails = await Promise.all(
      this.state.images.map(async (img, index) => {
        const imgUri = vscode.Uri.joinPath(workspaceFolder.uri, img.path);
        const thumbnailUri = img.thumbnail 
          ? vscode.Uri.joinPath(workspaceFolder.uri, img.thumbnail)
          : imgUri;
        
        return {
          index,
          filename: img.filename,
          caption: img.caption,
          webviewUri: this.panel!.webview.asWebviewUri(thumbnailUri),
          isActive: index === this.state!.currentIndex
        };
      })
    );

    this.panel.webview.html = this.generateHTML(
      webviewImageUri,
      currentImage,
      this.state.currentIndex,
      this.state.images.length,
      thumbnails
    );
  }

  /**
   * Generate HTML for gallery webview
   */
  private generateHTML(
    imageUri: vscode.Uri,
    currentImage: CodeTourStepImage,
    currentIndex: number,
    totalImages: number,
    thumbnails: Array<{
      index: number;
      filename: string;
      caption?: string;
      webviewUri: vscode.Uri;
      isActive: boolean;
    }>
  ): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Image Gallery</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      height: 100vh;
      overflow: hidden;
    }
    
    .gallery-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.9);
      display: flex;
      flex-direction: column;
      z-index: 1000;
    }
    
    .gallery-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      background-color: var(--vscode-titleBar-activeBackground);
      border-bottom: 1px solid var(--vscode-titleBar-border);
    }
    
    .gallery-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .gallery-counter {
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
    }
    
    .close-button {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      font-size: 24px;
      cursor: pointer;
      padding: 5px;
      border-radius: 3px;
      transition: background-color 0.2s;
    }
    
    .close-button:hover {
      background-color: var(--vscode-toolbar-hoverBackground);
    }
    
    .gallery-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      padding: 20px;
    }
    
    .image-container {
      max-width: 90%;
      max-height: 90%;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .main-image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }
    
    .nav-button {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      z-index: 10;
    }
    
    .nav-button:hover {
      background-color: var(--vscode-button-hoverBackground);
      transform: translateY(-50%) scale(1.1);
    }
    
    .nav-button.prev {
      left: -80px;
    }
    
    .nav-button.next {
      right: -80px;
    }
    
    .image-info {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 20px;
      text-align: center;
      max-width: 80%;
    }
    
    .image-filename {
      font-weight: bold;
      margin-bottom: 4px;
    }
    
    .image-caption {
      font-size: 14px;
      opacity: 0.9;
    }
    
    .thumbnail-strip {
      background-color: var(--vscode-sideBar-background);
      border-top: 1px solid var(--vscode-sideBar-border);
      padding: 15px;
      display: flex;
      justify-content: center;
      gap: 10px;
      overflow-x: auto;
      max-height: 120px;
    }
    
    .thumbnail {
      width: 80px;
      height: 60px;
      border-radius: 4px;
      cursor: pointer;
      object-fit: cover;
      border: 2px solid transparent;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    
    .thumbnail:hover {
      transform: scale(1.05);
    }
    
    .thumbnail.active {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 2px var(--vscode-focusBorder);
    }
    
    .keyboard-hint {
      position: absolute;
      bottom: 100px;
      right: 20px;
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      opacity: 0.7;
    }
    
    @media (max-width: 768px) {
      .nav-button.prev {
        left: 10px;
      }
      
      .nav-button.next {
        right: 10px;
      }
      
      .thumbnail {
        width: 60px;
        height: 45px;
      }
    }
  </style>
</head>
<body>
  <div class="gallery-overlay">
    <div class="gallery-header">
      <div class="gallery-title">
        <span>📎 Image Gallery</span>
        <span class="gallery-counter">${currentIndex + 1} / ${totalImages}</span>
      </div>
      <button class="close-button" onclick="closeGallery()" title="Close Gallery (Escape)">×</button>
    </div>
    
    <div class="gallery-main">
      <div class="image-container">
        <img class="main-image" src="${imageUri}" alt="${currentImage.filename}" />
        
        ${totalImages > 1 ? `
          <button class="nav-button prev" onclick="previousImage()" title="Previous Image (← Arrow)">❮</button>
          <button class="nav-button next" onclick="nextImage()" title="Next Image (→ Arrow)">❯</button>
        ` : ''}
        
        <div class="image-info">
          <div class="image-filename">${currentImage.filename}</div>
          ${currentImage.caption ? `<div class="image-caption">${currentImage.caption}</div>` : ''}
        </div>
      </div>
      
      <div class="keyboard-hint">
        Use ← → keys to navigate • ESC to close
      </div>
    </div>
    
    ${totalImages > 1 ? `
      <div class="thumbnail-strip">
        ${thumbnails.map(thumb => `
          <img class="thumbnail ${thumb.isActive ? 'active' : ''}" 
               src="${thumb.webviewUri}" 
               alt="${thumb.filename}"
               title="${thumb.filename}${thumb.caption ? ': ' + thumb.caption : ''}"
               onclick="goToImage(${thumb.index})" />
        `).join('')}
      </div>
    ` : ''}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    // Notify extension that webview is ready
    vscode.postMessage({ type: 'ready' });
    
    function nextImage() {
      vscode.postMessage({ type: 'next' });
    }
    
    function previousImage() {
      vscode.postMessage({ type: 'previous' });
    }
    
    function goToImage(index) {
      vscode.postMessage({ type: 'goto', index: index });
    }
    
    function closeGallery() {
      vscode.postMessage({ type: 'close' });
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (event) => {
      switch(event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          previousImage();
          break;
        case 'ArrowRight':
          event.preventDefault();
          nextImage();
          break;
        case 'Escape':
          event.preventDefault();
          closeGallery();
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          event.preventDefault();
          const index = parseInt(event.key) - 1;
          if (index < ${totalImages}) {
            goToImage(index);
          }
          break;
      }
    });
    
    // Close on overlay click (outside image)
    document.querySelector('.gallery-overlay').addEventListener('click', (event) => {
      if (event.target.classList.contains('gallery-overlay') || 
          event.target.classList.contains('gallery-main')) {
        closeGallery();
      }
    });
  </script>
</body>
</html>`;
  }

  /**
   * Register gallery navigation commands
   */
  public static registerCommands(): void {
    // Next image command
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.gallery.next`,
      () => {
        const manager = GalleryManager.getInstance();
        manager.nextImage();
      }
    );

    // Previous image command
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.gallery.previous`,
      () => {
        const manager = GalleryManager.getInstance();
        manager.previousImage();
      }
    );

    // Close gallery command
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.gallery.close`,
      () => {
        const manager = GalleryManager.getInstance();
        manager.closeGallery();
      }
    );
  }
}