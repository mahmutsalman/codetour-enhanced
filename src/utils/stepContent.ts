// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Removes auto-generated media sections (audio/image galleries) from tour content.
 *
 * These sections are appended during rendering and should not be committed back
 * to the persisted tour description to avoid duplicating them on subsequent renders.
 */
export function stripGeneratedMediaSections(content: string | undefined): string {
  if (!content) {
    return "";
  }

  const markers = [
    "\n\n---\n\n🎵 **Audio Recordings",
    "\n\n---\n\n📎 **Attachments"
  ];

  let stripped = content;

  for (const marker of markers) {
    const index = stripped.indexOf(marker);
    if (index !== -1) {
      stripped = stripped.slice(0, index);
    }
  }

  return stripped.replace(/[\s\n]+$/, "");
}
