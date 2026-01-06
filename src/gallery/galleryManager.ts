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
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: 1fr auto;
      z-index: 1000;
    }

    .gallery-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 12px;
      gap: 16px;
      background-color: rgba(0, 0, 0, 0.95);
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      grid-row: 1 / -1;
    }

    .gallery-title {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      text-align: center;
      writing-mode: horizontal-tb;
    }

    .gallery-counter {
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 4px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }

    .zoom-controls {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .zoom-button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border);
      width: 26px;
      height: 26px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .zoom-button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .zoom-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .zoom-level {
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      min-width: 38px;
      text-align: center;
    }
    
    .close-button {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(0, 0, 0, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: var(--vscode-foreground);
      font-size: 24px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: all 0.2s;
      z-index: 20;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-button:hover {
      background-color: rgba(0, 0, 0, 0.9);
      transform: scale(1.05);
    }

    .info-icon {
      position: absolute;
      bottom: 16px;
      left: 16px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background-color: rgba(0, 0, 0, 0.6);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      cursor: help;
      z-index: 15;
      transition: all 0.2s;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .info-icon:hover {
      background-color: rgba(0, 0, 0, 0.8);
      transform: scale(1.05);
    }

    .info-tooltip {
      position: absolute;
      bottom: 52px;
      left: 16px;
      background-color: rgba(0, 0, 0, 0.95);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.6;
      max-width: 300px;
      z-index: 20;
      pointer-events: none;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .info-icon:hover + .info-tooltip {
      opacity: 1;
      transform: translateY(0);
    }

    .info-tooltip-title {
      font-weight: bold;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      color: #4fc3f7;
    }

    .info-tooltip-section {
      margin-bottom: 10px;
    }

    .info-tooltip-section:last-child {
      margin-bottom: 0;
    }

    .info-tooltip-label {
      font-weight: 600;
      opacity: 0.8;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .info-tooltip-value {
      color: #ffffff;
      word-break: break-word;
    }

    .info-tooltip-kbd {
      display: inline-block;
      background-color: rgba(255, 255, 255, 0.15);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 11px;
      margin: 0 2px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    .gallery-main {
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      padding: 20px;
      overflow: hidden;
      min-height: 0; /* Important for grid item to shrink */
    }
    
    .image-container {
      width: 100%;
      height: 100%;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .main-image {
      max-width: 95%;
      max-height: 95%;
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      transition: transform 0.2s ease;
      cursor: grab;
      user-select: none;
      -webkit-user-drag: none;
    }
    
    .main-image.zoomed {
      cursor: grab;
    }
    
    .main-image.dragging {
      cursor: grabbing;
      transition: none;
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
    
    .thumbnail-strip {
      background-color: var(--vscode-sideBar-background);
      border-top: 1px solid var(--vscode-sideBar-border);
      padding: 15px;
      display: flex;
      justify-content: flex-start;
      gap: 10px;
      overflow-x: auto;
      min-height: 90px;
      max-height: 120px;
      height: auto;
      align-items: center;
      scroll-behavior: smooth;
      grid-column: 1 / -1;
    }
    
    .thumbnail-strip::-webkit-scrollbar {
      height: 6px;
    }
    
    .thumbnail-strip::-webkit-scrollbar-track {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 3px;
    }
    
    .thumbnail-strip::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-hoverBackground);
      border-radius: 3px;
    }
    
    .thumbnail-strip::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-activeBackground);
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
    
    /* Responsive adjustments */
    @media (max-width: 768px) {
      .gallery-header {
        padding: 12px 8px;
        gap: 12px;
      }

      .gallery-title {
        font-size: 11px;
      }

      .gallery-counter {
        font-size: 10px;
        padding: 3px 6px;
      }

      .zoom-button {
        width: 28px;
        height: 28px;
        font-size: 12px;
      }

      .zoom-level {
        font-size: 9px;
        min-width: 34px;
        padding: 3px 6px;
      }

      .gallery-main {
        padding: 10px;
      }

      .close-button {
        width: 28px;
        height: 28px;
        font-size: 20px;
      }

      .info-icon {
        bottom: 12px;
        left: 12px;
        width: 24px;
        height: 24px;
        font-size: 12px;
      }

      .info-tooltip {
        bottom: 44px;
        left: 12px;
        max-width: 250px;
        font-size: 11px;
        padding: 10px 14px;
      }

      .nav-button.prev {
        left: 10px;
        width: 40px;
        height: 40px;
        font-size: 16px;
      }

      .nav-button.next {
        right: 10px;
        width: 40px;
        height: 40px;
        font-size: 16px;
      }

      .thumbnail {
        width: 60px;
        height: 45px;
      }

      .thumbnail-strip {
        min-height: 75px;
        max-height: 90px;
        padding: 10px;
      }
    }

    /* Very small screens */
    @media (max-width: 480px) {
      .gallery-header {
        padding: 10px 6px;
        gap: 10px;
      }

      .gallery-title {
        font-size: 10px;
      }

      .gallery-counter {
        font-size: 9px;
        padding: 2px 5px;
      }

      .zoom-button {
        width: 26px;
        height: 26px;
        font-size: 11px;
      }

      .zoom-level {
        font-size: 8px;
        min-width: 32px;
        padding: 2px 5px;
      }

      .close-button {
        width: 26px;
        height: 26px;
        font-size: 18px;
      }

      .info-icon {
        bottom: 10px;
        left: 10px;
        width: 20px;
        height: 20px;
        font-size: 11px;
      }

      .info-tooltip {
        bottom: 38px;
        left: 10px;
        max-width: 200px;
        font-size: 10px;
        padding: 8px 12px;
      }

      .thumbnail {
        width: 50px;
        height: 38px;
      }

      .thumbnail-strip {
        min-height: 68px;
        max-height: 80px;
        gap: 8px;
      }
    }
    
    /* Large screens - optimize for very tall images */
    @media (min-height: 900px) {
      .thumbnail-strip {
        min-height: 100px;
        max-height: 140px;
        padding: 20px;
      }
      
      .thumbnail {
        width: 90px;
        height: 68px;
      }
    }
  </style>
</head>
<body>
  <div class="gallery-overlay">
    <div class="gallery-header">
      <div class="gallery-title">
        <span>📎</span>
        <span>Gallery</span>
        <span class="gallery-counter">${currentIndex + 1}/${totalImages}</span>
      </div>
      <div class="zoom-controls">
        <button class="zoom-button" onclick="zoomIn()" title="Zoom In (+)">+</button>
        <span class="zoom-level" id="zoom-level">100%</span>
        <button class="zoom-button" onclick="zoomOut()" title="Zoom Out (-)">−</button>
        <button class="zoom-button" onclick="resetZoom()" title="Reset Zoom (0)">⌂</button>
      </div>
    </div>

    <button class="close-button" onclick="closeGallery()" title="Close Gallery (Escape)">×</button>
    
    <div class="gallery-main">
      <div class="image-container">
        <div class="info-icon">i</div>
        <div class="info-tooltip">
          <div class="info-tooltip-title">Image Information</div>
          <div class="info-tooltip-section">
            <div class="info-tooltip-label">Filename</div>
            <div class="info-tooltip-value">${currentImage.filename}</div>
          </div>
          ${currentImage.caption ? `
            <div class="info-tooltip-section">
              <div class="info-tooltip-label">Caption</div>
              <div class="info-tooltip-value">${currentImage.caption}</div>
            </div>
          ` : ''}
          <div class="info-tooltip-section">
            <div class="info-tooltip-label">Keyboard Shortcuts</div>
            <div class="info-tooltip-value">
              <span class="info-tooltip-kbd">←</span> <span class="info-tooltip-kbd">→</span> Navigate
              <br>
              <span class="info-tooltip-kbd">+</span> <span class="info-tooltip-kbd">−</span> Zoom
              <br>
              <span class="info-tooltip-kbd">ESC</span> Close
            </div>
          </div>
        </div>

        <img class="main-image" id="main-image" src="${imageUri}" alt="${currentImage.filename}" />

        ${totalImages > 1 ? `
          <button class="nav-button prev" onclick="previousImage()" title="Previous Image (← Arrow)">❮</button>
          <button class="nav-button next" onclick="nextImage()" title="Next Image (→ Arrow)">❯</button>
        ` : ''}
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
      scrollThumbnailIntoView(index);
    }
    
    function closeGallery() {
      vscode.postMessage({ type: 'close' });
    }
    
    // Zoom functionality
    let zoomLevel = 1;
    let panX = 0;
    let panY = 0;
    const minZoom = 0.5;
    const maxZoom = 5;
    const zoomStep = 0.2;
    
    function updateImageTransform() {
      const image = document.getElementById('main-image');
      const zoomLevelElement = document.getElementById('zoom-level');
      
      image.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoomLevel})\`;
      zoomLevelElement.textContent = Math.round(zoomLevel * 100) + '%';
      
      // Update cursor based on zoom level
      if (zoomLevel > 1) {
        image.classList.add('zoomed');
      } else {
        image.classList.remove('zoomed');
      }
    }
    
    function zoomIn() {
      if (zoomLevel < maxZoom) {
        zoomLevel = Math.min(maxZoom, zoomLevel + zoomStep);
        updateImageTransform();
      }
    }
    
    function zoomOut() {
      if (zoomLevel > minZoom) {
        zoomLevel = Math.max(minZoom, zoomLevel - zoomStep);
        // Reset pan when zooming out to 1x or below
        if (zoomLevel <= 1) {
          panX = 0;
          panY = 0;
        }
        updateImageTransform();
      }
    }
    
    function resetZoom() {
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      updateImageTransform();
    }
    
    // Auto-scroll active thumbnail into view
    function scrollThumbnailIntoView(activeIndex) {
      const thumbnailStrip = document.querySelector('.thumbnail-strip');
      const thumbnails = document.querySelectorAll('.thumbnail');
      
      if (thumbnailStrip && thumbnails[activeIndex]) {
        const activeThumbnail = thumbnails[activeIndex];
        const stripRect = thumbnailStrip.getBoundingClientRect();
        const thumbRect = activeThumbnail.getBoundingClientRect();
        
        // Check if thumbnail is out of view
        if (thumbRect.left < stripRect.left || thumbRect.right > stripRect.right) {
          activeThumbnail.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
          });
        }
      }
    }
    
    // Initialize thumbnail scroll position on load
    function initializeThumbnailScroll() {
      const activeThumbnail = document.querySelector('.thumbnail.active');
      if (activeThumbnail) {
        activeThumbnail.scrollIntoView({
          behavior: 'auto',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
    
    // Call initialization after a brief delay to ensure DOM is ready
    setTimeout(initializeThumbnailScroll, 100);
    
    // Keyboard navigation with thumbnail scrolling
    document.addEventListener('keydown', (event) => {
      switch(event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          previousImage();
          // Scroll will be handled when the webview updates
          break;
        case 'ArrowRight':
          event.preventDefault();
          nextImage();
          // Scroll will be handled when the webview updates
          break;
        case 'Escape':
          event.preventDefault();
          closeGallery();
          break;
        case '+':
        case '=':
          event.preventDefault();
          zoomIn();
          break;
        case '-':
          event.preventDefault();
          zoomOut();
          break;
        case '0':
          event.preventDefault();
          resetZoom();
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
    
    // Mouse wheel zoom functionality
    const imageContainer = document.querySelector('.image-container');
    imageContainer.addEventListener('wheel', (event) => {
      event.preventDefault();

      if (event.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    });
    
    // Drag to pan functionality
    let isDragging = false;
    let dragStartX, dragStartY;
    let startPanX, startPanY;
    
    const mainImage = document.getElementById('main-image');
    
    mainImage.addEventListener('mousedown', (event) => {
      if (zoomLevel > 1) {
        event.preventDefault();
        isDragging = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        startPanX = panX;
        startPanY = panY;
        mainImage.classList.add('dragging');
      }
    });
    
    document.addEventListener('mousemove', (event) => {
      if (isDragging && zoomLevel > 1) {
        event.preventDefault();
        const deltaX = event.clientX - dragStartX;
        const deltaY = event.clientY - dragStartY;
        
        panX = startPanX + deltaX;
        panY = startPanY + deltaY;
        
        updateImageTransform();
      }
    });
    
    document.addEventListener('mouseup', (event) => {
      if (isDragging) {
        event.preventDefault();
        isDragging = false;
        mainImage.classList.remove('dragging');
      }
    });
    
    // Touch/trackpad support
    let initialPinchDistance = 0;
    let initialZoomLevel = 1;
    
    imageContainer.addEventListener('touchstart', (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        initialPinchDistance = Math.sqrt(
          Math.pow(touch2.clientX - touch1.clientX, 2) + 
          Math.pow(touch2.clientY - touch1.clientY, 2)
        );
        initialZoomLevel = zoomLevel;
      }
    });
    
    imageContainer.addEventListener('touchmove', (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const currentDistance = Math.sqrt(
          Math.pow(touch2.clientX - touch1.clientX, 2) + 
          Math.pow(touch2.clientY - touch1.clientY, 2)
        );
        
        const scale = currentDistance / initialPinchDistance;
        zoomLevel = Math.max(minZoom, Math.min(maxZoom, initialZoomLevel * scale));
        updateImageTransform();
      }
    });
    
    // Prevent default touch behavior
    imageContainer.addEventListener('touchend', (event) => {
      if (event.touches.length < 2) {
        initialPinchDistance = 0;
      }
    });
    
    // Close on overlay click (outside image)
    document.querySelector('.gallery-overlay').addEventListener('click', (event) => {
      if (event.target.classList.contains('gallery-overlay') || 
          event.target.classList.contains('gallery-main')) {
        closeGallery();
      }
    });
    
    // Initialize zoom level display
    updateImageTransform();
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