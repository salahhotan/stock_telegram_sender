const FinnhubAPI = require('finnhub');
const TelegramBot = require('node-telegram-bot-api');

// Environment variables
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Validate env vars
if (!FINNHUB_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  throw new Error('Missing required environment variables');
}

// Initialize APIs
const finnhubClient = new FinnhubAPI.DefaultApi(new FinnhubAPI.ApiClient().apiKey(FINNHUB_API_KEY));
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// Helper functions
function calculateMA(data, period) {
  return data.map((val, idx, arr) => {
    if (idx < period - 1) return null;
    return arr.slice(idx - period + 1, idx + 1).reduce((a, b) => a + b) / period;
  }).filter(val => val !== null);
}

function generateDates() {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (60 * 60 * 24 * 30); // 30 days data
  return { start, end };
}

async function getStockData(symbol = 'AAPL') {
  const { start, end } = generateDates();
  return new Promise((resolve, reject) => {
    finnhubClient.stockCandles(symbol, 'D', start, end, (error, data) => {
      if (error) return reject(error);
      if (data.s !== 'ok') return reject(new Error('Invalid stock data'));
      resolve(data);
    });
  });
}

function analyzeStock(data) {
  try {
    const closes = data.c.map(price => parseFloat(price));
    if (closes.length < 20) return 'INSUFFICIENT_DATA';
    
    const shortMA = calculateMA(closes, 5);
    const longMA = calculateMA(closes, 20);
    
    const lastShort = shortMA[shortMA.length - 1];
    const lastLong = longMA[longMA.length - 1];
    const prevShort = shortMA[shortMA.length - 2];
    const prevLong = longMA[longMA.length - 2];
    
    if (prevShort < prevLong && lastShort > lastLong) return 'BUY';
    if (prevShort > prevLong && lastShort < lastLong) return 'SELL';
    return 'HOLD';
  } catch (error) {
    console.error('Analysis error:', error);
    return 'ERROR';
  }
}

module.exports = async (req, res) => {
  try {
    const stockData = await getStockData();
    const signal = analyzeStock(stockData);
    const lastClose = stockData.c[stockData.c.length - 1];
    
    const message = `📈 Market Signal for AAPL
🔴 Signal: ${signal}
💰 Last Price: $${lastClose.toFixed(2)}
📅 ${new Date().toLocaleString()}`;
    
    await bot.sendMessage(TELEGRAM_CHAT_ID, message);
    res.status(200).json({ status: 'success', signal, price: lastClose });
    
  } catch (error) {
    console.error('Endpoint error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Check server logs for more information'
    });
  }
};
