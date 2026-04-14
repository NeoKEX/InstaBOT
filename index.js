const {
  loadCookies,
  loginWithCookies,
  listen,
  stopListening,
  getCurrentUserID,
  sendMessage,
  sendDirectMessage,
  unsendMessage,
  sendPhoto,
  sendVideo,
  sendVoice,
  sendTypingIndicator,
  markAsRead,
  getThreadInfo,
  getInbox,
  getUserInfo,
  getUserInfoByUsername,
  setOptions
} = require('@neoaz07/nkxica');

const fs = require('fs');
const config = require('./config');
const logger = require('./utils/logger');
const CommandLoader = require('./utils/commandLoader');
const EventLoader = require('./utils/eventLoader');
const Banner = require('./utils/banner');

class InstagramBot {
  constructor() {
    this.api = null;
    this.userID = null;
    this.username = null;
    this.commandLoader = new CommandLoader();
    this.eventLoader = new EventLoader(this);
    this.reconnectAttempts = 0;
    this.shouldReconnect = config.AUTO_RECONNECT;
    this.isRunning = false;
  }

  async start() {
    try {
      Banner.display();
      logger.info('Starting Instagram Bot...');

      await this.commandLoader.loadCommands();
      await this.eventLoader.loadEvents();
      this.eventLoader.registerEvents();

      setOptions({
        selfListen: false,
        listenEvents: true,
        autoMarkRead: false,
        logLevel: 'warn',
        autoReconnect: config.AUTO_RECONNECT,
        maxRetries: config.MAX_RECONNECT_ATTEMPTS
      });

      await this.loadAndLogin();
    } catch (error) {
      logger.error('Failed to start bot', { error: error.message, stack: error.stack });
      await this.eventLoader.handleEvent('error', error);
      if (this.shouldReconnect && this.reconnectAttempts < config.MAX_RECONNECT_ATTEMPTS) {
        this.scheduleReconnect();
      } else {
        logger.error('Unable to start bot, exiting...');
        process.exit(1);
      }
    }
  }

  async loadAndLogin() {
    if (!fs.existsSync(config.ACCOUNT_FILE)) {
      throw new Error(`Cookie file not found: ${config.ACCOUNT_FILE}`);
    }

    const content = fs.readFileSync(config.ACCOUNT_FILE, 'utf-8');
    const hasValidCookies = content.split('\n').some(line => {
      const trimmed = line.trim();
      if (trimmed === '' || (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly'))) return false;
      return trimmed.includes('sessionid');
    });

    if (!hasValidCookies) {
      throw new Error('account.txt contains no valid cookies. Please add your Instagram cookies in Netscape format.');
    }

    const cookieContent = fs.readFileSync(config.ACCOUNT_FILE, 'utf-8');
    logger.info('Loading cookies from account.txt...');
    loadCookies(cookieContent, 'netscape');
    logger.info('Cookies loaded. Connecting to Instagram...');

    return new Promise((resolve, reject) => {
      loginWithCookies(cookieContent, {}, (err) => {
        if (err) return reject(err);

        try {
          const idResult = getCurrentUserID();
          this.userID = typeof idResult === 'object'
            ? (idResult.userID || idResult.userId || String(idResult))
            : String(idResult);
        } catch (e) {
          this.userID = 'unknown';
        }
        this.username = this.userID !== 'unknown' ? this.userID : 'unknown';

        this.api = this.createAPIWrapper();
        this.reconnectAttempts = 0;
        this.isRunning = true;

        logger.info('Connected to Instagram', { userID: this.userID });

        this.eventLoader.handleEvent('ready', {}).then(() => {
          this.startListening();
          resolve();
        });
      });
    });
  }

  startListening() {
    logger.info('Starting message listener...');

    listen((err, event) => {
      if (err) {
        const errMsg = err.message || String(err);
        logger.error('Listen error', { error: errMsg });
        const isAuthError = errMsg.toLowerCase().includes('not authorized') ||
                            errMsg.toLowerCase().includes('login_required') ||
                            errMsg.toLowerCase().includes('unauthorized');
        if (this.shouldReconnect && !isAuthError) {
          this.scheduleReconnect();
        } else if (isAuthError) {
          logger.error('Session cookies are expired or invalid. Please update account.txt with fresh cookies.');
        }
        return;
      }

      if (!event || event.type !== 'message') return;

      this.handleMessage(event).catch(error => {
        logger.error('Error handling message', { error: error.message });
      });
    });

    this.keepAlive();
  }

  async handleMessage(event) {
    try {
      const senderID = event.senderID;
      const threadID = event.threadID;
      const itemId = event.messageID;

      if (senderID && senderID === this.userID) {
        logger.debug('Ignoring message from self');
        return;
      }

      const messageTimestamp = event.timestamp || Date.now();
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      if (messageTimestamp < fiveMinutesAgo) {
        logger.debug('Skipping old message');
        return;
      }

      const messageId = itemId ? `${threadID}-${itemId}` : `${threadID}-${messageTimestamp}`;
      const database = require('./utils/database');

      if (database.isMessageProcessed(messageId)) return;
      database.markMessageAsProcessed(messageId);

      const normalizedEvent = {
        threadID,
        threadId: threadID,
        messageID: itemId,
        messageId: itemId,
        senderID,
        senderId: senderID,
        body: event.body || '',
        timestamp: messageTimestamp,
        type: event.type || 'message',
        attachments: event.attachments || [],
        isVoiceMessage: event.isVoiceMessage || false
      };

      await this.eventLoader.handleEvent('message', normalizedEvent);
    } catch (error) {
      logger.error('Error in handleMessage', { error: error.message, stack: error.stack });
    }
  }

  createAPIWrapper() {
    const self = this;

    return {
      sendMessage: async (text, threadID) => {
        try {
          if (config.TYPING_INDICATOR) {
            try {
              await new Promise((res, rej) => {
                sendTypingIndicator(threadID, (err) => err ? rej(err) : res());
              });
              await new Promise(r => setTimeout(r, 500));
            } catch (_) {}
          }

          return await new Promise((resolve, reject) => {
            sendMessage(text, threadID, (err, result) => {
              if (err) return reject(err);
              if (result && result.messageID) {
                const database = require('./utils/database');
                database.storeSentMessage(threadID, result.messageID);
              }
              resolve(result);
            });
          });
        } catch (error) {
          logger.error('Failed to send message', { error: error.message, threadID });
          throw error;
        }
      },

      sendMessageToUser: async (text, userID) => {
        try {
          return await new Promise((resolve, reject) => {
            sendDirectMessage(text, [userID], (err, result) => {
              if (err) return reject(err);
              resolve(result);
            });
          });
        } catch (error) {
          logger.error('Failed to send direct message', { error: error.message, userID });
          throw error;
        }
      },

      getThread: async (threadID) => {
        try {
          return await new Promise((resolve, reject) => {
            getThreadInfo(threadID, (err, info) => {
              if (err) return reject(err);
              resolve(info);
            });
          });
        } catch (error) {
          logger.error('Failed to get thread', { error: error.message, threadID });
          throw error;
        }
      },

      getInbox: async () => {
        try {
          return await new Promise((resolve, reject) => {
            getInbox((err, inbox) => {
              if (err) return reject(err);
              resolve(inbox);
            });
          });
        } catch (error) {
          logger.error('Failed to get inbox', { error: error.message });
          throw error;
        }
      },

      markAsSeen: async (threadID) => {
        try {
          return await new Promise((resolve, reject) => {
            markAsRead(threadID, true, (err) => {
              if (err) return reject(err);
              resolve();
            });
          });
        } catch (error) {
          logger.error('Failed to mark as seen', { error: error.message, threadID });
        }
      },

      sendPhoto: async (photoPath, threadID) => {
        try {
          if (config.TYPING_INDICATOR) {
            try { await new Promise((res, rej) => sendTypingIndicator(threadID, e => e ? rej(e) : res())); } catch (_) {}
          }
          return await new Promise((resolve, reject) => {
            sendPhoto(threadID, photoPath, {}, (err, result) => {
              if (err) return reject(err);
              resolve(result);
            });
          });
        } catch (error) {
          logger.error('Failed to send photo', { error: error.message, threadID });
          throw error;
        }
      },

      sendVideo: async (videoPath, threadID) => {
        try {
          if (config.TYPING_INDICATOR) {
            try { await new Promise((res, rej) => sendTypingIndicator(threadID, e => e ? rej(e) : res())); } catch (_) {}
          }
          return await new Promise((resolve, reject) => {
            sendVideo(threadID, videoPath, {}, (err, result) => {
              if (err) return reject(err);
              resolve(result);
            });
          });
        } catch (error) {
          logger.error('Failed to send video', { error: error.message, threadID });
          throw error;
        }
      },

      sendAudio: async (audioPath, threadID) => {
        try {
          if (config.TYPING_INDICATOR) {
            try { await new Promise((res, rej) => sendTypingIndicator(threadID, e => e ? rej(e) : res())); } catch (_) {}
          }
          return await new Promise((resolve, reject) => {
            sendVoice(threadID, audioPath, {}, (err, result) => {
              if (err) return reject(err);
              resolve(result);
            });
          });
        } catch (error) {
          logger.error('Failed to send audio', { error: error.message, threadID });
          throw error;
        }
      },

      unsendMessage: async (threadID, messageID) => {
        try {
          await new Promise((resolve, reject) => {
            unsendMessage(threadID, messageID, (err) => {
              if (err) return reject(err);
              resolve();
            });
          });
          const database = require('./utils/database');
          database.removeSentMessage(threadID, messageID);
        } catch (error) {
          logger.error('Failed to unsend message', { error: error.message, threadID, messageID });
          throw error;
        }
      },

      getLastSentMessage: (threadID) => {
        const database = require('./utils/database');
        return database.getLastSentMessage(threadID);
      },

      getUserInfo: async (userID) => {
        try {
          return await new Promise((resolve, reject) => {
            getUserInfo(userID, (err, info) => {
              if (err) return reject(err);
              resolve(info);
            });
          });
        } catch (error) {
          logger.error('Failed to get user info', { error: error.message, userID });
          throw error;
        }
      },

      getUserInfoByUsername: async (username) => {
        try {
          return await new Promise((resolve, reject) => {
            getUserInfoByUsername(username, (err, info) => {
              if (err) return reject(err);
              resolve(info);
            });
          });
        } catch (error) {
          logger.error('Failed to get user info by username', { error: error.message, username });
          throw error;
        }
      }
    };
  }

  scheduleReconnect() {
    this.reconnectAttempts++;
    if (this.reconnectAttempts >= config.MAX_RECONNECT_ATTEMPTS) {
      logger.error('Max reconnection attempts reached. Stopping bot.');
      process.exit(1);
    }
    logger.info(`Reconnecting in 5s (attempt ${this.reconnectAttempts}/${config.MAX_RECONNECT_ATTEMPTS})...`);
    setTimeout(() => {
      this.loadAndLogin().catch(err => {
        logger.error('Reconnection failed', { error: err.message });
        this.scheduleReconnect();
      });
    }, 5000);
  }

  reconnect() {
    this.scheduleReconnect();
  }

  keepAlive() {
    const shutdown = (signal) => {
      logger.info(`Received ${signal}, shutting down...`);
      this.isRunning = false;
      this.shouldReconnect = false;
      try { stopListening(); } catch (_) {}
      logger.info('Bot shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason: String(reason) });
    });
  }
}

const bot = new InstagramBot();
bot.start().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});

module.exports = InstagramBot;
