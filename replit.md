# Instagram Bot Project

## Overview
This is a highly advanced Instagram bot built with Node.js and the `@neoaz07/nkxica` chat API. The bot is designed to handle Instagram messages, commands, and events similar to GoatbotV2's architecture.

## Recent Changes
- **2025-10-31 (Latest)**: Improved Message Visibility with Typing Indicator
  - **NEW FEATURE - Typing Indicator Before Messages**: Bot now sends typing indicator before every message
    - Shows "..." indicator to user, signaling bot is about to respond
    - Wakes up Instagram's realtime connection before sending message
    - Helps messages appear faster by triggering Instagram's notification system
    - Applied to all message types: text, photo, video, and audio
    - 500ms delay after typing indicator ensures Instagram processes it
    - Should significantly improve message visibility without manual refresh
  
- **2025-10-31**: Fixed Message Processing Errors & Instagram API Limitation Documented
  - **CRITICAL FIX - Eliminated Repeated Message Errors**: Fixed self-message loop causing spam
    - Root Cause: Bot was processing its own sent messages, creating infinite loop
    - Solution: Moved self-message check to run BEFORE any message processing
    - Fixed: "Skipping already processed message: undefined-..." error eliminated
    - Fixed: Proper message ID extraction using correct field names (item_id, thread_id)
  - **Instagram API Visibility Limitation (DOCUMENTED)**:
    - Messages sent via private API **do NOT trigger real-time push notifications**
    - This is an Instagram platform limitation that cannot be fixed with code
    - Messages arrive successfully on Instagram servers immediately
    - User must manually refresh chat (leave/re-enter) to see bot messages
    - Alternative: Use official Instagram Messaging API (business accounts only)
    - This is expected behavior for all Instagram bots using private APIs
  - **PermissionManager Error Fixed**: Fixed dependency injection in admin command
    - All helper methods now receive PermissionManager and ConfigManager parameters
    - showAdminPanel, listAdmins, addAdmin, removeAdmin methods updated
    - Admin command now works without errors
  - **Removed Message Queue**: Bot now responds instantly without queueing delays
    - Messages are sent immediately when commands are executed
    - No more artificial delays from queue processing
  - **Persistent Message Tracking**: Processed messages now stored in database
    - Messages won't be re-processed after bot restarts
    - Up to 5 minutes of message history tracked
    - Automatic cleanup of old processed messages
  - **Prefix Command Behavior**: Proper separation of info display vs. command execution
    - Type `prefix` (without prefix) → Shows current global and thread prefix info
    - Type `!prefix` (with prefix) → Shows usage instructions
    - Type `!prefix <new>` → Changes prefix for that chat/group
    - Matches GoatBot V2 behavior exactly
  - **Removed Auto-Seen**: Messages are no longer automatically marked as seen
  - **Persistent Message Tracking**: Sent messages now stored in database
    - Messages can be unsent even after bot restarts
    - Up to 50 messages per thread stored
    - Automatic cleanup of messages older than 7 days
  - **Enhanced Unsend Command**: Two modes of operation
    - Reply to a message and type `unsend` to delete it
    - Type `unsend` without reply to delete the bot's last message

- **2025-10-31**: Runtime Error Fixes & Prefix Feature
  - **Runtime Error Fixes**: Fixed all remaining runtime errors
    - Fixed Banner.messageReceived to handle all data types (objects, strings, null)
    - Fixed typing indicator with proper function existence checks
    - Fixed event.body handling to skip non-text messages (links, images, etc.)
  - **Prefix Command**: New `prefix` command with per-thread customization
    - Thread-specific prefix support (stored in database)
    - Global prefix changes (admin only)
    - Reset to default functionality
    - Auto-injected dependencies (no manual imports needed)
  - **Database Enhancement**: Added thread data storage system
    - getThreadData, setThreadData, deleteThreadData methods
  - **Rate Limiting Optimization**: Instagram-friendly message delays
    - 1200ms base delay + 200-800ms random jitter
    - Prevents spam detection and auto-unsent messages
    - Retry logic with exponential backoff
  - **Bot Status**: ✅ Running error-free with all 23 commands operational

- **2025-10-31**: Major Bug Fixes & Advanced Features Implementation
  - **Security**: Fixed critical security vulnerability in calc.js (replaced unsafe eval() with safe numeric-only expression evaluator)
  - **Error Logging**: Added proper error logging to 15+ command files (ping, help, info, echo, calc, choose, dice, coinflip, quote, time, uid, userinfo, joke, credits, dev)
  - **Database System**: Created comprehensive JSON-based database (utils/database.js) with:
    - User tracking and statistics
    - Economy system foundation
    - Auto-responses storage
    - Spam tracking and warnings
    - Ban management
    - Reminders framework
    - Auto-save functionality
  - **Moderation System**: Implemented complete moderation suite (utils/moderation.js) with:
    - Anti-spam protection with configurable rate limits
    - Whitelist/blacklist functionality
    - Bad words filtering with auto-ban
    - Progressive discipline system
  - **Message Handler Enhancements**: Enhanced events/message.js with:
    - Moderation checks before command execution
    - Welcome message system for new users
    - Typing indicator support
    - Auto-response trigger system
    - User statistics tracking
    - Command usage tracking
  - **New Advanced Commands**: Created 5 new commands:
    - `ai` - AI/GPT integration for intelligent responses (requires OPENAI_API_KEY)
    - `8ball` - Magic 8-ball fortune game
    - `rps` - Rock Paper Scissors game
    - `stats` - Comprehensive bot and user statistics
    - `manage` - Auto-response management (admin only)
  - **Testing**: Verified all 22 commands load and run successfully with no errors
  
- **2025-10-30**: Initial project setup
  - Installed Node.js 20 and dependencies (neokex-ica, winston, dotenv, node-cron, axios, tough-cookie)
  - Created complete bot architecture with command and event systems
  - Implemented cookie-based authentication using Netscape format
  - Added comprehensive error handling and auto-reconnect functionality
  - Created logging system with winston
  - Built message queue with rate limiting
  - Added dynamic command loader with cooldown support
  - Created event handling system
  - Added example commands: help, ping, info, echo
  - Added event handlers: message, ready, error

## Project Architecture
```
├── index.js              # Main bot engine with Instagram connection
├── config.js             # Configuration management
├── account.txt           # Instagram cookies in Netscape format (user must provide)
├── commands/             # 23 Command modules
│   ├── ai.js            # AI/GPT integration
│   ├── 8ball.js         # Magic 8-ball game
│   ├── admin.js         # Admin management
│   ├── calc.js          # Safe math calculator
│   ├── choose.js        # Random choice picker
│   ├── coinflip.js      # Coin flip game
│   ├── credits.js       # Bot credits
│   ├── dev.js           # Developer panel
│   ├── dice.js          # Dice roller
│   ├── echo.js          # Echo messages
│   ├── help.js          # Show available commands
│   ├── info.js          # Bot information
│   ├── joke.js          # Random jokes
│   ├── manage.js        # Auto-response management
│   ├── ping.js          # Check bot response time
│   ├── prefix.js        # Prefix management (thread & global)
│   ├── quote.js         # Inspirational quotes
│   ├── rps.js           # Rock Paper Scissors game
│   ├── stats.js         # Bot & user statistics
│   ├── time.js          # World time zones
│   ├── uid.js           # Get Instagram user IDs
│   ├── unsend.js        # Unsend messages
│   └── userinfo.js      # Instagram user profiles
├── events/              # Event handlers
│   ├── message.js       # Enhanced message handler with moderation & features
│   ├── ready.js         # Bot connected event
│   └── error.js         # Error handling and auto-reconnect
├── utils/               # Utility modules
│   ├── logger.js        # Winston logging system
│   ├── database.js      # JSON database with auto-save
│   ├── moderation.js    # Anti-spam, whitelist/blacklist, bad words
│   ├── permissions.js   # Role-based permissions
│   ├── banner.js        # Console banners
│   ├── cookieParser.js  # Parse Netscape cookie format
│   ├── commandLoader.js # Dynamic command loading
│   └── eventLoader.js   # Event system management
├── logs/                # Log files (auto-generated)
└── data/                # Persistent data storage (database.json)
```

## User Preferences
None set yet.

## Setup Instructions
1. The bot requires Instagram cookies in Netscape format saved to `account.txt`
2. Users should export their Instagram cookies using a browser extension
3. Required cookies: sessionid, csrftoken, ds_user_id
4. Run with `npm start` or `node index.js`

## Key Features

### Core Features
- Cookie-based Instagram authentication
- Comprehensive event handling system
- Command system with customizable prefixes (global & per-thread)
- Automatic error recovery and reconnection
- Instant message delivery with visibility optimization
- Advanced logging with file and console output
- Dynamic command and event loading
- Cooldown system for commands
- Graceful shutdown handling
- Robust error handling for all message types

### Advanced Features (GoatBot V2-level)
- **Moderation System**:
  - Anti-spam protection with configurable rate limits
  - Whitelist/blacklist user management
  - Bad words filtering with auto-ban
  - Progressive warning system
  - Automatic ban after repeated violations
- **Database System**:
  - JSON-based persistent storage
  - User activity tracking
  - Thread-specific data storage
  - Statistics collection
  - Economy system foundation
  - Auto-save functionality
- **User Engagement**:
  - Welcome messages for new users
  - Typing indicators during command execution
  - Auto-response trigger system
  - User statistics and rankings
- **AI Integration**:
  - GPT-powered AI responses (requires API key)
  - Natural language processing
- **Games & Entertainment**:
  - Magic 8-ball fortune telling
  - Rock Paper Scissors
  - Dice roller
  - Coin flip
  - Random jokes and quotes
- **Admin Tools**:
  - Prefix customization (per-thread & global)
  - Auto-response management
  - User statistics dashboard
  - Bot statistics and monitoring
  - Admin panel for bot management

## Dependencies
- neokex-ica: Instagram Chat API
- winston: Advanced logging
- tough-cookie: Cookie parsing
- dotenv: Environment configuration
- node-cron: Task scheduling
- axios: HTTP requests

## Current State
✅ **Fully Operational** - All 23 commands loaded successfully, comprehensive moderation system active, database system functional, and bot running without errors. Latest runtime errors fixed and prefix customization feature added.

### Completed Features (8/20 major tasks)
1. ✅ Error logging fixed across all commands
2. ✅ Security vulnerability in calc.js fixed
3. ✅ Anti-spam protection system
4. ✅ Whitelist/blacklist system
5. ✅ Typing indicator
6. ✅ Welcome message system
7. ✅ Auto-block and bad words filtering
8. ✅ Database system with JSON storage
9. ✅ Auto-response/trigger system
10. ✅ User statistics tracking
11. ✅ AI integration command
12. ✅ Advanced game commands
13. ✅ Stats dashboard command

### Future Enhancements (Optional)
- Image generation command (DALL-E integration)
- Media download commands (YouTube, TikTok, Instagram)
- Utility commands (weather, news, crypto, translate)
- More games (trivia, slots, blackjack)
- Reminder and scheduled message system
- Session management with auto cookie refresh
- More fun commands (meme, gif, facts)
