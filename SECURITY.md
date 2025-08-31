# Security Policy

## Supported Versions

CodeTour Enhanced is actively maintained. We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.60.x  | :white_check_mark: |

## Reporting a Vulnerability

The security of CodeTour Enhanced is important to us. If you believe you have found a security vulnerability in CodeTour Enhanced, please report it to us responsibly.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities to:
- **Email**: [security@your-domain.com](mailto:security@your-domain.com)  
- **GitHub**: Use the private security reporting feature if available

### What to Include

Please include the following information in your report:

- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Affected versions** of CodeTour Enhanced
- **Potential impact** of the vulnerability
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up

### What to Expect

After you submit a report, here's what you can expect:

1. **Acknowledgment** within 48 hours
2. **Initial assessment** within 1 week
3. **Regular updates** on our progress
4. **Credit** in the security advisory (if you desire)

### Security Considerations

#### Audio Recording
- Audio data is processed locally within VS Code
- No audio data is transmitted to external servers
- Audio files are stored locally in your workspace

#### Image Handling  
- Images are processed and stored locally
- Clipboard integration follows VS Code security model
- No image data is sent to external services

#### Data Privacy
- CodeTour Enhanced does not collect or transmit personal data
- All tour data remains local to your workspace
- No telemetry or usage tracking is implemented

#### Code Execution
- The extension follows VS Code's security model
- No arbitrary code execution outside VS Code context
- Tour content is sanitized and sandboxed

### Security Best Practices

When using CodeTour Enhanced:

1. **Review tour content** before sharing with others
2. **Avoid including sensitive information** in tours
3. **Keep the extension updated** to the latest version
4. **Report suspicious behavior** immediately

### Security Updates

Security updates will be:
- **Released promptly** for critical issues
- **Clearly documented** in release notes
- **Announced** through GitHub releases

### Attribution

This security policy is for CodeTour Enhanced, which is based on Microsoft's CodeTour extension. For security issues in the original CodeTour, please report them through Microsoft's security channels.

---

**Security is a shared responsibility. Thank you for helping keep CodeTour Enhanced secure! 🔒**