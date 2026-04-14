'use strict';

const axios = require('axios');

async function fetchAnimeVideos(query) {
  const response = await axios.get(
    `https://lyric-search-neon.vercel.app/kshitiz?keyword=${encodeURIComponent(query)}`,
    { timeout: 15000 }
  );
  return response.data;
}

module.exports = {
  config: {
    name: 'anisearch',
    aliases: ['anime', 'animeedit'],
    description: 'Search for anime edit videos',
    usage: 'anisearch <query>',
    cooldown: 10,
    role: 0,
    author: 'Vex_kshitiz',
    category: 'fun'
  },

  async run({ api, event, args, logger }) {
    try {
      if (args.length === 0) {
        return api.sendMessage(
          '❌ Please provide a search query.\n\nUsage: anisearch <query>\nExample: anisearch naruto',
          event.threadId
        );
      }

      const query = args.join(' ');
      const searchQuery = `${query} anime edit`;

      await api.sendReaction('✨', event.messageId);
      await api.sendMessage(`🔍 Searching for "${query}" anime edits...`, event.threadId);

      const videos = await fetchAnimeVideos(searchQuery);

      if (!videos || videos.length === 0) {
        return api.sendMessage(`❌ No anime edits found for: ${query}`, event.threadId);
      }

      const selected = videos[Math.floor(Math.random() * videos.length)];
      const videoUrl = selected.videoUrl || selected.video_url || selected.url;

      if (!videoUrl) {
        return api.sendMessage('❌ Error: Could not retrieve video URL.', event.threadId);
      }

      await api.sendVideoFromUrl(event.threadId, videoUrl);

    } catch (error) {
      logger.error('anisearch error', { error: error.message });
      return api.sendMessage(
        '❌ An error occurred while fetching the video. Please try again later.',
        event.threadId
      );
    }
  }
};
