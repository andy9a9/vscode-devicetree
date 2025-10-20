# Contributing to DeviceTree Extension

Thank you for your interest in contributing to the DeviceTree Language Support extension for Visual Studio Code!

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Coding Standards](#coding-standards)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project adheres to a code of conduct that all contributors are expected to follow. Please be respectful and constructive in all interactions.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your feature or bug fix
4. Make your changes
5. Test your changes thoroughly
6. Submit a pull request

## Development Setup

### Prerequisites

- Node.js (v20 or later)
- npm or yarn
- Visual Studio Code

### Installation

```bash
# Clone your fork
git clone https://github.com/andy9a9/vscode-devicetree.git
cd vscode-devicetree

# Install dependencies
npm install

# Compile the extension
npm run compile
```

## Project Structure

```
vscode-devicetree/
├── src/                   # Source code
│   ├── extension.ts       # Main extension entry point
│   └── test/              # Test files
├── syntaxes/              # TextMate grammar files
│   ├── dts.tmLanguage.json
│   └── devicetree-language.json
├── dist/                  # Compiled output
├── docs/                  # Documentation
├── images/                # Extension icons and images
└── package.json           # Extension manifest
```

## Development Workflow

### Running the Extension

1. Open the project in VS Code
2. Press `F5` to start debugging
3. A new Extension Development Host window will open
4. Open a `.dts`, `.dtsi`, or `.dtso` file to test syntax highlighting
5. Access commands via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)

### Building

```bash
# Development build with watch mode
npm run watch

# Production build
npm run package
```

### Linting

```bash
# Run ESLint
npm run lint

# Auto-fix linting issues
npm run lint -- --fix
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Compile tests
npm run compile-tests

# Watch mode for tests
npm run watch-tests
```

### Writing Tests

- Place test files in `src/test/`
- Use the naming convention `*.test.ts`
- Follow the existing test structure
- Test both success and failure cases
- Aim for high code coverage

Example test:

```typescript
test('Description of test', async () => {
    // Arrange
    const expected = 'expected value';

    // Act
    const actual = await someFunction();

    // Assert
    assert.strictEqual(actual, expected);
});
```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict type checking
- Add explicit return types for functions
- Document public APIs with JSDoc comments
- Use `const` by default, `let` when necessary, avoid `var`

### Code Style

- Follow the existing code style
- Use 4 spaces for indentation (not tabs)
- Maximum line length: 100 characters
- Add trailing commas in multi-line objects and arrays
- Use single quotes for strings (unless double quotes are necessary)

### ESLint Rules

The project uses ESLint with TypeScript support. Key rules:

- No `console.log` (use `console.warn` or `console.error` for diagnostics)
- No explicit `any` types
- Prefer optional chaining (`?.`) and nullish coalescing (`??`)
- Handle promises properly (no floating promises)

## Submitting Changes

### Pull Request Process

1. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**
   - Write clean, documented code
   - Follow coding standards
   - Add tests for new functionality
   - Update documentation as needed

3. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add support for X"
   ```

   Use conventional commit messages:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `test:` Adding or updating tests
   - `refactor:` Code refactoring
   - `chore:` Maintenance tasks

4. **Push to Your Fork**
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create a Pull Request**
   - Go to the original repository on GitHub
   - Click "New Pull Request"
   - Select your fork and branch
   - Fill in the PR template with:
     - Description of changes
     - Related issue number (if applicable)
     - Testing performed
     - Screenshots (for UI changes)

### Pull Request Requirements

- [ ] Code follows project style guidelines
- [ ] All tests pass (`npm test`)
- [ ] No linting errors (`npm run lint`)
- [ ] New code has tests
- [ ] Documentation is updated
- [ ] CHANGELOG.md is updated (if applicable)
- [ ] Commit messages follow conventional commit format

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

- VS Code version
- Extension version
- Operating system
- Steps to reproduce
- Expected behavior
- Actual behavior
- Sample DeviceTree file (if applicable)
- Screenshots or error messages

### Feature Requests

When requesting features, please include:

- Clear description of the feature
- Use case / motivation
- Example DeviceTree syntax (if applicable)
- Potential implementation approach (optional)

### Issue Labels

- `bug` - Something isn't working
- `enhancement` - New feature or request
- `documentation` - Documentation improvements
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed

## Questions?

If you have questions about contributing, feel free to:

- Open an issue with the `question` label
- Check existing issues and discussions
- Review the [README.md](README.md) for basic information

Thank you for contributing to the DeviceTree extension!
