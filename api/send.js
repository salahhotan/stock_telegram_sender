// /api/send.js
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables from .env file if present (mainly for local development)
// In Vercel, these should be set in the project settings.
dotenv.config();

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
    // Allow CORS for all origins (you might want to restrict this in production)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!FINNHUB_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('Missing required environment variables.');
        return res.status(500).json({
            success: false,
            message: 'Server configuration error: Missing API keys or chat ID.',
        });
    }

    const { symbol } = req.query;

    if (!symbol) {
        return res.status(400).json({
            success: false,
            message: 'Stock symbol is required. Please provide it as a query parameter (e.g., ?symbol=AAPL).',
        });
    }

    const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol.toUpperCase()}&token=${FINNHUB_API_KEY}`;
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        // 1. Fetch stock data from Finnhub
        console.log(`Fetching data for symbol: ${symbol.toUpperCase()} from Finnhub...`);
        const finnhubResponse = await axios.get(finnhubUrl);
        const quoteData = finnhubResponse.data;

        // Validate Finnhub response
        if (!quoteData || typeof quoteData.c === 'undefined' || quoteData.c === null || quoteData.c === 0) {
            // c=0 can sometimes mean no data or market closed for a while for that symbol
            console.warn(`No valid quote data received from Finnhub for ${symbol.toUpperCase()}:`, quoteData);
            const errorMessage = `Could not retrieve valid quote data for symbol: ${symbol.toUpperCase()}. It might be an invalid symbol or no current data available.`;
            
            // Try to send this warning to Telegram as well
            try {
                await axios.post(telegramUrl, {
                    chat_id: TELEGRAM_CHAT_ID,
                    text: `⚠️ Warning: ${errorMessage}`,
                    parse_mode: 'Markdown',
                });
            } catch (tgError) {
                console.error('Failed to send warning to Telegram:', tgError.message);
            }
            
            return res.status(404).json({
                success: false,
                message: errorMessage,
                finnhub_response: quoteData // Include Finnhub response for debugging
            });
        }

        const {
            c,  // Current price
            h,  // High price of the day
            l,  // Low price of the day
            o,  // Open price of the day
            pc, // Previous close price
            t,  // Timestamp (Unix seconds)
            dp  // Percent change
        } = quoteData;

        // 2. Format the message for Telegram
        const currentPrice = c.toFixed(2);
        const highPrice = h.toFixed(2);
        const lowPrice = l.toFixed(2);
        const openPrice = o.toFixed(2);
        const prevClosePrice = pc.toFixed(2);
        const percentChange = dp.toFixed(2); // Use Finnhub's percent change

        const changeValue = (c - pc).toFixed(2);
        const changeDirectionEmoji = dp >= 0 ? '💹 Up' : '🔻 Down';
        const changeSign = dp >= 0 ? '+' : '';

        // Convert Unix timestamp (seconds) to a readable date string
        // Adjust timezone as needed, e.g., 'America/New_York'
        const readableTimestamp = new Date(t * 1000).toLocaleString('en-US', {
            timeZone: 'UTC', // Finnhub timestamps are typically UTC
            hour12: true,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        });

        let message = `*📊 Stock Update: ${symbol.toUpperCase()}*\n\n`;
        message += `Current Price: *$${currentPrice}*\n`;
        message += `Change: ${changeDirectionEmoji} *$${changeValue}* (${changeSign}${percentChange}%)\n\n`;
        message += `Open: $${openPrice}\n`;
        message += `High: $${highPrice}\n`;
        message += `Low: $${lowPrice}\n`;
        message += `Previous Close: $${prevClosePrice}\n\n`;
        message += `_Last updated (UTC): ${readableTimestamp}_`;

        // 3. Send the message to Telegram
        console.log(`Sending message to Telegram for chat ID: ${TELEGRAM_CHAT_ID}`);
        await axios.post(telegramUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown', // Use Markdown for formatting
        });

        console.log(`Successfully sent stock data for ${symbol.toUpperCase()} to Telegram.`);
        return res.status(200).json({
            success: true,
            message: `Stock data for ${symbol.toUpperCase()} sent to Telegram successfully.`,
            data: {
                symbol: symbol.toUpperCase(),
                currentPrice: c,
                percentChange: dp,
                timestamp: t,
            },
        });

    } catch (error) {
        console.error('Error in handler function:', error);
        let errorMessage = 'An unexpected error occurred.';
        let statusCode = 500;

        if (error.response) {
            // Error from an external API (Finnhub or Telegram)
            console.error('API Error Status:', error.response.status);
            console.error('API Error Data:', error.response.data);
            errorMessage = `API request failed: ${error.response.data.message || error.message} (Status: ${error.response.status})`;
            if (error.response.status === 401 || error.response.status === 403) {
                errorMessage += " Check your API keys.";
            } else if (error.response.status === 429) {
                errorMessage += " Rate limit possibly exceeded.";
            }
            statusCode = error.response.status || 500;
        } else if (error.request) {
            // The request was made but no response was received
            console.error('No response received:', error.request);
            errorMessage = 'No response received from external API. Check network or API status.';
            statusCode = 504; // Gateway Timeout
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error setting up request:', error.message);
            errorMessage = `Error: ${error.message}`;
        }

        return res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error_details: error.message // Keep original error message for context
        });
    }
}
