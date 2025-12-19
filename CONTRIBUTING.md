# Contributing to EV DC Route Planner

First off, thanks for taking the time to contribute! This project aims to help EV drivers plan road trips with confidence.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Style Guide](#style-guide)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Good First Issues

Look for issues labeled [`good first issue`](https://github.com/mbuckingham74/ev_mapping_app/labels/good%20first%20issue) - these are great for newcomers!

### Areas Where Help is Needed

- **Frontend** - React components, UI/UX improvements, accessibility
- **Backend** - API endpoints, database optimization, caching
- **iOS App** - SwiftUI, MapKit, background location tracking
- **Documentation** - README improvements, API docs, tutorials
- **Testing** - Unit tests, integration tests, E2E tests
- **Data** - Station data accuracy, new data sources

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report:
1. Check if the issue already exists
2. Try to reproduce it on the [live demo](https://ev.tachyonfuture.com)

When filing a bug, include:
- Clear, descriptive title
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Browser/device info

### Suggesting Features

Feature requests are welcome! Please:
1. Check if it's already been suggested
2. Explain the use case and why it would benefit EV drivers
3. Consider if it fits the project's scope

### Code Contributions

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Development Setup

### Prerequisites

- Node.js 22+
- Docker & Docker Compose
- Git

### Quick Start

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/ev_mapping_app.git
cd ev_mapping_app

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start database
npm run docker:dev:up

# Run dev servers
npm run dev
```

### Environment Variables

You'll need API keys for:
- **OpenChargeMap** - Free at [openchargemap.org](https://openchargemap.org/site/develop/api)
- **OpenRouteService** - Free tier at [openrouteservice.org](https://openrouteservice.org/dev/#/signup)

### Project Structure

```
ev-app/
├── client/          # React frontend (Vite + TypeScript)
├── server/          # Express backend (TypeScript)
├── ios/             # SwiftUI iOS app
└── docker-compose.yml
```

## Pull Request Process

1. **Update documentation** if you're changing behavior
2. **Follow the style guide** (see below)
3. **Write meaningful commit messages**
4. **Keep PRs focused** - one feature/fix per PR
5. **Test your changes** locally before submitting
6. **Fill out the PR template** completely

### PR Title Format

Use conventional commits style:
- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `style: formatting changes`
- `refactor: code restructuring`
- `test: add tests`
- `chore: maintenance tasks`

## Style Guide

### TypeScript/JavaScript

- Use TypeScript for all new code
- Prefer `const` over `let`
- Use meaningful variable names
- Add types - avoid `any`

### React

- Functional components with hooks
- Keep components focused and small
- Use Tailwind CSS for styling

### Backend

- Use async/await over callbacks
- Validate inputs
- Handle errors gracefully
- Use parameterized queries (prevent SQL injection)

### Git Commits

- Use present tense ("Add feature" not "Added feature")
- Keep the first line under 72 characters
- Reference issues when applicable (`Fixes #123`)

## Questions?

Feel free to open an issue with the `question` label or reach out via GitHub Discussions.

---

Thank you for contributing! Every improvement helps EV drivers plan better road trips.
