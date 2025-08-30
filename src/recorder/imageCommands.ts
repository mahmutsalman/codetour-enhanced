// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { EXTENSION_NAME } from "../constants";
import { store } from "../store";
import { getClipboardImage, hasClipboardImage } from "../utils/clipboard";
import { addImageToStep, removeImageFromStep, updateImageCaption } from "../utils/imageStorage";
import { saveTour } from "./commands";

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
          vscode.window.showInformationMessage("No image found in clipboard");
          return;
        }

        // Get image from clipboard
        const clipboardImage = await getClipboardImage();
        if (!clipboardImage) {
          vscode.window.showErrorMessage("Failed to get image from clipboard");
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

        vscode.window.showInformationMessage("Image caption updated!");

      } catch (error) {
        console.error("Failed to update image caption:", error);
        vscode.window.showErrorMessage(`Failed to update caption: ${error}`);
      }
    }
  );

  /**
   * Command: View image in full size
   */
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.viewImage`,
    async (imagePath: string) => {
      if (!imagePath) {
        vscode.window.showErrorMessage("No image path provided");
        return;
      }

      try {
        // Get workspace URI and join with image path
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage("No workspace folder found");
          return;
        }

        const imageUri = vscode.Uri.joinPath(workspaceFolder.uri, imagePath);
        
        // Open image in VS Code
        await vscode.commands.executeCommand('vscode.open', imageUri);

      } catch (error) {
        console.error("Failed to view image:", error);
        vscode.window.showErrorMessage(`Failed to view image: ${error}`);
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
}