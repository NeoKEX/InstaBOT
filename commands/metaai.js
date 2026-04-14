'use strict';

const axios = require('axios');

// In-memory conversation store: `${threadID}:${senderID}` → conversation_id
const conversations = new Map();

const META_API = 'https://metakexbyneokex.vercel.app/chat';

function convKey(threadID, senderID) {
  return `${threadID}:${senderID}`;
}

module.exports = {
  config: {
    name: 'metaai',
    aliases: ['meta', 'llama'],
    description: 'Chat with Meta AI — text, image editing, and multi-turn conversations',
    usage: 'metaai <prompt> | metaai clear',
    cooldown: 5,
    role: 0,
    author: 'Neoaz',
    category: 'ai'
  },

  async run({ api, event, args, logger }) {
    try {
      const key = convKey(event.threadId, event.senderID);

      // Clear conversation history
      if (args[0]?.toLowerCase() === 'clear') {
        conversations.delete(key);
        return api.sendMessage('🧹 Conversation cleared. Starting fresh next time!', event.threadId);
      }

      const prompt = args.join(' ').trim();

      // Detect image from attachments (e.g. user sent a photo in the same message)
      let imageUrl = null;
      if (Array.isArray(event.attachments) && event.attachments.length > 0) {
        const photo = event.attachments.find(a =>
          a.type === 'photo' || a.type === 'image'
        );
        if (photo) imageUrl = photo.url;
      }

      if (!prompt && !imageUrl) {
        return api.sendMessage(
          '❌ Please provide a prompt!\n\n' +
          'Usage:\n' +
          '• metaai <your question>\n' +
          '• metaai clear — reset conversation context\n\n' +
          'Tip: Send an image with your prompt for image editing!',
          event.threadId
        );
      }

      await api.sendReaction('⏳', event.messageId);

      const conversationId = conversations.get(key) || null;

      const params = {
        message: prompt || 'Analyze this image',
        new_conversation: conversationId ? 'false' : 'true'
      };
      if (conversationId) params.conversation_id = conversationId;
      if (imageUrl)       params.img_url = imageUrl;

      const response = await axios.get(META_API, { params, timeout: 30000 });
      const { success, message: replyText, image_urls, conversation_id } = response.data;

      if (!success) throw new Error('Meta AI API returned an unsuccessful response');

      // Save the conversation ID for follow-up context
      if (conversation_id) {
        conversations.set(key, conversation_id);
      }

      await api.sendReaction('✅', event.messageId);
      await api.sendMessage(replyText, event.threadId);

      // Send any generated/edited images
      if (Array.isArray(image_urls) && image_urls.length > 0) {
        for (const imgUrl of image_urls) {
          try {
            await api.sendPhotoFromUrl(event.threadId, imgUrl);
          } catch (imgErr) {
            logger.warn('Failed to send generated image', { error: imgErr.message });
          }
        }
      }

    } catch (error) {
      logger.error('metaai error', { error: error.message });
      await api.sendReaction('❌', event.messageId);
      return api.sendMessage(`❌ Error: ${error.message}`, event.threadId);
    }
  }
};
