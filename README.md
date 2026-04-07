# CodeTour Enhanced

**An enhanced VS Code extension for guided codebase tours with audio, rich notes, image galleries, and advanced tour management.**

[![Version](https://img.shields.io/badge/version-0.62.0-blue.svg)](https://github.com/mahmutsalman/codetour-enhanced)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE.txt)

Built on top of Microsoft's [CodeTour](https://github.com/microsoft/codetour).

---

## Features

**Audio Recording**
- Record audio narration per tour step with WaveSurfer.js waveform visualization
- Pause/resume recording, add timestamp markers, adjust playback speed (0.5x–2x)
- Per-clip Quill.js captions, multiple clips per step, WebM/Opus mobile import support
- Step Audio sidebar panel — play and manage clips without opening a modal
- Select Microphone command with dynamic detection

**Rich Notes (Quill.js)**
- Per-step rich text notes tab in the bottom panel
- Tour-level notes shared across all steps
- Auto-save, theme-aware inline code styling

**Image Gallery**
- Zoom (50%–500%), click-drag panning, pinch-to-zoom
- Step Images sidebar panel with thumbnail grid
- Right-click thumbnails to cycle border color tags
- Full-screen keyboard navigation (← → + − 0 ESC)

**Tour Management**
- 8 sort modes, real-time text filter, topic/category grouping
- Persistent preferences across sessions
- Refresh Tours button — reload from disk without restarting VS Code
- Drag tour/step nodes to terminal to paste file path or step reference
- Multi-root workspace support

---

## Installation

1. Download the latest `.vsix` from the [releases page](https://github.com/mahmutsalman/codetour-enhanced/releases)
2. Install:
   ```
   code --install-extension codetour-enhanced-0.62.0.vsix
   ```
   Or via Extensions panel → "Install from VSIX..."

---

## Development

```bash
git clone https://github.com/mahmutsalman/codetour-enhanced.git
cd codetour-enhanced
npm install
npm run build
npm run package
```

---

## Links

- [Releases](https://github.com/mahmutsalman/codetour-enhanced/releases)
- [Issues](https://github.com/mahmutsalman/codetour-enhanced/issues)
- [Original CodeTour](https://github.com/microsoft/codetour)

---

MIT License — [Mahmut Salman](https://github.com/mahmutsalman)
