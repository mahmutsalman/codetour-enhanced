# CodeTour Enhanced 🚀🗺️

**An enhanced VS Code extension with advanced audio recording, improved image galleries, and activity bar integration for guided codebase tours.**

[![Version](https://img.shields.io/badge/version-0.60.0-blue.svg)](https://github.com/mahmutsalman/codetour-enhanced)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE.txt)

## 🎯 About

CodeTour Enhanced is a significantly improved version of Microsoft's popular CodeTour extension, featuring powerful new capabilities for creating immersive, multimedia code walkthroughs directly within Visual Studio Code.

### 🔥 Enhanced Features

**🎵 Advanced Audio Recording System**
- Professional audio recording with WaveSurfer.js integration
- Real-time waveform visualization
- Intelligent device selection and silence detection
- Audio transcript management
- Seamless VSIX bundling and playback

**🖼️ Improved Image Gallery**
- Dynamic image layout with responsive design
- Enhanced image display sizing and formatting
- Clipboard integration for quick image additions
- Professional image management interface

**📊 Activity Bar Integration**  
- Dedicated CodeTour sidebar in the activity bar
- Streamlined tour management and navigation
- Enhanced user experience and accessibility

**⚡ Performance & Quality Improvements**
- Optimized VSIX bundling and loading
- Enhanced VS Code settings integration
- Improved stability and error handling
- Modern web technologies integration

## 🙏 Attribution

This project is based on Microsoft's excellent **[CodeTour extension](https://github.com/microsoft/codetour)**, originally created by the Visual Studio Live Share team. All core tour functionality, navigation, and basic features are derived from their outstanding work.

**Original Repository**: https://github.com/microsoft/codetour  
**Original Authors**: Microsoft Corporation  
**License**: MIT (maintained)

## 🚀 Getting Started

### Installation

1. Download the latest `.vsix` file from the [releases page](https://github.com/mahmutsalman/codetour-enhanced/releases)
2. Install via VS Code:
   ```
   code --install-extension codetour-enhanced-0.60.0.vsix
   ```
3. Or install through VS Code's Extensions panel: "Extensions: Install from VSIX..."

### Quick Start

1. **Record a Tour**: Click the `+` button in the CodeTour Enhanced activity bar panel
2. **Add Audio**: Use the microphone button to record professional audio narration
3. **Include Images**: Add images from clipboard or files to enhance explanations
4. **Navigate**: Use the enhanced sidebar to manage and navigate your tours

## 📚 Enhanced Documentation

### Audio Recording Features

#### Professional Audio Capture
- High-quality audio recording with noise reduction
- Real-time audio level monitoring
- Automatic silence detection and trimming
- Multiple audio format support

#### WaveSurfer.js Integration
```javascript
// Enhanced audio visualization
const wavesurfer = WaveSurfer.create({
  container: '#waveform',
  waveColor: '#4A90E2',
  progressColor: '#357ABD',
  cursorColor: '#357ABD'
});
```

#### Audio Management
- Transcript editing and management
- Audio file organization per tour step
- Bulk audio operations
- Export capabilities

### Image Gallery Enhancements

#### Dynamic Layout System
- Responsive grid layout
- Automatic image sizing optimization
- Touch-friendly mobile interface
- Drag-and-drop functionality

#### Advanced Image Handling
- Clipboard integration: `Ctrl+V` to paste images
- Multiple format support: PNG, JPG, GIF, WebP
- Image compression and optimization
- Caption and metadata management

### Activity Bar Integration

#### Dedicated Sidebar
- Centralized tour management
- Enhanced navigation controls  
- Quick access to recording tools
- Tour organization and filtering

#### Improved UX
- Context-sensitive actions
- Keyboard shortcuts integration
- Accessible design patterns
- Dark/light theme support

## 🛠️ Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/mahmutsalman/codetour-enhanced.git
cd codetour-enhanced

# Install dependencies
npm install

# Build the extension
npm run build

# Package for distribution
npm run package
```

### Enhanced Build Process
- Webpack optimization for audio libraries
- Efficient VSIX packaging
- Resource bundling improvements
- Development mode enhancements

## 🔧 Configuration

### Enhanced Settings

```json
{
  "codetour.promptForWorkspaceTours": true,
  "codetour.recordMode": "lineNumber",
  "codetour.showMarkers": true,
  "codetour.customTourDirectory": null,
  "codetour.audioQuality": "high",
  "codetour.imageMaxSize": "2MB",
  "codetour.activityBarEnabled": true
}
```

## 🤝 Contributing

We welcome contributions! This enhanced version maintains full compatibility with the original CodeTour format while adding powerful new features.

### Areas for Contribution
- Audio codec improvements
- Additional image formats
- Enhanced UI/UX patterns  
- Performance optimizations
- Accessibility improvements

## 📄 License

MIT License - Same as the original CodeTour extension

## 🔗 Links

- **Enhanced Version**: https://github.com/mahmutsalman/codetour-enhanced
- **Original CodeTour**: https://github.com/microsoft/codetour
- **Issue Tracker**: https://github.com/mahmutsalman/codetour-enhanced/issues
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

## 🚧 Roadmap

- [ ] Video recording capabilities
- [ ] Advanced tour analytics
- [ ] Team collaboration features
- [ ] Cloud synchronization
- [ ] Mobile companion app
- [ ] AI-powered tour suggestions

---

**Made with ❤️ by [Mahmut Salman](https://github.com/mahmutsalman)**  
*Building upon the excellent foundation provided by Microsoft's CodeTour team*