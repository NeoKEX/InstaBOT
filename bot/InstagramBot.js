'use strict';

const { login } = require('@neoaz07/nkxica');

const fs   = require('fs');
const cron = require('node-cron');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const CommandLoader = require('../utils/commandLoader');
const EventLoader   = require('../utils/eventLoader');
const Banner        = require('../utils/banner');

class InstagramBot {
  constructor() {
    this.ig                = null;   // nkxica api object from login()
    this.api               = null;   // our wrapped api
    this.userID            = null;
    this.username          = null;
    this.commandLoader     = new CommandLoader();
    this.eventLoader       = new EventLoader(this);
    this.reconnectAttempts = 0;
    this.shouldReconnect   = config.AUTO_RECONNECT;
    this.isRunning         = false;
    this._mqttRestartTimer  = null;
    this._cookieRefreshTimer = null;
    this._reminderTimer     = null;
  }

  // ── Boot ──────────────────────────────────────────────────────────────

  async start() {
    try {
      Banner.display();
      logger.info('Starting Instagram Bot...');

      const database = require('../utils/database');
      await database.ready;

      await this.commandLoader.loadCommands();
      await this.eventLoader.loadEvents();
      this.eventLoader.registerEvents();

      // Apply options before login (available on the login function itself)
      login.setOptions(config.OPTIONS_FCA);

      await this.loadAndLogin();

      this._scheduleAutoRestart();
      this._scheduleAutoUptime();
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

  // ── Login ─────────────────────────────────────────────────────────────

  async loadAndLogin() {
    const hasCookieFile   = fs.existsSync(config.ACCOUNT_FILE);
    const hasCredentials  = !!(config.ACCOUNT_EMAIL && config.ACCOUNT_PASSWORD);
    const cookieContent   = hasCookieFile ? fs.readFileSync(config.ACCOUNT_FILE, 'utf-8') : '';
    const hasValidCookies = hasCookieFile && this._hasValidCookies(cookieContent);

    if (hasValidCookies) {
      logger.info('Loading cookies from account.txt…');
      this.ig = await login(cookieContent);
    } else if (hasCredentials) {
      logger.info('No valid cookies found — logging in with email/password…');
      this.ig = await login({
        email:    config.ACCOUNT_EMAIL,
        password: config.ACCOUNT_PASSWORD
      });
    } else {
      throw new Error(
        'No valid cookies in account.txt and no email/password configured. ' +
        'Please add Instagram cookies or fill in instagramAccount.email/password in config/default.json.'
      );
    }

    this._afterLogin();

    if (hasCredentials && config.AUTO_REFRESH_FBSTATE && config.INTERVAL_GET_NEW_COOKIE) {
      this._scheduleCookieRefresh();
    }
  }

  _hasValidCookies(content) {
    return content.split('\n').some(line => {
      const t = line.trim();
      if (!t || (t.startsWith('#') && !t.startsWith('#HttpOnly'))) return false;
      return t.includes('sessionid');
    });
  }

  _afterLogin() {
    try {
      const idResult = this.ig.getCurrentUserID();
      this.userID = typeof idResult === 'object'
        ? (idResult.userID || idResult.userId || String(idResult))
        : String(idResult);
    } catch (e) {
      this.userID = 'unknown';
    }

    this.username          = this.userID !== 'unknown' ? this.userID : 'unknown';
    this.api               = this.createAPIWrapper();
    this.reconnectAttempts = 0;
    this.isRunning         = true;
    logger.info('Connected to Instagram', { userID: this.userID });

    this.eventLoader.handleEvent('ready', {}).then(() => {
      this.startListening();
      this._startReminderScheduler();
    });
  }

  // ── Listening ─────────────────────────────────────────────────────────

  startListening() {
    logger.info('Starting message listener…');

    this.ig.listen((err, event) => {
      if (err) {
        const msg = err.message || String(err);
        logger.error('Listen error', { error: msg });

        const isAuthError = /not authorized|login_required|unauthorized/i.test(msg);
        if (isAuthError) {
          logger.error('Session expired or invalid. Update account.txt or credentials in config.');
          this._sendMqttErrorNotification(msg);
          if (config.AUTO_RESTART_WHEN_MQTT_ERROR) {
            this.scheduleReconnect();
          }
        } else if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
        return;
      }

      if (!event) return;

      if (event.type === 'message') {
        this.handleMessage(event).catch(error => {
          logger.error('Error handling message', { error: error.message });
        });
      } else if (event.type === 'event') {
        this.handleThreadEvent(event).catch(error => {
          logger.error('Error handling thread event', { error: error.message });
        });
      }
    });

    if (config.RESTART_LISTEN_MQTT.enable) {
      this._scheduleMqttRestart();
    }

    this.keepAlive();
  }

  _scheduleMqttRestart() {
    if (this._mqttRestartTimer) clearInterval(this._mqttRestartTimer);
    const { timeRestart, delayAfterStopListening, logNoti } = config.RESTART_LISTEN_MQTT;
    this._mqttRestartTimer = setInterval(() => {
      if (logNoti) logger.info('Periodic MQTT listener restart…');
      try { this.ig.stopListening(); } catch (_) {}
      setTimeout(() => {
        if (this.isRunning) this.startListening();
      }, delayAfterStopListening);
    }, timeRestart);
  }

  // ── Message handling ──────────────────────────────────────────────────

  async handleMessage(event) {
    try {
      const { senderID, threadID, messageID, timestamp } = event;

      if (senderID && senderID === this.userID) return;

      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      if ((timestamp || 0) < fiveMinutesAgo && timestamp) return;

      const msgKey  = messageID ? `${threadID}-${messageID}` : `${threadID}-${timestamp}`;
      const database = require('../utils/database');
      if (database.isMessageProcessed(msgKey)) return;
      database.markMessageAsProcessed(msgKey);

      const normalizedEvent = {
        threadID,
        threadId: threadID,
        messageID,
        messageId: messageID,
        senderID,
        senderId: senderID,
        body:           event.body           || '',
        timestamp:      timestamp            || Date.now(),
        type:           event.type           || 'message',
        attachments:    event.attachments    || [],
        isVoiceMessage: event.isVoiceMessage || false,
        isGroup:        event.isGroup        || false,
        replyToItemId:  event.replyTo        || null
      };

      await this.eventLoader.handleEvent('message', normalizedEvent);
    } catch (error) {
      logger.error('Error in handleMessage', { error: error.message, stack: error.stack });
    }
  }

  // ── Thread-event routing ──────────────────────────────────────────────

  async handleThreadEvent(event) {
    try {
      const threadID = event.threadID;
      const logType  = event.logMessageType || '';

      if (logType === 'log:subscribe') {
        const added = event.logMessageData?.addedParticipants || [];

        const botAdded = added.some(p =>
          String(p.userFbId || p.userId || '') === String(this.userID)
        );

        if (botAdded) {
          await this.eventLoader.handleEvent('bot_added', {
            threadID,
            threadId: threadID,
            addedBy: event.author || event.senderID || '',
            addedParticipants: added,
            timestamp: event.timestamp || Date.now()
          });
        } else {
          await this.eventLoader.handleEvent('gc_join', {
            threadID,
            threadId: threadID,
            addedParticipants: added,
            addedBy: event.author || event.senderID || '',
            timestamp: event.timestamp || Date.now()
          });
        }

      } else if (logType === 'log:unsubscribe') {
        const leftUserId = event.logMessageData?.leftParticipantFbId
          || event.logMessageData?.leftParticipantUserFbId
          || '';

        await this.eventLoader.handleEvent('gc_leave', {
          threadID,
          threadId: threadID,
          leftUserId: String(leftUserId),
          timestamp: event.timestamp || Date.now()
        });
      }
    } catch (error) {
      logger.error('Error in handleThreadEvent', { error: error.message });
    }
  }

  // ── Thread-info cache (for role-1 group admin checks) ─────────────────

  _threadInfoCache = new Map();

  async getThreadInfo(threadID) {
    const cached = this._threadInfoCache.get(String(threadID));
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;
    try {
      const info = await this.api.getThread(threadID);
      this._threadInfoCache.set(String(threadID), { data: info, ts: Date.now() });
      return info;
    } catch {
      return null;
    }
  }

  // ── API wrapper ───────────────────────────────────────────────────────

  createAPIWrapper() {
    const ig = this.ig;

    return {
      sendMessage: async (text, threadID) => {
        try {
          if (config.TYPING_INDICATOR) {
            ig.sendTypingIndicator(threadID);
            await this._sleep(config.TYPING_INDICATOR_DURATION);
          }
          const result = await ig.sendMessage(text, threadID);
          if (result?.messageID) {
            const db = require('../utils/database');
            db.storeSentMessage(threadID, result.messageID);
          }
          return result;
        } catch (error) {
          logger.error('Failed to send message', { error: error.message, threadID });
          throw error;
        }
      },

      sendMessageToUser: async (text, userID) => {
        try {
          return await ig.sendDirectMessage(userID, text);
        } catch (error) {
          logger.error('Failed to send direct message', { error: error.message, userID });
          throw error;
        }
      },

      getThread: async (threadID) => {
        try {
          return await ig.getThreadInfo(threadID);
        } catch (error) {
          logger.error('Failed to get thread', { error: error.message, threadID });
          throw error;
        }
      },

      getInbox: async () => {
        try {
          return await ig.getInbox();
        } catch (error) {
          logger.error('Failed to get inbox', { error: error.message });
          throw error;
        }
      },

      markAsSeen: async (threadID) => {
        try {
          return await ig.markAsRead(threadID, true);
        } catch (error) {
          logger.error('Failed to mark as seen', { error: error.message, threadID });
        }
      },

      sendPhoto: async (photoPath, threadID) => {
        try {
          if (config.TYPING_INDICATOR) {
            ig.sendTypingIndicator(threadID);
            await this._sleep(config.TYPING_INDICATOR_DURATION);
          }
          return await ig.sendPhoto(threadID, photoPath, {});
        } catch (error) {
          logger.error('Failed to send photo', { error: error.message, threadID });
          throw error;
        }
      },

      sendVideo: async (videoPath, threadID) => {
        try {
          if (config.TYPING_INDICATOR) {
            ig.sendTypingIndicator(threadID);
            await this._sleep(config.TYPING_INDICATOR_DURATION);
          }
          return await ig.sendVideo(threadID, videoPath, {});
        } catch (error) {
          logger.error('Failed to send video', { error: error.message, threadID });
          throw error;
        }
      },

      sendAudio: async (audioPath, threadID) => {
        try {
          if (config.TYPING_INDICATOR) {
            ig.sendTypingIndicator(threadID);
            await this._sleep(config.TYPING_INDICATOR_DURATION);
          }
          return await ig.sendVoice(threadID, audioPath, {});
        } catch (error) {
          logger.error('Failed to send audio', { error: error.message, threadID });
          throw error;
        }
      },

      // threadID kept for db tracking; only messageID is passed to the library
      unsendMessage: async (threadID, messageID) => {
        try {
          await ig.unsendMessage(messageID);
          const db = require('../utils/database');
          db.removeSentMessage(threadID, messageID);
        } catch (error) {
          logger.error('Failed to unsend message', { error: error.message, threadID, messageID });
          throw error;
        }
      },

      getLastSentMessage: (threadID) => {
        const db = require('../utils/database');
        return db.getLastSentMessage(threadID);
      },

      getUserInfo: async (userID) => {
        try {
          return await ig.getUserInfo(userID);
        } catch (error) {
          logger.error('Failed to get user info', { error: error.message, userID });
          throw error;
        }
      },

      getUserInfoByUsername: async (username) => {
        try {
          return await ig.getUserInfoByUsername(username);
        } catch (error) {
          logger.error('Failed to get user info by username', { error: error.message, username });
          throw error;
        }
      },

      sendPhotoFromUrl: async (threadID, url, opts = {}) => {
        try {
          return await ig.sendPhotoFromUrl(threadID, url, opts);
        } catch (error) {
          logger.error('Failed to send photo from url', { error: error.message, threadID });
          throw error;
        }
      },

      sendVideoFromUrl: async (threadID, url, opts = {}) => {
        try {
          return await ig.sendVideoFromUrl(threadID, url, opts);
        } catch (error) {
          logger.error('Failed to send video from url', { error: error.message, threadID });
          throw error;
        }
      },

      sendVoiceFromUrl: async (threadID, url, opts = {}) => {
        try {
          return await ig.sendVoiceFromUrl(threadID, url, opts);
        } catch (error) {
          logger.error('Failed to send voice from url', { error: error.message, threadID });
          throw error;
        }
      },

      sendReaction: async (reaction, messageID) => {
        try {
          return await ig.sendReaction(reaction, messageID);
        } catch (error) {
          logger.error('Failed to send reaction', { error: error.message, messageID });
        }
      },

      replyToMessage: async (threadID, text, replyToMessageID) => {
        try {
          return await ig.replyToMessage(threadID, text, replyToMessageID);
        } catch (error) {
          logger.error('Failed to reply to message', { error: error.message, threadID });
          throw error;
        }
      }
    };
  }

  // ── Scheduled features ────────────────────────────────────────────────

  _startReminderScheduler() {
    if (this._reminderTimer) clearInterval(this._reminderTimer);
    this._reminderTimer = setInterval(async () => {
      try {
        const database = require('../utils/database');
        const due = database.getDueReminders();
        for (const reminder of due) {
          database.removeReminder(reminder.id);
          try {
            await this.api.sendMessageToUser(
              `⏰ Reminder!\n\n"${reminder.message}"`,
              reminder.userId
            );
          } catch (err) {
            logger.warn('Could not deliver reminder', { userId: reminder.userId, error: err.message });
          }
        }
        if (due.length > 0) database.save();
      } catch (err) {
        logger.error('Reminder scheduler error', { error: err.message });
      }
    }, 30000);
    logger.info('Reminder scheduler started (checks every 30s)');
  }

  _scheduleAutoRestart() {
    const time = config.AUTO_RESTART_TIME;
    if (!time) return;

    if (typeof time === 'string' && cron.validate(time)) {
      logger.info(`Auto-restart scheduled with cron: ${time}`);
      cron.schedule(time, () => {
        logger.info('Auto-restart triggered by cron.');
        process.exit(0);
      }, { timezone: config.TIMEZONE });
    } else {
      const ms = parseInt(time, 10);
      if (ms > 0) {
        logger.info(`Auto-restart scheduled every ${ms}ms.`);
        setTimeout(() => {
          logger.info('Auto-restart triggered.');
          process.exit(0);
        }, ms);
      }
    }
  }

  _scheduleAutoUptime() {
    if (!config.AUTO_UPTIME_ENABLE) return;
    const intervalMs = config.AUTO_UPTIME_INTERVAL * 1000;
    const url = config.AUTO_UPTIME_URL
      || process.env.REPLIT_DEV_DOMAIN
      || '';
    if (!url) return;

    logger.info(`Auto-uptime ping to ${url} every ${config.AUTO_UPTIME_INTERVAL}s`);
    setInterval(() => {
      axios.get(url).catch(() => {});
    }, intervalMs);
  }

  _scheduleCookieRefresh() {
    if (this._cookieRefreshTimer) clearInterval(this._cookieRefreshTimer);
    const intervalMs = (config.INTERVAL_GET_NEW_COOKIE || 1440) * 60 * 1000;
    logger.info(`Cookie auto-refresh scheduled every ${config.INTERVAL_GET_NEW_COOKIE} minutes.`);
    this._cookieRefreshTimer = setInterval(async () => {
      logger.info('Refreshing cookies via email/password login…');
      try {
        this.ig = await login({
          email:    config.ACCOUNT_EMAIL,
          password: config.ACCOUNT_PASSWORD
        });
        this._afterLogin();
        logger.info('Cookie refresh successful.');
      } catch (err) {
        logger.error('Cookie refresh failed.', { error: err.message });
      }
    }, intervalMs);
  }

  async _sendMqttErrorNotification(errorMsg) {
    const { telegram, discordHook } = config.NOTI_MQTT_ERROR;

    if (telegram.enable && telegram.botToken) {
      const chatIds = telegram.chatId.split(/[, ]+/).filter(Boolean);
      for (const chatId of chatIds) {
        axios.post(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
          chat_id: chatId,
          text: `⚠️ Bot MQTT error:\n${errorMsg}`
        }).catch(() => {});
      }
    }

    if (discordHook.enable && discordHook.webhookUrl) {
      const urls = discordHook.webhookUrl.split(/[ ]+/).filter(Boolean);
      for (const url of urls) {
        axios.post(url, { content: `⚠️ Bot MQTT error:\n${errorMsg}` }).catch(() => {});
      }
    }
  }

  // ── Reconnect / shutdown ──────────────────────────────────────────────

  scheduleReconnect() {
    this.reconnectAttempts++;
    if (this.reconnectAttempts >= config.MAX_RECONNECT_ATTEMPTS) {
      logger.error('Max reconnection attempts reached. Stopping bot.');
      process.exit(1);
    }
    logger.info(`Reconnecting in 5s (attempt ${this.reconnectAttempts}/${config.MAX_RECONNECT_ATTEMPTS})…`);
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
      logger.info(`Received ${signal}, shutting down…`);
      this.isRunning       = false;
      this.shouldReconnect = false;
      if (this._mqttRestartTimer)   clearInterval(this._mqttRestartTimer);
      if (this._cookieRefreshTimer) clearInterval(this._cookieRefreshTimer);
      if (this._reminderTimer)      clearInterval(this._reminderTimer);
      try { if (this.ig) this.ig.stopListening(); } catch (_) {}
      logger.info('Bot shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason: String(reason) });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = InstagramBot;
