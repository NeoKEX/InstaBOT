const logger = require('../utils/logger');
const PermissionManager = require('../utils/permissions');
const database = require('../utils/database');

const ANGER_EMOJIS = ['😠', '😡'];

module.exports = {
  config: {
    name: 'message_reaction',
    description: 'Unsend bot messages when an admin or developer reacts with an anger emoji'
  },

  async run(bot, event) {
    try {
      const { senderID, threadId, reaction, targetMessageId, reactionStatus } = event;

      if (!reaction || !ANGER_EMOJIS.includes(reaction)) return;

      if (reactionStatus === 'deleted') return;

      const role = PermissionManager.getUserRole(senderID);
      if (role < 2) return;

      const sentMessages = database.getAllSentMessages(threadId);
      const isBotMessage = sentMessages.some(msg => msg.itemId === targetMessageId);
      if (!isBotMessage) return;

      await bot.api.unsendMessage(threadId, targetMessageId);
      logger.info('Message unsent via anger reaction', { senderID, threadId, targetMessageId });
    } catch (error) {
      logger.error('Error in message_reaction event', { error: error.message });
    }
  }
};
