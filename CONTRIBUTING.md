# Contributing to CodeTour Enhanced

We welcome contributions to CodeTour Enhanced! This enhanced version builds upon Microsoft's original CodeTour extension while adding powerful new features like audio recording, improved image galleries, and activity bar integration.

## 🎯 About This Project

CodeTour Enhanced is based on [Microsoft's CodeTour](https://github.com/microsoft/codetour) and maintains full compatibility with the original tour format while adding significant enhancements.

## 🚀 Getting Started

### Prerequisites
- Node.js 16 or higher
- VS Code for testing
- Git for version control

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/mahmutsalman/codetour-enhanced.git
   cd codetour-enhanced
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development**
   ```bash
   npm run watch
   ```

4. **Debug the extension**
   - Press `F5` to launch a new VS Code window with the extension loaded
   - Make changes and reload the window to test them

### Building and Testing

1. **Build the extension**
   ```bash
   npm run build
   ```

2. **Package for installation**
   ```bash
   npm run package
   ```

3. **Install the VSIX**
   ```bash
   code --install-extension codetour-enhanced-0.60.0.vsix
   ```

## 🛠️ Development Guidelines

### Code Style
- Follow existing TypeScript conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Maintain compatibility with original CodeTour APIs

### Enhanced Features
When contributing to the enhanced features, please consider:

#### Audio System
- Maintain WaveSurfer.js integration patterns
- Ensure cross-platform audio compatibility
- Test with different audio devices
- Validate audio format support

#### Image Gallery
- Follow responsive design principles
- Test image loading performance
- Ensure accessibility compliance
- Validate clipboard integration

#### Activity Bar Integration
- Maintain VS Code UX patterns
- Test sidebar functionality
- Ensure proper context handling
- Validate keyboard navigation

### Testing
- Test on Windows, macOS, and Linux
- Verify compatibility with different VS Code versions
- Test with existing CodeTour files
- Validate new features work as expected

## 📝 Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the coding guidelines above
   - Add tests if applicable
   - Update documentation as needed

3. **Test thoroughly**
   - Test the extension in VS Code
   - Verify existing tours still work
   - Test new functionality

4. **Submit your PR**
   - Provide a clear description of changes
   - Reference any related issues
   - Include screenshots for UI changes

### PR Requirements
- ✅ All existing functionality preserved
- ✅ New features properly documented
- ✅ Code follows project conventions
- ✅ No breaking changes to tour format
- ✅ Performance impact considered

## 🐛 Bug Reports

When reporting bugs, please include:
- VS Code version
- Operating system
- Extension version
- Steps to reproduce
- Expected vs actual behavior
- Sample tour files (if applicable)

## 💡 Feature Requests

We're always interested in new ideas! When suggesting features:
- Explain the use case
- Consider compatibility with original CodeTour
- Think about implementation complexity
- Consider user experience impact

## 🤝 Areas for Contribution

We particularly welcome contributions in:

### Core Features
- Performance optimizations
- Cross-platform compatibility
- Accessibility improvements
- Error handling enhancements

### Enhanced Features
- Audio codec improvements
- Additional image formats
- Advanced tour analytics
- Enhanced UI components

### Documentation
- Usage examples
- API documentation
- Tutorial creation
- Localization

## 📄 License

By contributing to CodeTour Enhanced, you agree that your contributions will be licensed under the MIT License, the same license as the original CodeTour project.

## 🙏 Attribution

This project builds upon the excellent work of Microsoft's CodeTour team. All contributors to the enhanced version join a community that respects and builds upon that foundation.

## 📞 Questions?

If you have questions about contributing, please:
1. Check existing issues and discussions
2. Create a new issue with the "question" label
3. Be patient - we'll get back to you soon!

---

**Thank you for contributing to CodeTour Enhanced! 🎉**