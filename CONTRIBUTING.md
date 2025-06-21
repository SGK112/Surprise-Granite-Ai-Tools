# Contributing to Surprise Granite AI Tools

Thank you for your interest in contributing to Surprise Granite AI Tools! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

Please be respectful and considerate of others when contributing to this project. We aim to foster an inclusive and welcoming community.

## How to Contribute

### Reporting Issues

If you find a bug or have a feature request, please create an issue on the project repository. When reporting bugs, please include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior vs. actual behavior
- Screenshots if applicable
- Any relevant logs or error messages

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/SGK112/Surprise-Granite-Ai-Tools.git
   cd Surprise-Granite-Ai-Tools
   ```

2. **Set up the environment**:
   - Create a `.env` file based on the template provided
   - Install dependencies:
     - For Windows: `.\setup.ps1`
     - For Unix: `./run.sh setup`

3. **Run the application locally**:
   - For Windows: `.\run.bat`
   - For Unix: `./run.sh`

### Making Changes

1. **Create a new branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and ensure they follow the project structure and code style.

3. **Test your changes** thoroughly using the test plan in `TEST-PLAN.md`.

4. **Commit your changes** with a clear commit message:
   ```bash
   git commit -m "Add feature: brief description"
   ```

5. **Push your changes**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a pull request** against the main branch.

## Project Structure

- `/public` - Static files served by the Node.js server
- `/data` - Data files and schemas
- `/models` - Database models
- `/routes` - API route definitions
- `/services` - Business logic services
- `/middleware` - Express middleware functions

## Coding Style Guidelines

- Use consistent indentation (2 spaces)
- Include meaningful comments
- Follow the existing code style
- Use semantic HTML, modular CSS, and clean JavaScript

## Testing

Before submitting a pull request, ensure that:

1. All existing functionality still works
2. Your new code has appropriate tests
3. All tests pass

## Documentation

If you add new features or make changes to existing ones, please update the documentation to reflect those changes.

## Review Process

All pull requests will be reviewed by project maintainers. We may suggest changes or improvements before merging.

Thank you for contributing to make Surprise Granite AI Tools better!
