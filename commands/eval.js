// Use vm2 for sandboxed code execution instead of dangerous eval()
module.exports = {
  config: {
    name: 'eval',
    aliases: ['ev', 'js'],
    description: 'Execute JavaScript code in the bot context (Developer only)',
    usage: 'eval <code>',
    cooldown: 0,
    role: 4,
    author: 'NeoKEX',
    category: 'owner'
  },

  async run({ api, event, args, logger, config }) {
    const code = args.join(' ');

    if (!code) {
      return api.sendMessage('❌ Please provide code to execute.\n\nUsage: eval <code>', event.threadId);
    }

    try {
      // SECURITY FIX: Use vm2 instead of eval()
      // First, install: npm install vm2
      let VM;
      try {
        VM = require('vm2').VM;
      } catch (e) {
        logger.error('vm2 not installed. Install with: npm install vm2');
        return api.sendMessage('❌ vm2 library not installed. Ask admin to install it.', event.threadId);
      }

      const vm = new VM({
        timeout: 10000,
        sandbox: {
          // Expose only safe APIs
          Math: Math,
          JSON: JSON,
          console: { log: (x) => x },
          String: String,
          Number: Number,
          Array: Array,
          Object: Object
        }
      });

      let result = vm.run(`(async () => { ${code} })()`);
      if (result && typeof result.then === 'function') {
        result = await result;
      }

      function output(msg) {
        if (typeof msg === 'number' || typeof msg === 'boolean' || typeof msg === 'function') {
          return msg.toString();
        } else if (typeof msg === 'undefined') {
          return 'undefined';
        } else if (typeof msg === 'object') {
          try { return JSON.stringify(msg, null, 2); } catch (_) { return String(msg); }
        }
        return String(msg);
      }

      const text = result !== undefined ? output(result) : '✅ Executed (no return value)';
      const trimmed = text.length > 2000 ? text.substring(0, 1997) + '...' : text;

      return api.sendMessage(`✓ Output:\n\n${trimmed}`, event.threadId);
    } catch (error) {
      logger.error('eval error', { error: error.message, code: code.substring(0, 100) });
      const errText = (error.stack || error.message || String(error)).substring(0, 1997);
      return api.sendMessage(`✗ Error:\n\n${errText}`, event.threadId);
    }
  }
};
