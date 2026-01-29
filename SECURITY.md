# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Neo CLI, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email security concerns to the maintainers directly or use GitHub's private vulnerability reporting feature.

### What to Include

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Any suggested fixes (optional)

### Response Timeline

- **Initial response**: Within 48 hours
- **Status update**: Within 7 days
- **Fix timeline**: Depends on severity, typically within 30 days for critical issues

### Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Security Best Practices

When using Neo CLI:

- Keep the package updated to the latest version
- Review commands before execution, especially with `--force` flags
- Store sensitive configuration (API keys) using `neo config` which uses secure file permissions
- Never share your `~/.config/neo/secrets.json` file
