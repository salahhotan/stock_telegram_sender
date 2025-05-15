const { ApiClient, DefaultApi } = require('finnhub');
const TelegramBot = require('node-telegram-bot-api');

// 1. ENHANCED CONFIGURATION VALIDATION ========================
const validateConfig = () => {
  const config = {
    finnhubKey: process.env.FINNHUB_API_KEY?.trim(),
    telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim(),
    chatId: process.env.TELEGRAM_CHAT_ID?.trim()
  };

  if (!config.finnhubKey) {
    console.error('Missing FINNHUB_API_KEY');
    throw new Error('Finnhub API key is required');
  }

  if (!config.telegramToken) {
    console.error('Missing TELEGRAM_BOT_TOKEN');
    throw new Error('Telegram bot token is required');
  }

  if (!config.chatId) {
    console.error('Missing TELEGRAM_CHAT_ID');
    throw new Error('Telegram chat ID is required');
  }

  // Validate Finnhub key format (free tier keys start with 'sandbox_' or 'c' + random chars)
  if (!/^(sandbox_|c[a-z0-9]+)/i.test(config.finnhubKey)) {
    console.error('Invalid Finnhub key format');
    throw new Error('Invalid Finnhub API key format');
  }

  return config;
};

// 2. DEBUGGABLE FINNHUB SERVICE ================================
class FinnhubWrapper {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = this.createClient();
  }

  createClient() {
    try {
      const apiClient = new ApiClient();
      apiClient.apiKey = this.apiKey;
      
      // Add debugging to the default headers
      apiClient.defaultHeaders = {
        ...apiClient.defaultHeaders,
        'X-Debug-Mode': 'true',
        'User-Agent': 'Vercel-Finnhub-Bot/1.0'
      };
      
      return new DefaultApi(apiClient);
    } catch (err) {
      console.error('Client creation failed:', err);
      throw new Error('Failed to initialize Finnhub client');
    }
  }

  async testConnection() {
    try {
      const response = await new Promise((resolve, reject) => {
        this.client.generalNews('general', {}, (err, data) => {
          err ? reject(err) : resolve(data);
        });
      });
      return response.length > 0;
    } catch (error) {
      console.error('Connection test failed:', error);
      throw new Error(`API connection failed: ${error.message}`);
    }
  }

  async getStockData(symbol = 'AAPL') {
    const end = Math.floor(Date.now() / 1000);
    const start = end - (30 * 24 * 60 * 60); // 30 days
    
    console.log(`Requesting ${symbol} data from ${new Date(start * 1000)} to ${new Date(end * 1000)}`);
    
    return new Promise((resolve, reject) => {
      this.client.stockCandles(
        symbol,
        'D',
        start,
        end,
        (error, data) => {
          if (error) {
            console.error('API Error:', {
              status: error.status,
              response: error.response?.text,
              stack: error.stack
            });
            reject(new Error(`Finnhub API error: ${error.message}`));
          } else if (data.s !== 'ok') {
            console.error('Data Error:', {
              status: data.s,
              error: data.error
            });
            reject(new Error(data.error || 'Invalid market data received'));
          } else if (!data.c || data.c.length === 0) {
            reject(new Error('No closing prices available'));
          } else {
            resolve(data);
          }
        }
      );
    });
  }
}

// 3. MAIN FUNCTION WITH CONNECTION TESTING =====================
module.exports = async (req, res) => {
  console.log(`[${new Date().toISOString()}] Request started`);
  
  try {
    // 1. Validate configuration
    const config = validateConfig();
    console.log('Configuration validated');

    // 2. Initialize services
    const finnhub = new FinnhubWrapper(config.finnhubKey);
    const bot = new TelegramBot(config.telegramToken, { polling: false });
    console.log('Services initialized');

    // 3. Test Finnhub connection first
    console.log('Testing Finnhub connection...');
    await finnhub.testConnection();
    console.log('Finnhub connection successful');

    // 4. Get market data
    console.log('Fetching market data...');
    const stockData = await finnhub.getStockData();
    console.log(`Received ${stockData.c.length} data points`);

    // 5. Simple analysis
    const closes = stockData.c.map(Number);
    const lastClose = closes[closes.length - 1];
    const sma5 = calculateSMA(closes, 5);
    const sma20 = calculateSMA(closes, 20);
    const signal = sma5 > sma20 ? 'BUY' : sma5 < sma20 ? 'SELL' : 'HOLD';

    // 6. Send notification
    const message = createSignalMessage('AAPL', signal, lastClose, sma5, sma20);
    await bot.sendMessage(config.chatId, message, { parse_mode: 'Markdown' });
    console.log('Telegram notification sent');

    res.status(200).json({
      status: 'success',
      signal,
      price: lastClose,
      sma5,
      sma20
    });

  } catch (error) {
    console.error('Fatal error:', {
      message: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'Trading signal failed',
      details: error.message,
      debug: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Helper functions
function calculateSMA(data, window) {
  if (!data || data.length < window) return NaN;
  const subset = data.slice(-window);
  return subset.reduce((sum, val) => sum + val, 0) / window;
}

function createSignalMessage(symbol, signal, price, sma5, sma20) {
  return [
    `📊 *${symbol} Trading Signal*`,
    '──────────────────',
    `🟢 *Signal*: ${signal}`,
    `💰 *Price*: $${price.toFixed(2)}`,
    `📈 *5-Day SMA*: $${sma5.toFixed(2)}`,
    `📉 *20-Day SMA*: $${sma20.toFixed(2)}`,
    `⏱️ *Time*: ${new Date().toLocaleString()}`,
    signal === 'BUY' ? '🚀 *Potential Buying Opportunity*' : '',
    signal === 'SELL' ? '⚠️ *Consider Taking Profits*' : ''
  ].filter(Boolean).join('\n');
}
