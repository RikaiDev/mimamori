# Mimamori

> 見守り (mimamori) - to watch over, to protect

**Workplace Atmosphere Guardian** - A Discord bot that monitors workplace chat for potential discrimination or harassment, providing gentle private reminders when issues are detected.

## Features

- **Smart Context Awareness**: Tracks conversations across channels to understand context before flagging issues
- **AI-Powered Analysis**: Uses Claude API to understand intent and distinguish between legitimate feedback and problematic behavior
- **Friendly Reminders**: Sends private DMs with helpful, non-judgmental tone
- **Multi-language**: Supports English, Japanese, and Traditional Chinese

## Why Mimamori?

In workplace Discord servers, senior team members may sometimes unintentionally use language that could be perceived as discriminatory or bullying. Mimamori helps by:

1. Monitoring messages in real-time
2. Building context from cross-channel conversations
3. Analyzing potential issues with AI
4. Sending friendly private reminders to the sender

### Cross-Channel Context

A key feature is understanding cross-channel conversation flow. For example:

- Manager sees an employee's mistake in `#project-channel`
- Manager provides feedback in `#private-team`

This is legitimate workplace feedback, not harassment. Mimamori understands this by tracking the context chain.

## Installation

```bash
# Clone the repository
git clone https://github.com/RikaiDev/mimamori.git
cd mimamori

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Build and run
npm run build
npm run start
```

## Configuration

See `.env.example` for required environment variables:

- `DISCORD_TOKEN` - Your Discord bot token
- `ANTHROPIC_API_KEY` - Your Anthropic API key
- `LANGUAGE` - Default language (en/ja/zh-TW)

## Development

```bash
npm run dev      # Development with hot reload
npm run lint     # Check for linting errors
npm run build    # Compile TypeScript
```

## Discord Bot Setup

1. Create a new application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot and get the token
3. Enable **Message Content Intent** in Bot settings
4. Invite bot to your server with appropriate permissions

## Requirements

- Node.js 18+
- Discord bot token with Message Content Intent
- Anthropic API key

## License

MIT

## Part of RikaiDev

Mimamori is the fifth tool in the [RikaiDev](https://github.com/RikaiDev) suite of AI-powered productivity tools.
