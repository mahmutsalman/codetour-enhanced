// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from "vscode";

export const EXTENSION_NAME = "codetour";

export const FS_SCHEME = EXTENSION_NAME;
export const FS_SCHEME_CONTENT = `${FS_SCHEME}-content`;
export const CONTENT_URI = Uri.parse(`${FS_SCHEME_CONTENT}://current/CodeTour`);

export const ICON_URL =
  "https://cdn.jsdelivr.net/gh/vsls-contrib/code-tour/images/icon.png";
export const SMALL_ICON_URL =
  "https://cdn.jsdelivr.net/gh/vsls-contrib/code-tour/images/icon-small.png";

export const VSCODE_DIRECTORY = ".vscode";

// Image display configuration for CodeTour comments
export const IMAGE_DISPLAY = {
  // Default max dimensions for images in comments
  DEFAULT_MAX_WIDTH: 400,
  DEFAULT_MAX_HEIGHT: 300,
  
  // Thumbnail dimensions for compact view
  THUMBNAIL_WIDTH: 400,
  THUMBNAIL_HEIGHT: 300,
  
  // Small preview dimensions for inline display
  SMALL_MAX_WIDTH: 200,
  SMALL_MAX_HEIGHT: 150
};
