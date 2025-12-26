# CLAUDE.md - Development Conventions for Mimamori

## Project Overview

Mimamori (見守り - "to watch over, to protect") is a Discord bot that monitors workplace chat for potential discrimination or harassment, providing gentle private reminders when issues are detected.

## Key Features

1. **Cross-channel Context Tracking**: Understands conversation flow across channels to avoid false positives (e.g., a manager providing legitimate feedback in a private channel after seeing an issue in a public channel)
2. **AI-Powered Analysis**: Uses Claude API to understand context and intent
3. **Friendly Reminders**: Sends private DMs with a helpful, non-judgmental tone
4. **Multi-language Support**: English, Japanese, Traditional Chinese

## Architecture

```
Discord Gateway → Message Handler → Context Tracker → Claude Analyzer → DM Notifier
                                         ↓
                                    SQLite DB
```

## Code Standards

### TypeScript
- Strict mode enabled
- No `any` types allowed
- Explicit return types required
- Use `??` (nullish coalescing) over `||` for defaults

### ESLint
- Zero warnings policy (`--max-warnings 0`)
- Unused variables must be prefixed with `_`

### File Naming
- Use kebab-case for files: `context-tracker.ts`
- Use PascalCase for classes: `ContextTracker`
- Use camelCase for functions and variables

## Commands

```bash
npm run dev      # Development with hot reload
npm run build    # Compile TypeScript
npm run start    # Run compiled code
npm run lint     # Check for linting errors
npm run lint:fix # Auto-fix linting errors
```

## Environment Variables

See `.env.example` for required configuration.

## Key Files

- `src/index.ts` - Entry point
- `src/bot.ts` - Discord bot setup
- `src/database/` - SQLite schema and queries
- `src/context/` - Cross-channel context tracking
- `src/analyzer/` - Claude API integration
- `src/actions/` - DM notification logic
- `src/i18n/` - Translations

## Important Considerations

### False Positive Prevention
The key challenge is distinguishing between:
- **Legitimate feedback**: Manager correcting employee behavior
- **Harassment**: Inappropriate criticism or discrimination

Solution: Always gather cross-channel context before analysis. A message in isolation may look negative, but with context it might be appropriate workplace feedback.

### Privacy
- Messages are stored for 24 hours max
- Only metadata needed for context is retained
- No message content is logged or shared externally
