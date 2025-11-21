# Repository Guidelines

## Communication Guidelines
All communication must be conducted in Korean (한국어). This includes code comments, commit messages, documentation, pull request descriptions, and all other forms of written communication related to this project.

## Project Structure & Module Organization
The bridge runtime lives in `poc-bridge.js`, a Node.js/Express + Bot Framework service that loads configuration from `.env` and writes transient attachments to `uploads/`. Supporting assets include `scripts/` for operational utilities (for example, run `node scripts/check-freshchat-channels.js` to enumerate Freshchat inbox IDs) and `teams-app/` for the Microsoft Teams manifest, icons, and packaging helpers. Reference playbooks and deployment notes reside in `mvp-docs/`, while `.github/workflows/` contains Fly.io and Teams packaging workflows you should update alongside infrastructure changes.

## Build, Test, and Development Commands
Use `npm install` once to restore dependencies. `npm run dev` launches the bridge with nodemon for hot reloads; `npm start` runs the production entry point with standard logging. `npm run verify` executes `verify-setup.js` to validate Node version, environment variables, and Freshchat connectivity before handing off a build. When preparing Teams assets, run `cd teams-app && ./create-png-icons.sh` to regenerate icons after logo updates.

## Coding Style & Naming Conventions
The codebase follows standard Node 18 syntax with four-space indentation, semicolons, and camelCase identifiers for variables/functions. Keep environment variable names SCREAMING_SNAKE_CASE and centralize configuration in `.env`. Prefer small, pure helper functions near their call sites, and reuse existing logging patterns (`console.log` levels) for observability. Run files through your editor’s ESLint/Prettier defaults only if they preserve the existing layout—there is no enforced formatter in CI.

## Testing Guidelines
Automated tests are not yet in place; lean on `npm run verify` plus targeted manual tests. Exercise both inbound and outbound message paths by posting in the linked Teams channel and confirming delivery in Freshchat, then reply from Freshchat to observe Teams echoing. Capture ngrok URLs and webhook signatures in the runbook when you validate a release.

## Commit & Pull Request Guidelines
Follow the established Conventional Commit style (`feat:`, `chore:`, `fix:`) with succinct, imperative subjects (under ~72 characters) and extra context in the body when needed. Each pull request should describe the scenario, call out configuration or manifest changes, link related issues, and note manual test evidence or screenshots from Teams/Freshchat. Include updated artifact links (Teams zip, Fly deploy) whenever you regenerate them.

## Security & Configuration Tips
Store secrets only in `.env` or your Fly.io secrets store; never commit API keys. Keep `FRESHCHAT_API_URL` normalized (no trailing slash) as expected by the bridge, and rotate the Freshchat webhook public key whenever you sideload a new bot manifest.

