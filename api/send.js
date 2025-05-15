const FinnhubAPI = require('finnhub');
const TelegramBot = require('node-telegram-bot-api');

// Environment variables
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Initialize APIs
const finnhubClient = new FinnhubAPI.ApiClient().apiKey(FINNHUB_API_KEY);
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// Simple trading strategy - Moving Average Crossover
function analyzeStock(data) {
  const closes = data.c.map(price => parseFloat(price));
  const shortPeriod = 5;
  const longPeriod = 20;
  
  // Calculate moving averages
  const shortMA = calculateMA(closes, shortPeriod);
  const longMA = calculateMA(closes, longPeriod);
  
  // Get current values
  const lastShortMA = shortMA[shortMA.length - 1];
  const lastLongMA = longMA[longMA.length - 1];
  const prevShortMA = shortMA[shortMA.length - 2];
  const prevLongMA = longMA[longMA.length - 2];
  
  // Generate signal
  if (prevShortMA < prevLongMA && lastShortMA > lastLongMA) {
    return 'BUY';
  } else if (prevShortMA > prevLongMA && lastShortMA < lastLongMA) {
    return 'SELL';
  }
  return 'HOLD';
}

function calculateMA(data, period) {
  return data.map((val, idx, arr) => {
    if (idx < period - 1) return null;
    return arr.slice(idx - period + 1, idx + 1).reduce((a, b) => a + b) / period;
  }).filter(val => val !== null);
}

module.exports = async (req, res) => {
  try {
    // Get stock data (example for Apple)
    const stockData = await new Promise((resolve, reject) => {
      finnhubClient.stockCandles("AAPL", "D", 1590988249, 1591852249, (error, data, response) => {
        if (error) reject(error);
        else resolve(data);
      });
    });
    
    // Analyze data
    const signal = analyzeStock(stockData);
    
    // Prepare message
    const lastClose = stockData.c[stockData.c.length - 1];
    const message = `📈 Market Signal for AAPL
🔴 Signal: ${signal}
💰 Last Price: $${lastClose}
📅 ${new Date().toLocaleString()}`;
    
    // Send to Telegram
    await bot.sendMessage(TELEGRAM_CHAT_ID, message);
    
    res.status(200).json({ status: 'Signal sent', signal });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
