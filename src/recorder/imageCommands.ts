// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { EXTENSION_NAME } from "../constants";
import { store } from "../store";
import { getClipboardImage, hasClipboardImage } from "../utils/clipboard";
import { addImageToStep, removeImageFromStep, updateImageCaption } from "../utils/imageStorage";
import { saveTour } from "./commands";
import { GalleryManager } from "../gallery/galleryManager";
import { refreshCurrentStep } from "../player";

/**
 * Registers image-related commands for CodeTour
 */
export function registerImageCommands() {
  
  /**
   * Command: Add image from clipboard to current step
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.addImageFromClipboard`,
    async () => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour to add image to");
        return;
      }

      try {
        // Check if clipboard has image
        const hasImage = await hasClipboardImage();
        if (!hasImage) {
          const action = await vscode.window.showInformationMessage(
            "No image found in clipboard. Try copying an image first, or use an alternative method.",
            "Add from File Instead",
            "How to Copy Images"
          );
          
          if (action === "Add from File Instead") {
            await vscode.commands.executeCommand(`${EXTENSION_NAME}.addImageFromFile`);
          } else if (action === "How to Copy Images") {
            vscode.window.showInformationMessage(
              "To copy images to clipboard: Take a screenshot (Cmd+Shift+4 on macOS), copy from image editors, or copy images from web browsers. Then try the paste command again."
            );
          }
          return;
        }

        // Show progress while getting image
        const clipboardImage = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Getting image from clipboard...",
          cancellable: false
        }, async (progress) => {
          return await getClipboardImage();
        });

        if (!clipboardImage) {
          const action = await vscode.window.showErrorMessage(
            "Failed to extract image from clipboard. This might be due to clipboard format or system permissions.",
            "Add from File Instead",
            "Try Again"
          );
          
          if (action === "Add from File Instead") {
            await vscode.commands.executeCommand(`${EXTENSION_NAME}.addImageFromFile`);
          }
          return;
        }

        // Ask for optional caption
        const caption = await vscode.window.showInputBox({
          prompt: "Enter an optional caption for the image",
          placeHolder: "Image caption (optional)"
        });

        // Add image to current step
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;

        await addImageToStep(
          tour,
          stepIndex,
          clipboardImage.data,
          clipboardImage.filename,
          caption || undefined
        );

        // Save tour with new image
        await saveTour(tour);

        // Refresh the current step to update the attachment count immediately
        await refreshCurrentStep();

        vscode.window.showInformationMessage("Image added to tour step successfully!");

      } catch (error) {
        console.error("Failed to add image from clipboard:", error);
        vscode.window.showErrorMessage(`Failed to add image: ${error}`);
      }
    }
  );

  /**
   * Command: Add image from file to current step
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.addImageFromFile`,
    async () => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour to add image to");
        return;
      }

      try {
        // Show file picker for images
        const fileUri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: false,
          filters: {
            'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp']
          }
        });

        if (!fileUri || fileUri.length === 0) {
          return;
        }

        // Read image file
        const imageData = await vscode.workspace.fs.readFile(fileUri[0]);
        const filename = vscode.workspace.asRelativePath(fileUri[0]);

        // Ask for optional caption
        const caption = await vscode.window.showInputBox({
          prompt: "Enter an optional caption for the image",
          placeHolder: "Image caption (optional)"
        });

        // Add image to current step
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;

        await addImageToStep(
          tour,
          stepIndex,
          imageData,
          filename,
          caption || undefined
        );

        // Save tour with new image
        await saveTour(tour);

        // Refresh the current step to update the attachment count immediately
        await refreshCurrentStep();

        vscode.window.showInformationMessage("Image added to tour step successfully!");

      } catch (error) {
        console.error("Failed to add image from file:", error);
        vscode.window.showErrorMessage(`Failed to add image: ${error}`);
      }
    }
  );

  /**
   * Command: Remove image from step
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.removeImage`,
    async (imageId: string) => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour");
        return;
      }

      if (!imageId) {
        vscode.window.showErrorMessage("No image ID provided");
        return;
      }

      try {
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;
        
        // Confirm deletion
        const confirm = await vscode.window.showWarningMessage(
          "Are you sure you want to remove this image?",
          "Remove Image",
          "Cancel"
        );

        if (confirm !== "Remove Image") {
          return;
        }

        await removeImageFromStep(tour, stepIndex, imageId);

        // Save tour
        await saveTour(tour);

        // Refresh the current step to update the attachment count immediately
        await refreshCurrentStep();

        vscode.window.showInformationMessage("Image removed successfully!");

      } catch (error) {
        console.error("Failed to remove image:", error);
        vscode.window.showErrorMessage(`Failed to remove image: ${error}`);
      }
    }
  );

  /**
   * Command: Update image caption
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.updateImageCaption`,
    async (imageId: string) => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour");
        return;
      }

      if (!imageId) {
        vscode.window.showErrorMessage("No image ID provided");
        return;
      }

      try {
        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;
        const step = tour.steps[stepIndex];
        
        // Find current image
        const image = step.images?.find(img => img.id === imageId);
        if (!image) {
          vscode.window.showErrorMessage("Image not found");
          return;
        }

        // Ask for new caption
        const newCaption = await vscode.window.showInputBox({
          prompt: "Enter caption for the image",
          placeHolder: "Image caption (leave empty to remove)",
          value: image.caption || ""
        });

        if (newCaption === undefined) {
          return; // User cancelled
        }

        // Update caption
        updateImageCaption(tour, stepIndex, imageId, newCaption || undefined);

        // Save tour
        await saveTour(tour);

        // Refresh the current step to update the attachment count immediately
        await refreshCurrentStep();

        vscode.window.showInformationMessage("Image caption updated!");

      } catch (error) {
        console.error("Failed to update image caption:", error);
        vscode.window.showErrorMessage(`Failed to update caption: ${error}`);
      }
    }
  );

  /**
   * Command: View image in gallery with navigation
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.viewImage`,
    async (imagePath: string) => {
      if (!imagePath) {
        vscode.window.showErrorMessage("No image path provided");
        return;
      }

      try {
        // Get current tour and step context
        if (!store.activeTour) {
          vscode.window.showErrorMessage("No active tour found");
          return;
        }

        const tour = store.activeTour.tour;
        const stepIndex = store.activeTour.step;
        const step = tour.steps[stepIndex];
        
        if (!step.images || step.images.length === 0) {
          vscode.window.showErrorMessage("No images found in current step");
          return;
        }

        // Use pre-initialized gallery manager
        const galleryManager = GalleryManager.getInstance();
        await galleryManager.openGallery(
          tour.id,
          stepIndex,
          step.images,
          imagePath
        );

      } catch (error) {
        console.error("Failed to open image gallery:", error);
        vscode.window.showErrorMessage(`Failed to open image gallery: ${error}`);
      }
    }
  );

  /**
   * Command: Show image management panel
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.manageStepImages`,
    async () => {
      if (!store.activeTour) {
        vscode.window.showErrorMessage("No active tour");
        return;
      }

      const tour = store.activeTour.tour;
      const stepIndex = store.activeTour.step;
      const step = tour.steps[stepIndex];
      const images = step.images || [];

      if (images.length === 0) {
        vscode.window.showInformationMessage("No images in current step");
        return;
      }

      // Create quick pick items for images
      const items = images.map(image => ({
        label: image.filename,
        description: image.caption || '',
        detail: `Size: ${(image.size / 1024).toFixed(1)}KB`,
        imageId: image.id,
        imagePath: image.path
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select an image to manage"
      });

      if (!selected) return;

      // Show action menu for selected image
      const action = await vscode.window.showQuickPick([
        { label: "$(eye) View Image", action: "view" },
        { label: "$(edit) Edit Caption", action: "caption" },
        { label: "$(trash) Remove Image", action: "remove" }
      ], {
        placeHolder: "What would you like to do with this image?"
      });

      if (!action) return;

      switch (action.action) {
        case "view":
          await vscode.commands.executeCommand(`${EXTENSION_NAME}.viewImage`, selected.imagePath);
          break;
        case "caption":
          await vscode.commands.executeCommand(`${EXTENSION_NAME}.updateImageCaption`, selected.imageId);
          break;
        case "remove":
          await vscode.commands.executeCommand(`${EXTENSION_NAME}.removeImage`, selected.imageId);
          break;
      }
    }
  );

  /**
   * Command: Test clipboard functionality for debugging
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.testClipboard`,
    async () => {
      const platform = require('os').platform();
      const result: string[] = [];
      
      result.push(`🖥️  Platform: ${platform}`);
      result.push(`📋 Testing clipboard functionality...\n`);
      
      try {
        // Test text clipboard
        const text = await vscode.env.clipboard.readText();
        result.push(`✅ Text clipboard: ${text ? `"${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"` : 'Empty'}`);
      } catch (error) {
        result.push(`❌ Text clipboard failed: ${error}`);
      }
      
      try {
        // Test image detection
        const hasImage = await hasClipboardImage();
        result.push(`${hasImage ? '✅' : '❌'} Image detection: ${hasImage ? 'Image found' : 'No image found'}`);
        
        if (hasImage) {
          // Try to get image
          const image = await getClipboardImage();
          if (image) {
            result.push(`✅ Image extraction: Success (${image.format}, ${(image.data.length / 1024).toFixed(1)}KB)`);
          } else {
            result.push(`❌ Image extraction: Failed`);
          }
        }
      } catch (error) {
        result.push(`❌ Image clipboard failed: ${error}`);
      }
      
      result.push(`\n💡 Tips for better clipboard support:`);
      result.push(`   • Take a screenshot (Cmd+Shift+4 on macOS)`);
      result.push(`   • Copy image from browser or image editor`);
      result.push(`   • Use "Add from File" as alternative`);
      
      const panel = vscode.window.createWebviewPanel(
        'clipboardTest',
        'Clipboard Test Results',
        vscode.ViewColumn.One,
        { enableScripts: false }
      );
      
      panel.webview.html = `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: monospace; padding: 20px; }
            .success { color: #4CAF50; }
            .error { color: #f44336; }
            .info { color: #2196F3; }
          </style>
        </head>
        <body>
          ${result.map(line => `<div>${line}</div>`).join('')}
        </body>
        </html>`;
    }
  );
}