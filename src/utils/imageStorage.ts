// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import { Uri, workspace } from "vscode";
import { CodeTour, CodeTourStepImage } from "../store";
import { getActiveWorkspacePath } from "../utils";
import { Jimp } from "jimp";

const IMAGES_FOLDER = ".tours/images";
const THUMBNAIL_PREFIX = "thumb-";
const THUMBNAIL_SIZE = 120; // 120px width for grid thumbnail display

/**
 * Generates the image storage path for a specific tour and step
 */
export function getImageStoragePath(tourTitle: string, stepIndex: number): string {
  const sanitizedTourTitle = sanitizeTourName(tourTitle);
  const stepFolder = `step-${String(stepIndex + 1).padStart(2, '0')}`;
  return path.join(IMAGES_FOLDER, sanitizedTourTitle, stepFolder);
}

/**
 * Sanitizes tour title for use as folder name
 */
function sanitizeTourName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generates a unique filename for an image
 */
export function generateImageFilename(originalName?: string): string {
  const timestamp = Date.now();
  const extension = originalName 
    ? path.extname(originalName).toLowerCase()
    : '.png';
  
  if (originalName && originalName !== 'image.png') {
    const baseName = path.basename(originalName, extension);
    const sanitizedName = baseName.replace(/[^a-zA-Z0-9]/g, '-');
    return `${sanitizedName}-${timestamp}${extension}`;
  }
  
  return `clipboard-${timestamp}${extension}`;
}

/**
 * Gets the workspace-relative path for an image
 */
export function getImageWorkspacePath(tourTitle: string, stepIndex: number, filename: string): string {
  const storagePath = getImageStoragePath(tourTitle, stepIndex);
  return path.join(storagePath, filename);
}

/**
 * Gets the thumbnail filename for an image
 */
export function getThumbnailFilename(originalFilename: string): string {
  const ext = path.extname(originalFilename);
  const name = path.basename(originalFilename, ext);
  return `${THUMBNAIL_PREFIX}${name}${ext}`;
}

/**
 * Creates the image storage directory if it doesn't exist
 */
export async function ensureImageStorageDirectory(tourTitle: string, stepIndex: number): Promise<Uri> {
  const workspacePathString = getActiveWorkspacePath();
  const workspacePath = Uri.file(workspacePathString);
  const storagePath = getImageStoragePath(tourTitle, stepIndex);
  const storageUri = Uri.joinPath(workspacePath, storagePath);
  
  try {
    await workspace.fs.stat(storageUri);
  } catch {
    // Directory doesn't exist, create it
    await workspace.fs.createDirectory(storageUri);
  }
  
  return storageUri;
}

/**
 * Saves image data to the tour's image storage
 */
export async function saveImage(
  imageData: Uint8Array,
  tourTitle: string,
  stepIndex: number,
  originalFilename?: string
): Promise<CodeTourStepImage> {
  const filename = generateImageFilename(originalFilename);
  const storageDir = await ensureImageStorageDirectory(tourTitle, stepIndex);
  const imageUri = Uri.joinPath(storageDir, filename);
  
  // Save the image file
  await workspace.fs.writeFile(imageUri, imageData);
  
  // Get image dimensions (basic implementation - can be enhanced)
  const dimensions = await getImageDimensions(imageData);
  
  // Generate thumbnail (placeholder for now - can be implemented with image processing)
  const thumbnailFilename = getThumbnailFilename(filename);
  const thumbnailUri = Uri.joinPath(storageDir, thumbnailFilename);
  await generateThumbnail(imageData, thumbnailUri, THUMBNAIL_SIZE);
  
  const workspacePath = getImageWorkspacePath(tourTitle, stepIndex, filename);
  const thumbnailPath = getImageWorkspacePath(tourTitle, stepIndex, thumbnailFilename);
  
  const imageMetadata: CodeTourStepImage = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    filename,
    path: workspacePath,
    thumbnail: thumbnailPath,
    size: imageData.length,
    dimensions,
    created: Date.now()
  };
  
  return imageMetadata;
}

/**
 * Deletes an image and its thumbnail from storage
 */
export async function deleteImage(
  image: CodeTourStepImage,
  workspaceUri: Uri
): Promise<void> {
  try {
    // Delete main image
    const imageUri = Uri.joinPath(workspaceUri, image.path);
    await workspace.fs.delete(imageUri);
    
    // Delete thumbnail if it exists
    if (image.thumbnail) {
      const thumbnailUri = Uri.joinPath(workspaceUri, image.thumbnail);
      await workspace.fs.delete(thumbnailUri);
    }
  } catch (error) {
    console.warn('Failed to delete image files:', error);
  }
}

/**
 * Cleans up all images for a specific step
 */
export async function cleanupStepImages(
  tour: CodeTour,
  stepIndex: number
): Promise<void> {
  const step = tour.steps[stepIndex];
  if (!step.images) return;
  
  const workspaceUri = workspace.getWorkspaceFolder(Uri.parse(tour.id))?.uri;
  if (!workspaceUri) return;
  
  for (const image of step.images) {
    await deleteImage(image, workspaceUri);
  }
}

/**
 * Cleans up all images for an entire tour
 */
export async function cleanupTourImages(tour: CodeTour): Promise<void> {
  const workspaceUri = workspace.getWorkspaceFolder(Uri.parse(tour.id))?.uri;
  if (!workspaceUri) return;
  
  const tourImageDir = Uri.joinPath(
    workspaceUri, 
    IMAGES_FOLDER, 
    sanitizeTourName(tour.title)
  );
  
  try {
    await workspace.fs.delete(tourImageDir, { recursive: true });
  } catch (error) {
    console.warn('Failed to cleanup tour images:', error);
  }
}

/**
 * Gets image dimensions from image data using jimp
 */
async function getImageDimensions(imageData: Uint8Array): Promise<{width: number; height: number}> {
  try {
    const image = await Jimp.read(Buffer.from(imageData));
    return {
      width: image.width,
      height: image.height
    };
  } catch (error) {
    console.warn('Failed to read image dimensions:', error);
    return { width: 0, height: 0 };
  }
}

/**
 * Generates a thumbnail for an image using jimp
 * Resizes to specified size while maintaining aspect ratio
 */
async function generateThumbnail(
  imageData: Uint8Array,
  thumbnailUri: Uri,
  size: number
): Promise<void> {
  try {
    const image = await Jimp.read(Buffer.from(imageData));

    // Resize to thumbnail size (width), height auto-calculated to maintain aspect ratio
    const aspectRatio = image.height / image.width;
    const thumbnailHeight = Math.round(size * aspectRatio);
    await image.resize({ w: size, h: thumbnailHeight });

    // Get the thumbnail buffer
    // In jimp v1, we need to use getBuffer with the image format
    const buffer = await image.getBuffer('image/png');

    // Save thumbnail
    await workspace.fs.writeFile(thumbnailUri, new Uint8Array(buffer));
  } catch (error) {
    console.warn('Failed to generate thumbnail, using original:', error);
    // Fallback: use original image if thumbnail generation fails
    await workspace.fs.writeFile(thumbnailUri, imageData);
  }
}

/**
 * Adds an image to a tour step and saves the tour
 */
export async function addImageToStep(
  tour: CodeTour,
  stepIndex: number,
  imageData: Uint8Array,
  originalFilename?: string,
  caption?: string
): Promise<CodeTourStepImage> {
  const imageMetadata = await saveImage(imageData, tour.title, stepIndex, originalFilename);
  
  if (caption) {
    imageMetadata.caption = caption;
  }
  
  // Add image to step
  const step = tour.steps[stepIndex];
  if (!step.images) {
    step.images = [];
  }
  step.images.push(imageMetadata);
  
  return imageMetadata;
}

/**
 * Removes an image from a tour step
 */
export async function removeImageFromStep(
  tour: CodeTour,
  stepIndex: number,
  imageId: string
): Promise<void> {
  const step = tour.steps[stepIndex];
  if (!step.images) return;
  
  const imageIndex = step.images.findIndex(img => img.id === imageId);
  if (imageIndex === -1) return;
  
  const image = step.images[imageIndex];
  const workspaceUri = workspace.getWorkspaceFolder(Uri.parse(tour.id))?.uri;
  
  if (workspaceUri) {
    await deleteImage(image, workspaceUri);
  }
  
  // Remove from step
  step.images.splice(imageIndex, 1);
  
  // Clean up empty images array
  if (step.images.length === 0) {
    delete step.images;
  }
}

/**
 * Updates an image's caption
 */
export function updateImageCaption(
  tour: CodeTour,
  stepIndex: number,
  imageId: string,
  caption?: string
): boolean {
  const step = tour.steps[stepIndex];
  if (!step.images) return false;
  
  const image = step.images.find(img => img.id === imageId);
  if (!image) return false;
  
  if (caption) {
    image.caption = caption;
  } else {
    delete image.caption;
  }
  
  return true;
}