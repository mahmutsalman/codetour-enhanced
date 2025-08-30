// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { env } from "vscode";

// Only import Node.js modules when available (not in web extension)
let os: any = null;
let execAsync: any = null;
let fs: any = null;
let path: any = null;

try {
  // These will only be available in Node.js extension context
  os = require('os');
  const { exec } = require('child_process');
  const { promisify } = require('util');
  execAsync = promisify(exec);
  fs = require('fs/promises');
  path = require('path');
} catch (error) {
  // Running in web extension context - native clipboard won't work
  console.log("Node.js modules not available - running in web context");
}

/**
 * Interface for clipboard image data
 */
export interface ClipboardImage {
  data: Uint8Array;
  format: 'png' | 'jpeg' | 'gif' | 'webp';
  filename: string;
}

/**
 * Checks if clipboard contains an image using platform-specific methods
 */
export async function hasClipboardImage(): Promise<boolean> {
  try {
    // First try text-based detection (data URLs)
    const clipboardText = await env.clipboard.readText();
    if (clipboardText.startsWith('data:image/')) {
      return true;
    }
    
    // Try platform-specific clipboard detection
    return await hasNativeClipboardImage();
  } catch (error) {
    console.log("Clipboard image detection failed:", error);
    return false;
  }
}

/**
 * Platform-specific clipboard image detection
 */
async function hasNativeClipboardImage(): Promise<boolean> {
  // Check if Node.js modules are available
  if (!os || !execAsync) {
    console.log("Native clipboard not available - running in web extension context");
    return false;
  }

  const platform = os.platform();
  
  try {
    switch (platform) {
      case 'darwin': // macOS
        const { stdout } = await execAsync('osascript -e "clipboard info"');
        return stdout.includes('«class PNGf»') || stdout.includes('public.png') || 
               stdout.includes('public.jpeg') || stdout.includes('public.tiff');
               
      case 'win32': // Windows
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms;
          [System.Windows.Forms.Clipboard]::ContainsImage()
        `;
        const { stdout: winResult } = await execAsync(`powershell -Command "${psScript}"`);
        return winResult.trim() === 'True';
        
      case 'linux': // Linux
        try {
          await execAsync('which xclip');
          const { stdout: linuxResult } = await execAsync('xclip -selection clipboard -t TARGETS -o');
          return linuxResult.includes('image/') || linuxResult.includes('PNG') || 
                 linuxResult.includes('JPEG') || linuxResult.includes('image');
        } catch {
          return false;
        }
        
      default:
        return false;
    }
  } catch (error) {
    console.log("Native clipboard detection failed:", error);
    return false;
  }
}

/**
 * Extracts image data from clipboard using platform-specific methods
 */
export async function getClipboardImage(): Promise<ClipboardImage | null> {
  try {
    // First try text-based extraction (data URLs)
    const clipboardText = await env.clipboard.readText();
    if (clipboardText.startsWith('data:image/')) {
      return parseDataUrl(clipboardText);
    }
    
    // Try platform-specific clipboard extraction
    return await getNativeClipboardImage();
  } catch (error) {
    console.error('Failed to get clipboard image:', error);
    return null;
  }
}

/**
 * Platform-specific clipboard image extraction
 */
async function getNativeClipboardImage(): Promise<ClipboardImage | null> {
  // Check if Node.js modules are available
  if (!os || !execAsync || !fs || !path) {
    console.log("Native clipboard extraction not available - running in web extension context");
    return null;
  }

  const platform = os.platform();
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `clipboard-${Date.now()}.png`);
  
  try {
    switch (platform) {
      case 'darwin': // macOS
        await execAsync(`osascript -e "set the clipboard to (the clipboard as «class PNGf»)" -e "write (the clipboard as «class PNGf») to (open for access POSIX file \\"${tempFile}\\" with write permission)" -e "close access POSIX file \\"${tempFile}\\""`, { timeout: 10000 });
        break;
        
      case 'win32': // Windows
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms;
          Add-Type -AssemblyName System.Drawing;
          if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
            $img = [System.Windows.Forms.Clipboard]::GetImage();
            $img.Save('${tempFile.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
          }
        `;
        await execAsync(`powershell -Command "${psScript}"`, { timeout: 10000 });
        break;
        
      case 'linux': // Linux
        try {
          await execAsync('which xclip');
          await execAsync(`xclip -selection clipboard -t image/png -o > "${tempFile}"`, { timeout: 10000 });
        } catch {
          try {
            await execAsync('which wl-paste');
            await execAsync(`wl-paste --type image/png > "${tempFile}"`, { timeout: 10000 });
          } catch {
            return null;
          }
        }
        break;
        
      default:
        return null;
    }
    
    // Check if file was created and read it
    try {
      const stats = await fs.stat(tempFile);
      if (stats.size > 0) {
        const imageData = await fs.readFile(tempFile);
        const format = detectImageFormat(imageData);
        const filename = `clipboard-image.${format}`;
        
        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {});
        
        return {
          data: imageData,
          format: format as ClipboardImage['format'],
          filename
        };
      }
    } catch (statError) {
      console.log("Temp file not created or empty:", statError);
    }
    
    // Clean up temp file if it exists
    await fs.unlink(tempFile).catch(() => {});
    return null;
    
  } catch (error) {
    console.error("Native clipboard extraction failed:", error);
    // Clean up temp file if it exists
    await fs.unlink(tempFile).catch(() => {});
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