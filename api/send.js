const { ApiClient, DefaultApi } = require('finnhub');
const TelegramBot = require('node-telegram-bot-api');

// 1. ENV VARIABLE VALIDATION ====================================
const requiredEnvVars = [
  'FINNHUB_API_KEY',
  'TELEGRAM_BOT_TOKEN', 
  'TELEGRAM_CHAT_ID'
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  throw new Error(`Missing env vars: ${missingVars.join(', ')}`);
}

const config = {
  finnhubKey: process.env.FINNHUB_API_KEY,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID
};

// 2. CLIENT INITIALIZATION ======================================
const apiClient = new ApiClient();
apiClient.apiKey = config.finnhubKey;
const finnhubClient = new DefaultApi(apiClient);

const bot = new TelegramBot(config.telegramToken, {
  polling: false
});

// 3. IMPROVED ANALYSIS FUNCTIONS ================================
function calculateSMA(data, window) {
  if (!data || data.length < window) return null;
  
  return data
    .slice(-window)
    .reduce((sum, price) => sum + price, 0) / window;
}

function generateSignal(stockData) {
  try {
    const closes = stockData.c.map(Number);
    if (closes.length < 20) return 'INSUFFICIENT_DATA';

    const shortSMA = calculateSMA(closes, 5);
    const longSMA = calculateSMA(closes, 20);
    const prevShortSMA = calculateSMA(closes.slice(0, -1), 5);
    const prevLongSMA = calculateSMA(closes.slice(0, -1), 20);

    if (![shortSMA, longSMA, prevShortSMA, prevLongSMA].every(Boolean)) {
      return 'ANALYSIS_ERROR';
    }

    if (prevShortSMA < prevLongSMA && shortSMA > longSMA) return 'BUY';
    if (prevShortSMA > prevLongSMA && shortSMA < longSMA) return 'SELL';
    return 'HOLD';
  } catch (error) {
    console.error('Signal generation failed:', error);
    return 'ANALYSIS_FAILED';
  }
}

// 4. MAIN FUNCTION WITH COMPREHENSIVE ERROR HANDLING ============
module.exports = async (req, res) => {
  console.log('Function started at', new Date().toISOString());
  
  try {
    // Get market data
    const stockData = await new Promise((resolve, reject) => {
      const end = Math.floor(Date.now() / 1000);
      const start = end - (30 * 24 * 60 * 60); // 30 days
      
      finnhubClient.stockCandles(
        'AAPL', 
        'D', 
        start, 
        end,
        (error, data) => {
          if (error) {
            console.error('Finnhub API error:', error);
            return reject(new Error('Failed to fetch market data'));
          }
          if (data.s !== 'ok') {
            console.error('Finnhub data error:', data);
            return reject(new Error('Invalid market data received'));
          }
          resolve(data);
        }
      );
    });

    // Analysis
    const signal = generateSignal(stockData);
    const lastClose = stockData.c[stockData.c.length - 1];
    
    // Prepare message
    const message = [
      '📈 *Market Signal Report*',
      '────────────────────',
      `• *Symbol*: AAPL`,
      `• *Signal*: ${signal}`,
      `• *Price*: $${lastClose.toFixed(2)}`,
      `• *Time*: ${new Date().toLocaleString()}`,
      signal === 'BUY' ? '🚀 *Potential Buying Opportunity*' : '',
      signal === 'SELL' ? '⚠️ *Consider Taking Profits*' : ''
    ].filter(Boolean).join('\n');

    // Send to Telegram
    await bot.sendMessage(config.chatId, message, {
      parse_mode: 'Markdown'
    });

    console.log('Signal sent successfully:', signal);
    res.status(200).json({
      status: 'success',
      signal,
      price: lastClose,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fatal error:', error);
    
    // Attempt to send error notification
    try {
      await bot.sendMessage(
        config.chatId,
        `❌ *Error in Market Signal Bot*:\n${error.message}`,
        { parse_mode: 'Markdown' }
      );
    } catch (telegramError) {
      console.error('Failed to send error notification:', telegramError);
    }
    
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};
