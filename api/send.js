// /api/send.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Valid stock symbols: 1-5 uppercase letters
const SYMBOL_REGEX = /^[A-Z]{1,5}$/;
const requestCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

// Helper function to send errors to Telegram
async function sendErrorToTelegram(errorMessage, errorDetails = '') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(telegramUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: `🚨 *Error Alert* 🚨\n\n${errorMessage}\n\n${errorDetails}`,
            parse_mode: 'Markdown',
        }, {
            timeout: 3000
        });
    } catch (tgError) {
        console.error('Failed to send error to Telegram:', tgError.message);
    }
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Validate environment variables
    if (!FINNHUB_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        const errorMessage = 'Missing required environment variables';
        console.error(errorMessage);
        await sendErrorToTelegram(
            'Server Configuration Error',
            'Missing one or more required environment variables (FINNHUB_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)'
        );
        return res.status(500).json({
            success: false,
            message: 'Server configuration error',
        });
    }

    const { symbol } = req.query;

    // Validate symbol input
    if (!symbol || !SYMBOL_REGEX.test(symbol.toUpperCase())) {
        const errorMessage = `Invalid stock symbol request: ${symbol}`;
        await sendErrorToTelegram(
            'Invalid Stock Symbol',
            `Received invalid symbol: ${symbol}`
        );
        return res.status(400).json({
            success: false,
            message: 'Invalid stock symbol. Please provide a valid 1-5 character ticker symbol.',
        });
    }

    const uppercaseSymbol = symbol.toUpperCase();
    const cacheKey = `symbol:${uppercaseSymbol}`;

    // Check cache
    if (requestCache.has(cacheKey)) {
        const cached = requestCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return res.status(200).json(cached.data);
        }
    }

    const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${uppercaseSymbol}&token=${FINNHUB_API_KEY}`;

    try {
        // Fetch data from Finnhub
        const finnhubResponse = await axios.get(finnhubUrl, {
            timeout: 5000,
            headers: {
                'Accept-Encoding': 'application/json',
            }
        });

        const quoteData = finnhubResponse.data;

        // Validate response
        if (!quoteData || typeof quoteData !== 'object') {
            const errorMessage = `Invalid response format from Finnhub for ${uppercaseSymbol}`;
            await sendErrorToTelegram(
                'Finnhub API Format Error',
                errorMessage
            );
            throw new Error(errorMessage);
        }

        // Check for empty response
        if (quoteData.c === 0 && quoteData.dp === null) {
            const errorMessage = `No data available for symbol: ${uppercaseSymbol}`;
            await sendErrorToTelegram(
                'Stock Data Unavailable',
                errorMessage
            );
            return res.status(404).json({
                success: false,
                message: errorMessage,
            });
        }

        // Format data safely
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
        const changeValue = quoteData.c && quoteData.pc 
            ? (quoteData.c - quoteData.pc).toFixed(2) 
            : 'N/A';

        const changeDirectionEmoji = quoteData.dp >= 0 ? '💹 Up' : '🔻 Down';
        const changeSign = quoteData.dp >= 0 ? '+' : '';
        const isMarketClosed = quoteData.c === quoteData.pc;
        const timestamp = quoteData.t ? new Date(quoteData.t * 1000) : new Date();

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
        
        message += `_Last updated (UTC): ${timestamp.toLocaleString('en-US', {
            timeZone: 'UTC',
            hour12: true,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
        })}_`;

        // Send to Telegram
        const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(telegramUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
        }, {
            timeout: 3000
        });

        // Cache response
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
        
        // Prepare error details for Telegram
        let errorDetails = `🔍 *Error Details:*\n`;
        errorDetails += `• Symbol: ${uppercaseSymbol}\n`;
        errorDetails += `• Time: ${new Date().toISOString()}\n`;
        
        if (error.response) {
            errorDetails += `• API Status: ${error.response.status}\n`;
            errorDetails += `• API Data: ${JSON.stringify(error.response.data)}\n`;
        } else if (error.request) {
            errorDetails += `• No response received\n`;
        } else {
            errorDetails += `• Error Message: ${error.message}\n`;
        }

        // Send error to Telegram
        await sendErrorToTelegram(
            `Failed to process stock data for ${uppercaseSymbol}`,
            errorDetails
        );

        // Return appropriate response
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

        return res.status(500).json({
            success: false,
            message: 'Failed to fetch stock data. Our team has been notified.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
}
