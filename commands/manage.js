module.exports = {
  config: {
    name: 'manage',
    aliases: ['autoresponse', 'trigger'],
    description: 'Manage auto-responses (Admin only)',
    usage: 'manage <add|remove|list> [trigger] [response]',
    cooldown: 5,
    role: 2,
    author: 'NeoKEX',
    category: 'admin'
  },

  async run({ api, event, args, logger, database }) {
    try {
      if (args.length === 0) {
        return api.sendMessage(
          '⚙️ Auto-Response Management\n\n' +
          'Usage:\n' +
          '• manage list - View all auto-responses\n' +
          '• manage add <trigger> <response>\n' +
          '• manage remove <id>\n\n' +
          'Example:\n' +
          'manage add hello Hello! How can I help you?',
          event.threadId
        );
      }

      const action = args[0].toLowerCase();

      if (action === 'list') {
        const autoResponses = database.getAutoResponses();
        
        if (autoResponses.length === 0) {
          return api.sendMessage(
            '📋 No auto-responses configured yet.\n\n' +
            'Use: manage add <trigger> <response>',
            event.threadId
          );
        }

        let message = '📋 Auto-Responses:\n\n';
        autoResponses.forEach((ar, index) => {
          message += `${index + 1}. ID: ${ar.id}\n`;
          message += `   Trigger: "${ar.trigger}"\n`;
          message += `   Response: "${ar.response}"\n\n`;
        });

        return api.sendMessage(message, event.threadId);
      }

      if (action === 'add') {
        if (args.length < 3) {
          return api.sendMessage(
            '❌ Invalid usage!\n\n' +
            'Usage: manage add <trigger> <response>\n' +
            'Example: manage add hello Hello! How can I help?',
            event.threadId
          );
        }

        const trigger = args[1];
        const response = args.slice(2).join(' ');

        const ar = database.addAutoResponse(trigger, response, event.senderID);
        database.save();

        return api.sendMessage(
          `✅ Auto-response added!\n\n` +
          `ID: ${ar.id}\n` +
          `Trigger: "${trigger}"\n` +
          `Response: "${response}"\n\n` +
          `Now when users send messages containing "${trigger}", ` +
          `the bot will automatically respond!`,
          event.threadId
        );
      }

      if (action === 'remove' || action === 'delete') {
        if (args.length < 2) {
          return api.sendMessage(
            '❌ Please provide the auto-response ID!\n\n' +
            'Usage: manage remove <id>\n' +
            'Use "manage list" to see all IDs',
            event.threadId
          );
        }

        const id = args[1];
        const success = database.removeAutoResponse(id);

        if (success) {
          database.save();
          return api.sendMessage(
            `✅ Auto-response removed successfully!`,
            event.threadId
          );
        } else {
          return api.sendMessage(
            `❌ Auto-response not found with ID: ${id}\n\n` +
            `Use "manage list" to see all auto-responses`,
            event.threadId
          );
        }
      }

      return api.sendMessage(
        '❌ Invalid action!\n\n' +
        'Available actions: list, add, remove',
        event.threadId
      );

    } catch (error) {
      logger.error('Error in manage command', { error: error.message, stack: error.stack });
      return api.sendMessage('Error managing auto-responses.', event.threadId);
    }
  }
};
