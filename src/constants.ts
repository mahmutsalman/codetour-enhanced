// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from "vscode";

export const EXTENSION_NAME = "codetour";
export const TOURS_VIEW_ID = "codetourEnhanced.tours";

export const FS_SCHEME = EXTENSION_NAME;
export const FS_SCHEME_CONTENT = `${FS_SCHEME}-content`;
export const CONTENT_URI = Uri.parse(`${FS_SCHEME_CONTENT}://current/CodeTour`);

export const ICON_URL =
  "https://cdn.jsdelivr.net/gh/vsls-contrib/code-tour/images/icon.png";
export const SMALL_ICON_URL =
  "https://cdn.jsdelivr.net/gh/vsls-contrib/code-tour/images/icon-small.png";

export const VSCODE_DIRECTORY = ".vscode";

// Content optimization thresholds for CommentThread scroll limitations
export const CODE_BLOCK_COLLAPSE_THRESHOLD = 5; // lines - code blocks longer than this will be collapsed
export const MAX_INLINE_CODE_BLOCKS = 2; // if more code blocks than this, collapse ALL
export const CONTENT_LENGTH_THRESHOLD = 1500; // characters - content longer than this shows "View Full Content" link

// Image display configuration for CodeTour comments
export const IMAGE_DISPLAY = {
  // Default max dimensions for images in comments (reduced for better UX)
  DEFAULT_MAX_WIDTH: 250,
  DEFAULT_MAX_HEIGHT: 200,

  // Thumbnail dimensions for compact view
  THUMBNAIL_WIDTH: 250,
  THUMBNAIL_HEIGHT: 200,

  // Small preview dimensions for inline display
  SMALL_MAX_WIDTH: 150,
  SMALL_MAX_HEIGHT: 120,

  // Grid thumbnail configuration for compact multi-image display
  GRID_THUMBNAIL_WIDTH: 120,
  GRID_THUMBNAIL_HEIGHT: 96,
  GRID_GAP: 8
};
