// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { env } from "vscode";

/**
 * Interface for clipboard image data
 */
export interface ClipboardImage {
  data: Uint8Array;
  format: 'png' | 'jpeg' | 'gif' | 'webp';
  filename: string;
}

/**
 * Checks if clipboard contains an image
 */
export async function hasClipboardImage(): Promise<boolean> {
  try {
    // Try to read image from clipboard
    const clipboardData = await env.clipboard.readText();
    
    // Check if it's a data URL (common for clipboard images)
    if (clipboardData.startsWith('data:image/')) {
      return true;
    }
    
    // For now, we'll detect based on common patterns
    // TODO: Enhance with proper clipboard image detection
    return false;
  } catch {
    return false;
  }
}

/**
 * Extracts image data from clipboard
 */
export async function getClipboardImage(): Promise<ClipboardImage | null> {
  try {
    // Try to get clipboard content as text first (for data URLs)
    const clipboardText = await env.clipboard.readText();
    
    if (clipboardText.startsWith('data:image/')) {
      return parseDataUrl(clipboardText);
    }
    
    // TODO: Implement native clipboard image reading
    // This would require platform-specific implementations
    // For now, we'll work with data URLs and pasted content
    
    return null;
  } catch (error) {
    console.error('Failed to get clipboard image:', error);
    return null;
  }
}

/**
 * Parses a data URL and extracts image data
 */
function parseDataUrl(dataUrl: string): ClipboardImage | null {
  try {
    const matches = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!matches) return null;
    
    const [, format, base64Data] = matches;
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return {
      data: bytes,
      format: format as ClipboardImage['format'],
      filename: `clipboard-image.${format}`
    };
  } catch (error) {
    console.error('Failed to parse data URL:', error);
    return null;
  }
}

/**
 * Creates a data URL from image data
 */
export function createImageDataUrl(imageData: Uint8Array, format: string = 'png'): string {
  const base64 = btoa(String.fromCharCode(...imageData));
  return `data:image/${format};base64,${base64}`;
}

/**
 * Detects image format from file data
 */
export function detectImageFormat(data: Uint8Array): string {
  // PNG signature
  if (data.length >= 8 && 
      data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    return 'png';
  }
  
  // JPEG signature
  if (data.length >= 2 && data[0] === 0xFF && data[1] === 0xD8) {
    return 'jpeg';
  }
  
  // GIF signature
  if (data.length >= 6 && 
      data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return 'gif';
  }
  
  // WebP signature
  if (data.length >= 12 &&
      data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return 'webp';
  }
  
  // Default to PNG
  return 'png';
}

/**
 * Validates if data is a valid image
 */
export function isValidImageData(data: Uint8Array): boolean {
  if (!data || data.length === 0) return false;
  
  const format = detectImageFormat(data);
  return ['png', 'jpeg', 'gif', 'webp'].includes(format);
}

/**
 * Gets the file extension for an image format
 */
export function getImageExtension(format: string): string {
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      return '.jpg';
    case 'png':
      return '.png';
    case 'gif':
      return '.gif';
    case 'webp':
      return '.webp';
    default:
      return '.png';
  }
}