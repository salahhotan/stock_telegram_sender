const { ApiClient, DefaultApi } = require('finnhub');
const TelegramBot = require('node-telegram-bot-api');

// 1. SUPER ROBUST CONFIGURATION ================================
const getConfig = () => {
  const env = {
    finnhubKey: process.env.FINNHUB_API_KEY,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  };

  // Validate configuration
  if (!env.finnhubKey) throw new Error('FINNHUB_API_KEY is required');
  if (!env.telegramToken) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (!env.chatId) throw new Error('TELEGRAM_CHAT_ID is required');

  return env;
};

// 2. ENHANCED FINNHUB CLIENT ===================================
class FinnhubService {
  constructor(apiKey) {
    const apiClient = new ApiClient();
    apiClient.apiKey = apiKey;
    this.client = new DefaultApi(apiClient);
  }

  async getStockCandles(symbol, timeframe, days) {
    return new Promise((resolve, reject) => {
      try {
        const end = Math.floor(Date.now() / 1000);
        const start = end - (days * 24 * 60 * 60);

        console.log(`Fetching ${symbol} data (${timeframe}) from ${new Date(start * 1000)} to ${new Date(end * 1000)}`);

        this.client.stockCandles(symbol, timeframe, start, end, (error, data) => {
          if (error) {
            console.error('Finnhub API Error:', error);
            return reject(new Error(`Finnhub API failed: ${error.message}`));
          }

          if (data.s !== 'ok') {
            const errorMsg = `Finnhub data error: ${data.error || 'Unknown error'}`;
            console.error(errorMsg);
            return reject(new Error(errorMsg));
          }

          if (!data.c || data.c.length === 0) {
            return reject(new Error('No closing prices received'));
          }

          resolve(data);
        });
      } catch (err) {
        reject(new Error(`Finnhub service error: ${err.message}`));
      }
    });
  }
}

// 3. TELEGRAM SERVICE WITH RETRIES =============================
class TelegramService {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: false });
    this.maxRetries = 3;
  }

  async sendMessage(chatId, text, options = {}) {
    let attempts = 0;
    
    while (attempts < this.maxRetries) {
      try {
        attempts++;
        await this.bot.sendMessage(chatId, text, options);
        return;
      } catch (error) {
        if (attempts === this.maxRetries) {
          throw new Error(`Failed after ${this.maxRetries} attempts: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
  }
}

// 4. MAIN FUNCTION =============================================
module.exports = async (req, res) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Function started`);

  try {
    const config = getConfig();
    const finnhub = new FinnhubService(config.finnhubKey);
    const telegram = new TelegramService(config.telegramToken);

    // Fetch data with enhanced error handling
    const stockData = await finnhub.getStockCandles('AAPL', 'D', 30)
      .catch(err => {
        console.error('Data fetch failed:', err);
        throw new Error(`Market data unavailable: ${err.message}`);
      });

    // Simple analysis
    const closes = stockData.c.map(Number);
    const lastClose = closes[closes.length - 1];
    const sma5 = calculateSMA(closes, 5);
    const sma20 = calculateSMA(closes, 20);
    
    const signal = sma5 > sma20 ? 'BUY' : 'HOLD';

    // Format message
    const message = [
      '📊 *Market Signal*',
      '──────────────',
      `• *Symbol*: AAPL`,
      `• *Signal*: ${signal}`,
      `• *Price*: $${lastClose.toFixed(2)}`,
      `• *5-Day SMA*: $${sma5.toFixed(2)}`,
      `• *20-Day SMA*: $${sma20.toFixed(2)}`,
      `• *Updated*: ${new Date().toLocaleString()}`
    ].join('\n');

    // Send notification
    await telegram.sendMessage(config.chatId, message, { parse_mode: 'Markdown' });

    console.log(`[SUCCESS] Execution time: ${Date.now() - startTime}ms`);
    res.status(200).json({
      status: 'success',
      signal,
      price: lastClose,
      sma5,
      sma20,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    res.status(500).json({
      error: 'Trading signal failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Helper function
function calculateSMA(data, window) {
  if (!data || data.length < window) return NaN;
  const subset = data.slice(-window);
  return subset.reduce((sum, val) => sum + val, 0) / window;
}
