// /api/send.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Valid stock symbols: 1-5 uppercase letters (basic validation)
const SYMBOL_REGEX = /^[A-Z]{1,5}$/;

// Cache to prevent duplicate rapid requests
const requestCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

export default async function handler(req, res) {
    // CORS headers (adjust for production)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Validate environment variables
    if (!FINNHUB_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('Missing required environment variables.');
        return res.status(500).json({
            success: false,
            message: 'Server configuration error',
        });
    }

    const { symbol } = req.query;

    // Validate symbol input
    if (!symbol || !SYMBOL_REGEX.test(symbol.toUpperCase())) {
        return res.status(400).json({
            success: false,
            message: 'Invalid stock symbol. Please provide a valid 1-5 character ticker symbol.',
        });
    }

    const uppercaseSymbol = symbol.toUpperCase();
    const cacheKey = `symbol:${uppercaseSymbol}`;

    // Check cache first
    if (requestCache.has(cacheKey)) {
        const cached = requestCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return res.status(200).json(cached.data);
        }
    }

    const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${uppercaseSymbol}&token=${FINNHUB_API_KEY}`;

    try {
        // Fetch data from Finnhub with timeout
        const finnhubResponse = await axios.get(finnhubUrl, {
            timeout: 5000, // 5 second timeout
            headers: {
                'Accept-Encoding': 'application/json',
            }
        });

        const quoteData = finnhubResponse.data;

        // Validate response structure
        if (!quoteData || typeof quoteData !== 'object') {
            throw new Error('Invalid response format from Finnhub');
        }

        // Check for empty response (symbol might not exist)
        if (quoteData.c === 0 && quoteData.dp === null) {
            return res.status(404).json({
                success: false,
                message: `No data available for symbol: ${uppercaseSymbol}. The symbol may be invalid or delisted.`,
            });
        }

        // Check if market is closed (some fields might be null)
        const isMarketClosed = quoteData.c === quoteData.pc;
        const timestamp = quoteData.t ? new Date(quoteData.t * 1000) : new Date();

        // Format numbers safely
        const formatPrice = (value) => {
            if (value === null || value === undefined) return 'N/A';
            return typeof value === 'number' ? value.toFixed(2) : value;
        };

        const currentPrice = formatPrice(quoteData.c);
        const highPrice = formatPrice(quoteData.h);
        const lowPrice = formatPrice(quoteData.l);
        const openPrice = formatPrice(quoteData.o);
        const prevClosePrice = formatPrice(quoteData.pc);
        const percentChange = quoteData.dp ? formatPrice(quoteData.dp) : '0.00';

        // Calculate change from previous close
        const changeValue = quoteData.c && quoteData.pc 
            ? (quoteData.c - quoteData.pc).toFixed(2) 
            : 'N/A';

        const changeDirectionEmoji = quoteData.dp >= 0 ? '💹 Up' : '🔻 Down';
        const changeSign = quoteData.dp >= 0 ? '+' : '';

        // Format timestamp
        const readableTimestamp = timestamp.toLocaleString('en-US', {
            timeZone: 'UTC',
            hour12: true,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
        });

        // Build Telegram message
        let message = `*📊 Stock Update: ${uppercaseSymbol}*\n\n`;
        message += `Current Price: *$${currentPrice}*\n`;
        message += `Change: ${changeDirectionEmoji} *$${changeValue}* (${changeSign}${percentChange}%)\n\n`;
        message += `Open: $${openPrice}\n`;
        message += `High: $${highPrice}\n`;
        message += `Low: $${lowPrice}\n`;
        message += `Previous Close: $${prevClosePrice}\n\n`;
        
        if (isMarketClosed) {
            message += `🛑 *Market is currently closed*\n`;
        }
        
        message += `_Last updated (UTC): ${readableTimestamp}_`;

        // Send to Telegram
        const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(telegramUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
        }, {
            timeout: 3000
        });

        // Cache successful response
        const responseData = {
            success: true,
            message: `Stock data for ${uppercaseSymbol} sent to Telegram successfully.`,
            data: {
                symbol: uppercaseSymbol,
                currentPrice: quoteData.c,
                percentChange: quoteData.dp,
                timestamp: quoteData.t,
            },
        };

        requestCache.set(cacheKey, {
            timestamp: Date.now(),
            data: responseData
        });

        return res.status(200).json(responseData);

    } catch (error) {
        console.error('Error:', error);

        // Handle specific Finnhub errors
        if (error.response?.status === 429) {
            return res.status(429).json({
                success: false,
                message: 'Rate limit exceeded. Please try again later.',
            });
        }

        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                success: false,
                message: 'Request timeout. The stock data service is currently unavailable.',
            });
        }

        // Generic error response
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch stock data. Please try again later.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
}
