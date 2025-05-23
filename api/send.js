// /api/send.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SYMBOL_REGEX = /^[A-Z]{1,5}$/;

// Helper function to send messages to Telegram
async function sendTelegramMessage(text, isError = false) {
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(telegramUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: isError ? `❌ Error: ${text}` : text,
            parse_mode: 'Markdown',
        }, {
            timeout: 3000
        });
    } catch (tgError) {
        console.error('Failed to send Telegram message:', tgError.message);
    }
}

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 1. First send hello message
    try {
        await sendTelegramMessage(`👋 Hello! Starting stock data request...`);
    } catch (helloError) {
        console.error('Failed to send hello message:', helloError);
        // Continue execution even if hello message fails
    }

    // Validate environment variables
    if (!FINNHUB_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        const errorMsg = 'Missing required environment variables.';
        console.error(errorMsg);
        await sendTelegramMessage(errorMsg, true);
        return res.status(500).json({
            success: false,
            message: 'Server configuration error',
        });
    }

    const { symbol } = req.query;

    // Validate symbol input
    if (!symbol || !SYMBOL_REGEX.test(symbol.toUpperCase())) {
        const errorMsg = `Invalid stock symbol: ${symbol}. Please provide a valid 1-5 character ticker symbol.`;
        await sendTelegramMessage(errorMsg, true);
        return res.status(400).json({
            success: false,
            message: errorMsg,
        });
    }

    const uppercaseSymbol = symbol.toUpperCase();
    const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${uppercaseSymbol}&token=${FINNHUB_API_KEY}`;

    try {
        // Fetch data from Finnhub
        await sendTelegramMessage(`🔍 Fetching data for ${uppercaseSymbol}...`);
        
        const finnhubResponse = await axios.get(finnhubUrl, {
            timeout: 5000,
            headers: { 'Accept-Encoding': 'application/json' }
        });

        const quoteData = finnhubResponse.data;

        // Validate response
        if (!quoteData || typeof quoteData !== 'object') {
            throw new Error('Invalid response format from Finnhub');
        }

        if (quoteData.c === 0 && quoteData.dp === null) {
            const errorMsg = `No data available for symbol: ${uppercaseSymbol}`;
            await sendTelegramMessage(errorMsg, true);
            return res.status(404).json({
                success: false,
                message: errorMsg,
            });
        }

        // Format data
        const formatPrice = (value) => value?.toFixed(2) ?? 'N/A';
        const currentPrice = formatPrice(quoteData.c);
        const percentChange = formatPrice(quoteData.dp);
        const changeValue = (quoteData.c - quoteData.pc).toFixed(2);
        const changeDirection = quoteData.dp >= 0 ? '💹 Up' : '🔻 Down';

        // Create message
        const message = [
            `*📊 ${uppercaseSymbol} Stock Update*`,
            `Current: *$${currentPrice}*`,
            `Change: ${changeDirection} *$${changeValue}* (${quoteData.dp >= 0 ? '+' : ''}${percentChange}%)`,
            `High: $${formatPrice(quoteData.h)}`,
            `Low: $${formatPrice(quoteData.l)}`,
            `Prev Close: $${formatPrice(quoteData.pc)}`,
            `_Updated: ${new Date(quoteData.t * 1000).toUTCString()}_`
        ].join('\n');

        // Send final message
        await sendTelegramMessage(message);
        
        return res.status(200).json({
            success: true,
            message: `Stock data for ${uppercaseSymbol} sent to Telegram`,
            data: {
                symbol: uppercaseSymbol,
                currentPrice: quoteData.c,
                percentChange: quoteData.dp,
            },
        });

    } catch (error) {
        console.error('Error:', error);
        
        // Prepare detailed error message
        let errorDetails = `Error processing ${uppercaseSymbol || 'unknown symbol'}: `;
        
        if (error.response) {
            errorDetails += `API responded with ${error.response.status}: ${error.response.data?.message || 'No error details'}`;
        } else if (error.request) {
            errorDetails += 'No response received from API';
        } else {
            errorDetails += error.message;
        }

        // Send error to Telegram
        await sendTelegramMessage(errorDetails, true);

        // Return appropriate response
        const statusCode = error.response?.status || 500;
        return res.status(statusCode).json({
            success: false,
            message: 'Failed to process stock data',
            error: process.env.NODE_ENV === 'development' ? errorDetails : undefined,
        });
    }
}
