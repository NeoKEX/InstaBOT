# InstaBOT

A modular, role-based Instagram chatbot built on `@neoaz07/nkxica` — production-ready with a dynamic command/event system.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Add your Instagram cookies
Export your Instagram session cookies in **Netscape format** using a browser extension (e.g. *Get cookies.txt LOCALLY*) and save them to `account.txt`.

Minimum required cookies: `sessionid`, `csrftoken`

### 3. Configure
Edit `config/default.json` — set your admin IDs, prefix, timezone, etc.

```jsonc
{
  "prefix": "~",
  "noPrefix": true,
  "adminBot": ["YOUR_USER_ID"],
  "devUsers": ["YOUR_USER_ID"],
  "nickNameBot": "InstaBOT"
}
```

You can also use environment variables for sensitive values:

| Env Var | Description |
|---------|-------------|
| `ACCOUNT_EMAIL` | Instagram account email |
| `ACCOUNT_PASSWORD` | Instagram account password |
| `MONGODB_URI` | MongoDB connection string |
| `PREFIX` | Command prefix override |

### 4. Run
```bash
node index.js
```

---

## Project Structure

```
.
├── index.js                  ← Entry point
├── account.txt               ← Instagram cookies (Netscape format) — keep secret!
├── config/
│   ├── default.json          ← Main configuration file
│   └── index.js              ← Config loader (merges env vars + JSON)
├── bot/
│   └── InstagramBot.js       ← Core bot engine (login, api wrapper, loaders)
├── commands/                 ← Command modules (auto-loaded at startup)
├── events/                   ← Event handlers (auto-loaded at startup)
├── utils/
│   ├── banner.js             ← Startup banner
│   ├── commandLoader.js      ← Dynamic command loading/reloading
│   ├── eventLoader.js        ← Dynamic event loading/reloading
│   ├── database.js           ← SQLite / MongoDB abstraction
│   ├── logger.js             ← Winston logger
│   └── permissions.js        ← Role resolution logic
└── storage/
    ├── data/bot.sqlite        ← SQLite database
    └── logs/                 ← Log files (combined + error)
```

---

## Role System

| Role | Name | Who |
|------|------|-----|
| `0` | Everyone | Any user |
| `2` | Bot Admin | IDs in `adminBot` config |
| `3` | Premium User | IDs in `premiumUsers` config |
| `4` | Developer | IDs in `devUsers` config — full access |

Developers bypass all role checks up to level 3. Bot Admins cannot access role-4 commands.

---

## Creating a Command

Create a new `.js` file inside the `commands/` directory. The filename does not matter — the command is identified by its `config.name` property. It will be auto-loaded on the next bot start, or you can reload it at runtime using the `cmd` admin command.

### Minimal example

```javascript
module.exports = {
  config: {
    name: 'hello',
    description: 'Say hello back'
  },

  async run({ api, event, args, bot }) {
    await api.sendMessage(`Hello!`, event.threadId);
  }
};
```

### Full command template

```javascript
module.exports = {
  config: {
    name: 'hello',               // Primary command name (must be unique)
    description: 'Say hello',    // Short description shown in help

    // Optional
    aliases: ['hi', 'hey'],      // Alternative names that trigger this command
    usage: 'hello [name]',       // Usage hint shown in help
    cooldown: 3,                 // Cooldown in seconds per user (default: 0)
    role: 0,                     // Minimum role required: 0=all  2=admin  3=premium  4=dev
    category: 'fun',             // Category label (used for grouping in help)
    author: 'YourName'           // Optional author tag
  },

  async run({ api, event, args, bot }) {
    // args    — array of words after the command name
    // event   — the raw message event (see Event Object below)
    // api     — wrapped Instagram API (see API Methods below)
    // bot     — the InstagramBot instance (access bot.userID, bot.ig, etc.)

    const name = args[0] || 'friend';
    await api.sendMessage(`Hello, ${name}!`, event.threadId);
  }
};
```

### Event object fields

| Field | Type | Description |
|-------|------|-------------|
| `event.threadId` | string | Thread (group or DM) ID |
| `event.senderID` | string | Sender's user ID |
| `event.messageId` | string | Message ID |
| `event.body` | string | Full message text |
| `event.args` | string[] | Words split from body after prefix+name |
| `event.isGroup` | boolean | Whether the message came from a group |
| `event.attachments` | array | Any attached files/media |
| `event.timestamp` | number | Unix timestamp in ms |
| `event.replyToItemId` | string\|null | Message ID being replied to |

### API methods

| Method | Description |
|--------|-------------|
| `api.sendMessage(text, threadID)` | Send a plain text message |
| `api.sendMessageToUser(text, userID)` | Send a direct message to a user |
| `api.replyToMessage(threadID, text, messageID)` | Send a threaded reply to a specific message |
| `api.sendReaction(emoji, messageID)` | React to a message with an emoji |
| `api.sendPhoto(photoPath, threadID)` | Send a local image file |
| `api.sendVideo(videoPath, threadID)` | Send a local video file |
| `api.sendAudio(audioPath, threadID)` | Send a local audio/voice file |
| `api.sendPhotoFromUrl(threadID, url, opts?)` | Send an image from a URL |
| `api.sendVideoFromUrl(threadID, url, opts?)` | Send a video from a URL |
| `api.sendVoiceFromUrl(threadID, url, opts?)` | Send a voice note from a URL |
| `api.unsendMessage(threadID, messageID)` | Delete a sent message |
| `api.getLastSentMessage(threadID)` | Get the last message the bot sent in a thread |
| `api.getUserInfo(userID)` | Fetch Instagram profile info by user ID |
| `api.getUserInfoByUsername(username)` | Fetch Instagram profile info by username |
| `api.getThread(threadID)` | Fetch thread/group info |
| `api.getInbox()` | Fetch the bot's inbox |
| `api.markAsSeen(threadID)` | Mark a thread as read |

### Checking roles inside a command

```javascript
const { getRole } = require('../utils/permissions');

async run({ api, event, args, bot }) {
  const role = getRole(event.senderID);
  // role: 0 = user, 2 = admin, 3 = premium, 4 = dev
  if (role < 2) {
    return api.sendMessage('Admins only!', event.threadId);
  }
}
```

### Using the database inside a command

```javascript
const database = require('../utils/database');

async run({ api, event, args, bot }) {
  // Economy helpers
  const balance = database.getBalance(event.senderID);
  database.addBalance(event.senderID, 100);

  // Generic key-value store
  database.set(`myKey:${event.senderID}`, { value: 42 });
  const data = database.get(`myKey:${event.senderID}`);

  // Persist changes to disk / MongoDB
  database.save();
}
```

### Sending reactions as status feedback

A common pattern used across all built-in commands:

```javascript
async run({ api, event, args, bot }) {
  // Show "processing" reaction
  await api.sendReaction('⏳', event.messageId);

  try {
    // ... do work ...
    await api.sendMessage('Done!', event.threadId);
    await api.sendReaction('✅', event.messageId);
  } catch (err) {
    await api.sendReaction('❌', event.messageId);
  }
}
```

---

## Creating an Event

Create a new `.js` file inside the `events/` directory. The `name` field must match an Instagram MQTT event type. Events are auto-loaded on startup.

### Event template

```javascript
module.exports = {
  config: {
    name: 'message_reaction',    // Must match the MQTT event type (see list below)
    description: 'Handle message reactions'
  },

  async run({ api, event, bot }) {
    // api   — same wrapped API available in commands
    // event — raw event payload from the MQTT stream
    // bot   — the InstagramBot instance
  }
};
```

### Supported event names

| Name | Trigger |
|------|---------|
| `message` | Every incoming text/media message |
| `ready` | Bot successfully connects and is listening |
| `bot_added` | Bot is added to a group chat |
| `gc_join` | A user joins a group chat the bot is in |
| `gc_leave` | A user leaves a group chat the bot is in |
| `error` | Any unhandled bot error |

> The `message` event is already handled by `events/message.js` (the main router). Create additional events for non-message triggers.

### Example — welcome message when bot is added to a group

```javascript
module.exports = {
  config: {
    name: 'bot_added',
    description: 'Send intro when bot joins a group'
  },

  async run({ api, event, bot }) {
    const { threadId } = event;
    await api.sendMessage(
      `Hi everyone! I'm ${bot.username}. Type ~help to see what I can do.`,
      threadId
    );
  }
};
```

### Example — handle a user leaving a group

```javascript
module.exports = {
  config: {
    name: 'gc_leave',
    description: 'Farewell message'
  },

  async run({ api, event, bot }) {
    const { threadId, leftUserId } = event;
    await api.sendMessage(`User ${leftUserId} has left the chat. Goodbye!`, threadId);
  }
};
```

---

## Configuration Reference

All fields live in `config/default.json`. Most can be overridden by environment variables (see Quick Start).

| Field | Default | Description |
|-------|---------|-------------|
| `prefix` | `~` | Command prefix character |
| `noPrefix` | `true` | Admins and devs can skip the prefix |
| `adminBot` | `[]` | Array of bot admin user IDs (role 2) |
| `premiumUsers` | `[]` | Array of premium user IDs (role 3) |
| `devUsers` | `[]` | Array of developer user IDs (role 4) |
| `antiInbox` | `false` | Ignore direct messages (group-only mode) |
| `database.type` | `sqlite` | `sqlite` or `mongodb` |
| `database.uriMongodb` | `""` | MongoDB connection string |
| `database.saveIntervalMinutes` | `1` | How often to auto-save to disk |
| `spamProtection.commandThreshold` | `8` | Commands per window before auto-ban |
| `spamProtection.timeWindow` | `10` | Time window in seconds |
| `spamProtection.banDuration` | `24` | Ban duration in hours |
| `typingIndicator.enable` | `true` | Show typing indicator before responses |
| `typingIndicator.duration` | `2000` | Typing indicator duration in ms |
| `adminOnly.enable` | `false` | Restrict bot to admins only |
| `restartListenMqtt.enable` | `true` | Periodically restart the MQTT listener |
| `restartListenMqtt.timeRestart` | `3600000` | Restart interval in ms (default 1 hour) |
| `autoRestart.time` | `null` | Cron string or interval ms for auto-restart |
| `autoUptime.enable` | `true` | Ping a URL to keep the process alive |
| `autoUptime.timeInterval` | `180` | Ping interval in seconds |
| `timeZone` | `Asia/Dhaka` | Timezone for cron and time commands |
| `language` | `en` | Bot language (`en`, `vi`) |

---

## Disclaimer

This bot uses Instagram's **unofficial private API**. Instagram's Terms of Service prohibit automated access. Use at your own risk — the author is not responsible for account bans or restrictions.
