const config = require('../config');
const logger = require('../utils/logger');
const PermissionManager = require('../utils/permissions');
const Banner = require('../utils/banner');
const database = require('../utils/database');
const moderation = require('../utils/moderation');
const ConfigManager = require('../utils/configManager');

module.exports = {
  config: {
    name: 'message',
    description: 'Handle incoming messages'
  },

  async run(bot, data) {
    try {
      const { api, commandLoader } = bot;
      const event = data;

      // Ignore messages from self
      if (event.senderID === bot.userID) {
        return;
      }

      // Track user activity
      const user = database.getUser(event.senderID);
      user.messageCount++;
      database.updateUser(event.senderID, user);

      // Moderation checks
      const moderationResult = await moderation.moderateMessage(event.senderID, event.body);
      if (!moderationResult.allowed) {
        logger.info(`Message blocked from ${event.senderID}: ${moderationResult.reason}`);
        if (moderationResult.message && moderationResult.reason !== 'whitelist') {
          await api.sendMessage(moderationResult.message, event.threadId);
        }
        return;
      }

      // Send welcome message to new users
      if (config.WELCOME_MESSAGE_ENABLED && !database.hasBeenWelcomed(event.senderID)) {
        await api.sendMessage(config.WELCOME_MESSAGE, event.threadId);
        database.markAsWelcomed(event.senderID);
        logger.info(`Sent welcome message to user ${event.senderID}`);
      }

      // Log message only in debug mode
      Banner.messageReceived(event.senderID, event.body || '');

      // Ensure event.body is a string
      if (!event.body || typeof event.body !== 'string') {
        return; // Skip non-text messages
      }

      // Check for auto-responses (before command check)
      const autoResponse = database.findAutoResponse(event.body);
      if (autoResponse) {
        await api.sendMessage(autoResponse.response, event.threadId);
        return;
      }

      // Get thread-specific prefix or use global prefix
      const threadData = database.getThreadData(event.threadId);
      const prefix = threadData?.prefix || config.PREFIX;

      // Handle "prefix" command without prefix (show info only)
      const bodyLower = event.body.toLowerCase().trim();
      
      if (bodyLower === 'prefix') {
        const globalPrefix = config.PREFIX;
        const threadPrefix = threadData?.prefix || globalPrefix;
        
        let message = `🌐 Global prefix: ${globalPrefix}\n🛸 Your group chat prefix: ${threadPrefix}`;
        
        await api.sendMessage(message, event.threadId);
        return;
      }

      // Check if message is a command
      if (event.body.startsWith(prefix)) {
        const args = event.body.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        
        // Check if user typed only the prefix
        if (!commandName) {
          return api.sendMessage(
            `ℹ️ You typed only the prefix!\n\n` +
            `Current prefix: ${prefix}\n` +
            `Type ${prefix}help to see all commands.`,
            event.threadId
          );
        }
        
        const command = commandLoader.getCommand(commandName);
        
        if (!command) {
          // Find closest matching command
          const allCommandNames = commandLoader.getAllCommandNames();
          const closestMatch = this.findClosestCommand(commandName, allCommandNames);
          
          let errorMsg = `❌ Unknown command: "${commandName}"\n\n`;
          
          if (closestMatch && closestMatch.distance <= 3) {
            errorMsg += `💡 Did you mean: ${prefix}${closestMatch.command}?\n\n`;
          }
          
          errorMsg += `Type ${prefix}help to see all available commands.`;
          
          return api.sendMessage(errorMsg, event.threadId);
        }

        // Check cooldown
        const cooldownTime = (command.config.cooldown || 0) * 1000;
        const remainingCooldown = commandLoader.checkCooldown(
          event.senderID,
          command.config.name,
          cooldownTime
        );

        if (remainingCooldown > 0) {
          return api.sendMessage(
            `⏰ Please wait ${remainingCooldown}s before using this command again.`,
            event.threadId
          );
        }

        // Check permissions
        const requiredRole = command.config.role || 0;
        const hasPermission = await PermissionManager.hasPermission(event.senderID, requiredRole);

        if (!hasPermission) {
          const roleName = PermissionManager.getRoleName(requiredRole);
          return api.sendMessage(
            `❌ Access Denied!\n\nThis command requires: ${roleName}\nYour role is not sufficient.`,
            event.threadId
          );
        }

        // Execute command
        try {
          Banner.commandExecuted(command.config.name, event.senderID, true);

          // Track command usage
          user.commandCount++;
          database.updateUser(event.senderID, user);
          database.incrementStat('totalCommands');

          await command.run({
            api,
            event,
            args,
            bot,
            commandName: command.config.name,
            logger,
            database,
            config,
            PermissionManager,
            ConfigManager
          });

          // Set cooldown
          if (cooldownTime > 0) {
            commandLoader.setCooldown(event.senderID, command.config.name, cooldownTime);
          }
        } catch (error) {
          logger.error(`Command error: ${command.config.name}`, {
            error: error.message
          });
          
          Banner.commandExecuted(command.config.name, event.senderID, false);
          
          api.sendMessage(
            `❌ Error executing command: ${error.message}`,
            event.threadId
          );
        }
      }
    } catch (error) {
      logger.error('Error in message event handler', {
        error: error.message,
        stack: error.stack
      });
    }
  },

  /**
   * Find closest matching command using Levenshtein distance
   */
  findClosestCommand(input, commandList) {
    let closestCommand = null;
    let minDistance = Infinity;

    for (const cmd of commandList) {
      const distance = this.levenshteinDistance(input.toLowerCase(), cmd.toLowerCase());
      if (distance < minDistance) {
        minDistance = distance;
        closestCommand = cmd;
      }
    }

    return closestCommand ? { command: closestCommand, distance: minDistance } : null;
  },

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[len1][len2];
  }
};
