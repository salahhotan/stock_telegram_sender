// /api/send.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SYMBOL_REGEX = /^[A-Z]{1,5}$/;

async function sendTelegramAlert(errorMessage, errorDetails = '') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
    
    const alertMessage = `🚨 *Error Alert* 🚨\n\n` +
                        `*Error:* ${errorMessage}\n` +
                        (errorDetails ? `*Details:* ${errorDetails}\n` : '') +
                        `\n_${new Date().toUTCString()}_`;

    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: TELEGRAM_CHAT_ID,
                text: alertMessage,
                parse_mode: 'Markdown'
            },
            { timeout: 3000 }
        );
        return true;
    } catch (tgError) {
        console.error('Failed to send error alert to Telegram:', tgError);
        return false;
    }
}

export default async function handler(req, res) {
    // Setup CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Validate environment variables
    if (!FINNHUB_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        const errorMsg = 'Missing required environment variables';
        console.error(errorMsg);
        await sendTelegramAlert('Server Configuration Error', errorMsg);
        return res.status(500).json({
            success: false,
            message: 'Server configuration error',
        });
    }

    const { symbol } = req.query;

    // Validate symbol input
    if (!symbol || !SYMBOL_REGEX.test(symbol.toUpperCase())) {
        const errorMsg = `Invalid stock symbol: ${symbol}`;
        await sendTelegramAlert('Invalid Request', errorMsg);
        return res.status(400).json({
            success: false,
            message: 'Invalid stock symbol. Please provide a valid 1-5 character ticker symbol.',
        });
    }

    const uppercaseSymbol = symbol.toUpperCase();
    const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${uppercaseSymbol}&token=${FINNHUB_API_KEY}`;

    try {
        // Fetch data from Finnhub
        const finnhubResponse = await axios.get(finnhubUrl, {
            timeout: 5000,
            headers: { 'Accept-Encoding': 'application/json' }
        });

        const quoteData = finnhubResponse.data;

        // Validate response
        if (!quoteData || typeof quoteData !== 'object') {
            const errorMsg = `Invalid response format for ${uppercaseSymbol}`;
            await sendTelegramAlert('Data Format Error', errorMsg);
            return res.status(502).json({
                success: false,
                message: 'Received invalid data from stock service',
            });
        }

        // Check for invalid symbol or no data
        if (quoteData.c === 0 && quoteData.dp === null) {
            const errorMsg = `No data available for symbol: ${uppercaseSymbol}`;
            await sendTelegramAlert('Data Not Found', errorMsg);
            return res.status(404).json({
                success: false,
                message: errorMsg,
            });
        }

        // Format and send the successful message
        const formatPrice = (value) => value?.toFixed(2) ?? 'N/A';
        const isMarketClosed = quoteData.c === quoteData.pc;
        const timestamp = quoteData.t ? new Date(quoteData.t * 1000) : new Date();

        const message = `*📊 Stock Update: ${uppercaseSymbol}*\n\n` +
                       `Current Price: *$${formatPrice(quoteData.c)}*\n` +
                       `Change: ${quoteData.dp >= 0 ? '💹 Up' : '🔻 Down'} ` +
                       `*$${(quoteData.c - quoteData.pc).toFixed(2)}* ` +
                       `(${quoteData.dp >= 0 ? '+' : ''}${formatPrice(quoteData.dp)}%)\n\n` +
                       `Open: $${formatPrice(quoteData.o)}\n` +
                       `High: $${formatPrice(quoteData.h)}\n` +
                       `Low: $${formatPrice(quoteData.l)}\n` +
                       `Previous Close: $${formatPrice(quoteData.pc)}\n\n` +
                       `${isMarketClosed ? '🛑 *Market is currently closed*\n' : ''}` +
                       `_Last updated (UTC): ${timestamp.toUTCString()}_`;

        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            },
            { timeout: 3000 }
        );

        return res.status(200).json({
            success: true,
            message: `Stock data for ${uppercaseSymbol} sent successfully`,
            data: {
                symbol: uppercaseSymbol,
                currentPrice: quoteData.c,
                percentChange: quoteData.dp,
                timestamp: quoteData.t,
            },
        });

    } catch (error) {
        console.error('Handler Error:', error);

        // Prepare error details for Telegram
        const errorDetails = {
            symbol: uppercaseSymbol,
            error: error.message,
            code: error.code,
            status: error.response?.status,
            url: finnhubUrl,
            timestamp: new Date().toISOString()
        };

        // Send error alert to Telegram
        await sendTelegramAlert(
            'Stock Data Fetch Failed',
            `Symbol: ${uppercaseSymbol}\n` +
            `Error: ${error.message}\n` +
            `Code: ${error.code || 'N/A'}\n` +
            `Status: ${error.response?.status || 'N/A'}`
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
            error: process.env.NODE_ENV === 'development' ? errorDetails : undefined,
        });
    }
}
