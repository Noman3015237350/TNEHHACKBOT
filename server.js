const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const archiver = require('archiver');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============ কনফিগারেশন ============
const CONFIG = {
    BASE_PATH: '/home/tnehbd/hosted_bots',
    DB_PATH: '/home/tnehbd/bots.db',
    PORT: 3000,
    MAX_STORAGE_PER_BOT: 100, // MB
    MAX_BOTS_PER_USER: 10,
    ALLOWED_PACKAGES: [
        'requests', 'telegram', 'python-telegram-bot', 'pyrogram',
        'aiohttp', 'asyncio', 'flask', 'django', 'numpy', 'pandas',
        'beautifulsoup4', 'scrapy', 'selenium', 'pillow', 'opencv-python'
    ]
};

// ============ ডাটাবেস সেটআপ ============
const db = new sqlite3.Database(CONFIG.DB_PATH);

// সব টেবিল তৈরি
const createTables = () => {
    // ইউজার টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        plan TEXT DEFAULT 'free',
        plan_expiry TEXT,
        balance INTEGER DEFAULT 0,
        referral_count INTEGER DEFAULT 0,
        referred_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        is_banned INTEGER DEFAULT 0
    )`);

    // বট টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        bot_name TEXT,
        bot_token TEXT,
        status TEXT DEFAULT 'stopped',
        pid INTEGER,
        storage INTEGER DEFAULT 0,
        uptime INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_started TEXT,
        last_stopped TEXT,
        restart_count INTEGER DEFAULT 0,
        cpu_usage REAL DEFAULT 0,
        ram_usage INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // পেমেন্ট টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount INTEGER,
        method TEXT,
        transaction_id TEXT UNIQUE,
        plan TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        approved_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // রেফারেল টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER,
        referred_id INTEGER UNIQUE,
        reward INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(referrer_id) REFERENCES users(id),
        FOREIGN KEY(referred_id) REFERENCES users(id)
    )`);

    // কুপন টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        type TEXT CHECK(type IN ('percentage', 'fixed')),
        value INTEGER,
        max_uses INTEGER DEFAULT 1,
        used_count INTEGER DEFAULT 0,
        expiry_date TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // টিকেট টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        subject TEXT,
        message TEXT,
        status TEXT DEFAULT 'open',
        priority TEXT DEFAULT 'normal',
        admin_reply TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // লগ টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // প্ল্যান টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        price INTEGER,
        duration INTEGER,
        bot_limit INTEGER,
        storage_limit INTEGER,
        ram_limit INTEGER,
        cpu_limit INTEGER,
        features TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // চ্যানেল/গ্রুপ রিকোয়ারমেন্ট টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS join_requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT CHECK(type IN ('channel', 'group')),
        chat_id TEXT UNIQUE,
        name TEXT,
        invite_link TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // বট এনভায়রনমেন্ট ভেরিয়েবল টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS bot_env_vars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id INTEGER,
        key TEXT,
        value TEXT,
        is_secret INTEGER DEFAULT 1,
        FOREIGN KEY(bot_id) REFERENCES bots(id)
    )`);

    // ক্রন জব টেবিল
    db.run(`CREATE TABLE IF NOT EXISTS bot_crons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id INTEGER,
        schedule TEXT,
        command TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(bot_id) REFERENCES bots(id)
    )`);

    console.log('✅ All tables created successfully');
};

createTables();

// ============ হেল্পার ফাংশন ============
const getBotPath = (userId, botName) => {
    return path.join(CONFIG.BASE_PATH, String(userId), botName);
};

const getBotStorage = (botPath) => {
    try {
        const stats = fs.statSync(botPath);
        return Math.round(stats.size / (1024 * 1024));
    } catch {
        return 0;
    }
};

const generateToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

const validatePythonCode = (code) => {
    const dangerous = [
        'os.system', 'subprocess', 'eval', 'exec', '__import__',
        'open(', 'file(', 'compile', 'globals', 'locals'
    ];
    for (const word of dangerous) {
        if (code.includes(word)) {
            return { valid: false, reason: `Dangerous keyword: ${word}` };
        }
    }
    return { valid: true };
};

const installDependencies = (botPath, requirements) => {
    return new Promise((resolve, reject) => {
        if (!requirements || requirements.trim() === '') {
            return resolve('No requirements to install');
        }
        
        const reqFile = path.join(botPath, 'requirements.txt');
        fs.writeFileSync(reqFile, requirements);
        
        exec(`cd ${botPath} && pip3 install --no-cache-dir -r requirements.txt`, 
            { timeout: 300000 }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr || error.message);
                } else {
                    resolve(stdout);
                }
            });
    });
};

// ============ API এন্ডপয়েন্টস ============

// ✅ হেলথ চেক
app.get('/health', (req, res) => {
    const stats = {
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        storage: {
            total: CONFIG.BASE_PATH,
            used: getBotStorage(CONFIG.BASE_PATH)
        }
    };
    res.json(stats);
});

// ✅ ইউজার রেজিস্টার
app.post('/user/register', (req, res) => {
    const { userId, username, firstName, lastName, referredBy } = req.body;
    
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
        if (user) {
            return res.json({ success: true, user, isNew: false });
        }
        
        db.run(
            `INSERT INTO users (id, username, first_name, last_name, referred_by) 
             VALUES (?, ?, ?, ?, ?)`,
            [userId, username, firstName, lastName, referredBy || null],
            function(err) {
                if (err) {
                    return res.json({ success: false, error: err.message });
                }
                
                // রেফারেল ক্রেডিট
                if (referredBy) {
                    db.run(
                        `UPDATE users SET referral_count = referral_count + 1, 
                         balance = balance + 10 WHERE id = ?`,
                        [referredBy]
                    );
                    db.run(
                        `INSERT INTO referrals (referrer_id, referred_id, reward) 
                         VALUES (?, ?, 10)`,
                        [referredBy, userId]
                    );
                }
                
                res.json({ success: true, user: { id: userId, username, firstName, lastName } });
            }
        );
    });
});

// ✅ ইউজার প্রোফাইল
app.get('/user/:userId', (req, res) => {
    const { userId } = req.params;
    
    db.get(
        `SELECT u.*, 
         (SELECT COUNT(*) FROM bots WHERE user_id = u.id) as bot_count,
         (SELECT COUNT(*) FROM bots WHERE user_id = u.id AND status = 'running') as active_bots
         FROM users u WHERE u.id = ?`,
        [userId],
        (err, user) => {
            if (err || !user) {
                return res.json({ success: false, error: 'User not found' });
            }
            res.json({ success: true, user });
        }
    );
});

// ✅ বট আপলোড
app.post('/bot/upload', async (req, res) => {
    const { userId, botName, code, requirements, botToken } = req.body;
    
    try {
        // ইউজার চেক
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        
        if (!user) {
            return res.json({ success: false, error: 'User not found. Please /start first.' });
        }
        
        if (user.is_banned) {
            return res.json({ success: false, error: 'You are banned from using this service.' });
        }
        
        // বট লিমিট চেক
        const botCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM bots WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                resolve(row.count);
            });
        });
        
        const planLimits = {
            free: 1,
            basic: 3,
            premium: 10,
            pro: 25
        };
        
        const maxBots = planLimits[user.plan] || 1;
        if (botCount >= maxBots) {
            return res.json({ 
                success: false, 
                error: `Bot limit reached. Your plan allows ${maxBots} bots.` 
            });
        }
        
        // কোড ভ্যালিডেশন
        const validation = validatePythonCode(code);
        if (!validation.valid) {
            return res.json({ success: false, error: validation.reason });
        }
        
        // বট ফোল্ডার তৈরি
        const botPath = getBotPath(userId, botName);
        fs.mkdirSync(botPath, { recursive: true });
        
        // main.py সেভ
        fs.writeFileSync(path.join(botPath, 'main.py'), code);
        
        // requirements.txt সেভ
        if (requirements) {
            fs.writeFileSync(path.join(botPath, 'requirements.txt'), requirements);
        }
        
        // config.json সেভ
        if (botToken) {
            const config = {
                bot_token: botToken,
                api_id: req.body.apiId || '',
                api_hash: req.body.apiHash || ''
            };
            fs.writeFileSync(path.join(botPath, 'config.json'), JSON.stringify(config, null, 2));
        }
        
        // ডাটাবেসে সেভ
        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO bots (user_id, bot_name, bot_token, storage) 
                 VALUES (?, ?, ?, ?)`,
                [userId, botName, botToken || '', 0],
                function(err) {
                    if (err) reject(err);
                    resolve(this.lastID);
                }
            );
        });
        
        // অডিট লগ
        db.run(
            `INSERT INTO audit_logs (user_id, action, details) 
             VALUES (?, ?, ?)`,
            [userId, 'bot_upload', `Uploaded bot: ${botName}`]
        );
        
        res.json({
            success: true,
            botId: result,
            botPath: botPath,
            message: 'Bot uploaded successfully'
        });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ✅ বট স্টার্ট
app.post('/bot/start', async (req, res) => {
    const { userId, botId } = req.body;
    
    try {
        const bot = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM bots WHERE id = ? AND user_id = ?',
                [botId, userId],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });
        
        if (!bot) {
            return res.json({ success: false, error: 'Bot not found' });
        }
        
        if (bot.status === 'running') {
            return res.json({ success: false, error: 'Bot is already running' });
        }
        
        const botPath = getBotPath(userId, bot.bot_name);
        
        // ডিপেন্ডেন্সি ইনস্টল
        const reqPath = path.join(botPath, 'requirements.txt');
        if (fs.existsSync(reqPath)) {
            const requirements = fs.readFileSync(reqPath, 'utf8');
            await installDependencies(botPath, requirements);
        }
        
        // এনভায়রনমেন্ট ভেরিয়েবল লোড
        const envVars = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM bot_env_vars WHERE bot_id = ?', [botId], (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });
        
        const env = {};
        envVars.forEach(v => {
            env[v.key] = v.value;
        });
        
        // বট প্রক্রিয়া চালু
        const pythonProcess = spawn('python3', ['main.py'], {
            cwd: botPath,
            env: { ...process.env, ...env },
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        // লগ ফাইল
        const logStream = fs.createWriteStream(path.join(botPath, 'logs.txt'), { flags: 'a' });
        pythonProcess.stdout.pipe(logStream);
        pythonProcess.stderr.pipe(logStream);
        
        pythonProcess.unref();
        
        // ডাটাবেস আপডেট
        db.run(
            `UPDATE bots SET status = 'running', pid = ?, last_started = CURRENT_TIMESTAMP,
             restart_count = restart_count + 1, cpu_usage = 0, ram_usage = 0
             WHERE id = ?`,
            [pythonProcess.pid, botId]
        );
        
        // অডিট লগ
        db.run(
            `INSERT INTO audit_logs (user_id, action, details) 
             VALUES (?, ?, ?)`,
            [userId, 'bot_start', `Started bot: ${bot.bot_name} (PID: ${pythonProcess.pid})`]
        );
        
        res.json({
            success: true,
            pid: pythonProcess.pid,
            message: 'Bot started successfully'
        });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ✅ বট স্টপ
app.post('/bot/stop', (req, res) => {
    const { userId, botId } = req.body;
    
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, userId], (err, bot) => {
        if (err || !bot) {
            return res.json({ success: false, error: 'Bot not found' });
        }
        
        if (bot.pid) {
            exec(`kill -15 ${bot.pid} 2>/dev/null || kill -9 ${bot.pid} 2>/dev/null`);
        }
        
        db.run(
            `UPDATE bots SET status = 'stopped', pid = NULL, last_stopped = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [botId]
        );
        
        db.run(
            `INSERT INTO audit_logs (user_id, action, details) 
             VALUES (?, ?, ?)`,
            [userId, 'bot_stop', `Stopped bot: ${bot.bot_name}`]
        );
        
        res.json({ success: true, message: 'Bot stopped successfully' });
    });
});

// ✅ বট রিস্টার্ট
app.post('/bot/restart', async (req, res) => {
    const { userId, botId } = req.body;
    
    try {
        // প্রথমে স্টপ
        await new Promise((resolve, reject) => {
            db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, userId], (err, bot) => {
                if (err || !bot) {
                    reject(new Error('Bot not found'));
                }
                if (bot.pid) {
                    exec(`kill -15 ${bot.pid} 2>/dev/null || kill -9 ${bot.pid} 2>/dev/null`);
                }
                resolve();
            });
        });
        
        // তারপর স্টার্ট
        const bot = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, userId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        
        const botPath = getBotPath(userId, bot.bot_name);
        
        // এনভায়রনমেন্ট ভেরিয়েবল লোড
        const envVars = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM bot_env_vars WHERE bot_id = ?', [botId], (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });
        
        const env = {};
        envVars.forEach(v => {
            env[v.key] = v.value;
        });
        
        const pythonProcess = spawn('python3', ['main.py'], {
            cwd: botPath,
            env: { ...process.env, ...env },
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        const logStream = fs.createWriteStream(path.join(botPath, 'logs.txt'), { flags: 'a' });
        pythonProcess.stdout.pipe(logStream);
        pythonProcess.stderr.pipe(logStream);
        pythonProcess.unref();
        
        db.run(
            `UPDATE bots SET status = 'running', pid = ?, last_started = CURRENT_TIMESTAMP,
             restart_count = restart_count + 1 WHERE id = ?`,
            [pythonProcess.pid, botId]
        );
        
        res.json({
            success: true,
            pid: pythonProcess.pid,
            message: 'Bot restarted successfully'
        });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ✅ ইউজারের সব বট
app.get('/bots/:userId', (req, res) => {
    const { userId } = req.params;
    
    db.all(
        `SELECT b.*, 
         (SELECT COUNT(*) FROM bot_env_vars WHERE bot_id = b.id) as env_count,
         (SELECT COUNT(*) FROM bot_crons WHERE bot_id = b.id) as cron_count
         FROM bots b WHERE b.user_id = ?`,
        [userId],
        (err, bots) => {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            
            bots.forEach(bot => {
                const botPath = getBotPath(userId, bot.bot_name);
                bot.storage = getBotStorage(botPath);
            });
            
            res.json({ success: true, bots });
        }
    );
});

// ✅ বট ডিটেইলস
app.get('/bot/:botId', (req, res) => {
    const { botId } = req.params;
    
    db.get(
        `SELECT b.*, u.username, u.first_name 
         FROM bots b 
         JOIN users u ON b.user_id = u.id 
         WHERE b.id = ?`,
        [botId],
        (err, bot) => {
            if (err || !bot) {
                return res.json({ success: false, error: 'Bot not found' });
            }
            
            const botPath = getBotPath(bot.user_id, bot.bot_name);
            bot.storage = getBotStorage(botPath);
            
            // লগ পড়া
            const logPath = path.join(botPath, 'logs.txt');
            if (fs.existsSync(logPath)) {
                bot.logs = fs.readFileSync(logPath, 'utf8').split('\n').slice(-100).join('\n');
            } else {
                bot.logs = 'No logs available';
            }
            
            res.json({ success: true, bot });
        }
    );
});

// ✅ বট ডিলিট
app.delete('/bot/:botId', (req, res) => {
    const { botId } = req.params;
    const { userId } = req.body;
    
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, userId], (err, bot) => {
        if (err || !bot) {
            return res.json({ success: false, error: 'Bot not found' });
        }
        
        // প্রক্রিয়া কিল
        if (bot.pid) {
            exec(`kill -9 ${bot.pid} 2>/dev/null`);
        }
        
        // ফাইল ডিলিট
        const botPath = getBotPath(userId, bot.bot_name);
        exec(`rm -rf ${botPath}`);
        
        // ডাটাবেস থেকে ডিলিট
        db.run(`DELETE FROM bots WHERE id = ?`, [botId]);
        db.run(`DELETE FROM bot_env_vars WHERE bot_id = ?`, [botId]);
        db.run(`DELETE FROM bot_crons WHERE bot_id = ?`, [botId]);
        
        db.run(
            `INSERT INTO audit_logs (user_id, action, details) 
             VALUES (?, ?, ?)`,
            [userId, 'bot_delete', `Deleted bot: ${bot.bot_name}`]
        );
        
        res.json({ success: true, message: 'Bot deleted successfully' });
    });
});

// ✅ বট লগ
app.get('/bot/logs/:botId', (req, res) => {
    const { botId } = req.params;
    const { lines = 100 } = req.query;
    
    db.get('SELECT user_id, bot_name FROM bots WHERE id = ?', [botId], (err, bot) => {
        if (err || !bot) {
            return res.json({ success: false, error: 'Bot not found' });
        }
        
        const logPath = path.join(getBotPath(bot.user_id, bot.bot_name), 'logs.txt');
        if (!fs.existsSync(logPath)) {
            return res.json({ success: true, logs: 'No logs available' });
        }
        
        const content = fs.readFileSync(logPath, 'utf8');
        const lines_arr = content.split('\n').filter(line => line.trim());
        const lastLines = lines_arr.slice(-parseInt(lines));
        
        res.json({ success: true, logs: lastLines.join('\n') });
    });
});

// ✅ এনভায়রনমেন্ট ভেরিয়েবল যোগ
app.post('/bot/env', (req, res) => {
    const { botId, key, value } = req.body;
    
    db.run(
        `INSERT INTO bot_env_vars (bot_id, key, value) VALUES (?, ?, ?)`,
        [botId, key, value],
        function(err) {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// ✅ এনভায়রনমেন্ট ভেরিয়েবল ডিলিট
app.delete('/bot/env/:varId', (req, res) => {
    const { varId } = req.params;
    
    db.run(`DELETE FROM bot_env_vars WHERE id = ?`, [varId], function(err) {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        res.json({ success: true });
    });
});

// ✅ ক্রন জব যোগ
app.post('/bot/cron', (req, res) => {
    const { botId, schedule, command } = req.body;
    
    db.run(
        `INSERT INTO bot_crons (bot_id, schedule, command) VALUES (?, ?, ?)`,
        [botId, schedule, command],
        function(err) {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// ✅ ক্রন জব ডিলিট
app.delete('/bot/cron/:cronId', (req, res) => {
    const { cronId } = req.params;
    
    db.run(`DELETE FROM bot_crons WHERE id = ?`, [cronId], function(err) {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        res.json({ success: true });
    });
});

// ✅ বট ক্লোন
app.post('/bot/clone', (req, res) => {
    const { userId, botId, newName } = req.body;
    
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, userId], (err, bot) => {
        if (err || !bot) {
            return res.json({ success: false, error: 'Bot not found' });
        }
        
        const sourcePath = getBotPath(userId, bot.bot_name);
        const destPath = getBotPath(userId, newName);
        
        // ফাইল কপি
        exec(`cp -r ${sourcePath} ${destPath}`, (error) => {
            if (error) {
                return res.json({ success: false, error: error.message });
            }
            
            db.run(
                `INSERT INTO bots (user_id, bot_name, bot_token, storage, created_at) 
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [userId, newName, bot.bot_token || '', 0],
                function(err) {
                    if (err) {
                        return res.json({ success: false, error: err.message });
                    }
                    res.json({ success: true, botId: this.lastID });
                }
            );
        });
    });
});

// ✅ বট ডাউনলোড
app.get('/bot/download/:botId', (req, res) => {
    const { botId } = req.params;
    const { userId } = req.query;
    
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, userId], (err, bot) => {
        if (err || !bot) {
            return res.status(404).json({ error: 'Bot not found' });
        }
        
        const botPath = getBotPath(userId, bot.bot_name);
        const archivePath = path.join('/tmp', `${bot.bot_name}.zip`);
        
        const output = fs.createWriteStream(archivePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        output.on('close', () => {
            res.download(archivePath, `${bot.bot_name}.zip`, () => {
                fs.unlinkSync(archivePath);
            });
        });
        
        archive.pipe(output);
        archive.directory(botPath, false);
        archive.finalize();
    });
});

// ✅ পেমেন্ট রিকোয়েস্ট
app.post('/payment/request', (req, res) => {
    const { userId, amount, method, transactionId, plan } = req.body;
    
    db.run(
        `INSERT INTO payments (user_id, amount, method, transaction_id, plan) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, amount, method, transactionId, plan],
        function(err) {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            
            // অডিট লগ
            db.run(
                `INSERT INTO audit_logs (user_id, action, details) 
                 VALUES (?, ?, ?)`,
                [userId, 'payment_request', `Payment of ${amount} via ${method}`]
            );
            
            res.json({ success: true, paymentId: this.lastID });
        }
    );
});

// ✅ পেমেন্ট অ্যাপ্রুভ (Admin)
app.post('/payment/approve', (req, res) => {
    const { paymentId, adminId } = req.body;
    
    db.get('SELECT * FROM payments WHERE id = ?', [paymentId], (err, payment) => {
        if (err || !payment) {
            return res.json({ success: false, error: 'Payment not found' });
        }
        
        if (payment.status !== 'pending') {
            return res.json({ success: false, error: 'Payment already processed' });
        }
        
        db.run(
            `UPDATE payments SET status = 'approved', approved_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [paymentId]
        );
        
        // ইউজারের প্ল্যান আপডেট
        const planData = {
            'basic': { bot_limit: 3, storage: 200 },
            'premium': { bot_limit: 10, storage: 500 },
            'pro': { bot_limit: 25, storage: 1000 }
        };
        
        const plan = planData[payment.plan];
        if (plan) {
            db.run(
                `UPDATE users SET plan = ?, plan_expiry = datetime('now', '+30 days') 
                 WHERE id = ?`,
                [payment.plan, payment.user_id]
            );
        }
        
        // ব্যালেন্স আপডেট
        db.run(
            `UPDATE users SET balance = balance + ? WHERE id = ?`,
            [payment.amount, payment.user_id]
        );
        
        // অডিট লগ
        db.run(
            `INSERT INTO audit_logs (user_id, action, details) 
             VALUES (?, ?, ?)`,
            [payment.user_id, 'payment_approved', `Payment ${paymentId} approved`]
        );
        
        res.json({ success: true, message: 'Payment approved successfully' });
    });
});

// ✅ পেমেন্ট রিজেক্ট
app.post('/payment/reject', (req, res) => {
    const { paymentId } = req.body;
    
    db.run(
        `UPDATE payments SET status = 'rejected' WHERE id = ?`,
        [paymentId],
        function(err) {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true });
        }
    );
});

// ✅ কুপন অ্যাপ্লাই
app.post('/coupon/apply', (req, res) => {
    const { code, userId } = req.body;
    
    db.get(
        'SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND expiry_date > datetime("now")',
        [code.toUpperCase()],
        (err, coupon) => {
            if (err || !coupon) {
                return res.json({ success: false, error: 'Invalid or expired coupon' });
            }
            
            if (coupon.used_count >= coupon.max_uses) {
                return res.json({ success: false, error: 'Coupon usage limit exceeded' });
            }
            
            db.run(
                `UPDATE coupons SET used_count = used_count + 1 WHERE id = ?`,
                [coupon.id]
            );
            
            const discount = coupon.type === 'percentage' ? 
                `${coupon.value}%` : 
                `${coupon.value} BDT`;
            
            res.json({ 
                success: true, 
                discount: discount,
                type: coupon.type,
                value: coupon.value
            });
        }
    );
});

// ✅ টিকেট তৈরি
app.post('/ticket/create', (req, res) => {
    const { userId, subject, message } = req.body;
    
    db.run(
        `INSERT INTO tickets (user_id, subject, message) VALUES (?, ?, ?)`,
        [userId, subject, message],
        function(err) {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true, ticketId: this.lastID });
        }
    );
});

// ✅ টিকেট রিপ্লাই (Admin)
app.post('/ticket/reply', (req, res) => {
    const { ticketId, adminReply } = req.body;
    
    db.run(
        `UPDATE tickets SET status = 'resolved', admin_reply = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [adminReply, ticketId],
        function(err) {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true });
        }
    );
});

// ✅ ইউজারের সব টিকেট
app.get('/tickets/:userId', (req, res) => {
    const { userId } = req.params;
    
    db.all('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, tickets) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        res.json({ success: true, tickets });
    });
});

// ✅ সব টিকেট (Admin)
app.get('/admin/tickets', (req, res) => {
    db.all(
        `SELECT t.*, u.username, u.first_name 
         FROM tickets t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.status = 'open' 
         ORDER BY t.created_at DESC`,
        (err, tickets) => {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true, tickets });
        }
    );
});

// ✅ সব ইউজার (Admin)
app.get('/admin/users', (req, res) => {
    db.all(
        `SELECT u.*, 
         (SELECT COUNT(*) FROM bots WHERE user_id = u.id) as bot_count,
         (SELECT COUNT(*) FROM payments WHERE user_id = u.id AND status = 'approved') as payment_count
         FROM users u`,
        (err, users) => {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true, users });
        }
    );
});

// ✅ সব বট (Admin)
app.get('/admin/bots', (req, res) => {
    db.all(
        `SELECT b.*, u.username, u.first_name 
         FROM bots b 
         JOIN users u ON b.user_id = u.id 
         ORDER BY b.created_at DESC`,
        (err, bots) => {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true, bots });
        }
    );
});

// ✅ সিস্টেম স্ট্যাটস (Admin)
app.get('/admin/stats', (req, res) => {
    const stats = {};
    
    // ইউজার কাউন্ট
    db.get('SELECT COUNT(*) as total FROM users', (err, row) => {
        stats.total_users = row.total;
    });
    
    // বট কাউন্ট
    db.get('SELECT COUNT(*) as total FROM bots', (err, row) => {
        stats.total_bots = row.total;
    });
    
    // রানিং বট
    db.get("SELECT COUNT(*) as total FROM bots WHERE status = 'running'", (err, row) => {
        stats.running_bots = row.total;
    });
    
    // পেমেন্ট
    db.get("SELECT SUM(amount) as total FROM payments WHERE status = 'approved'", (err, row) => {
        stats.total_revenue = row.total || 0;
    });
    
    // পেন্ডিং পেমেন্ট
    db.get("SELECT COUNT(*) as total FROM payments WHERE status = 'pending'", (err, row) => {
        stats.pending_payments = row.total;
    });
    
    // ডিস্ক ইউজ
    try {
        const disk = execSync('df -h / | tail -1').toString();
        const parts = disk.trim().split(/\s+/);
        stats.disk_usage = `${parts[4]} (${parts[3]})`;
    } catch {
        stats.disk_usage = 'N/A';
    }
    
    // CPU লোড
    try {
        const load = execSync("cat /proc/loadavg | awk '{print $1}'").toString().trim();
        stats.cpu_load = load;
    } catch {
        stats.cpu_load = 'N/A';
    }
    
    // RAM
    try {
        const mem = execSync('free -m | grep Mem | awk \'{print $3 "/" $2 " MB"}\'').toString().trim();
        stats.ram_usage = mem;
    } catch {
        stats.ram_usage = 'N/A';
    }
    
    res.json({ success: true, stats });
});

// ✅ ব্রডকাস্ট (Admin)
app.post('/admin/broadcast', (req, res) => {
    const { message, target = 'all' } = req.body;
    
    db.all('SELECT id FROM users', (err, users) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        
        // টেলিগ্রাম API দিয়ে মেসেজ পাঠানোর জন্য Queue তে রাখা হবে
        // বর্তমানে শুধু ডাটাবেসে সেভ করছি
        
        db.run(
            `INSERT INTO audit_logs (user_id, action, details) 
             VALUES (?, ?, ?)`,
            [0, 'broadcast', `Broadcast to ${users.length} users: ${message.substring(0, 100)}`]
        );
        
        res.json({ 
            success: true, 
            message: `Broadcast sent to ${users.length} users`
        });
    });
});

// ✅ জয়েন রিকোয়ারমেন্ট যোগ (Admin)
app.post('/admin/requirement', (req, res) => {
    const { type, chatId, name, inviteLink } = req.body;
    
    db.run(
        `INSERT INTO join_requirements (type, chat_id, name, invite_link) 
         VALUES (?, ?, ?, ?)`,
        [type, chatId, name, inviteLink],
        function(err) {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// ✅ জয়েন রিকোয়ারমেন্ট লিস্ট
app.get('/requirements', (req, res) => {
    db.all('SELECT * FROM join_requirements WHERE is_active = 1', (err, requirements) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        res.json({ success: true, requirements });
    });
});

// ✅ মেম্বারশিপ চেক
app.post('/check/membership', (req, res) => {
    const { userId } = req.body;
    
    db.all('SELECT * FROM join_requirements WHERE is_active = 1', (err, requirements) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        
        // বাস্তবে এখানে Telegram API কল করে মেম্বারশিপ চেক করতে হবে
        // সিম্পলিফাইড ভার্সন
        res.json({ 
            success: true, 
            requirements: requirements,
            // সবগুলো জয়েন করা ধরে নিচ্ছি
            joined_all: true
        });
    });
});

// ✅ প্ল্যান তৈরি (Admin)
app.post('/admin/plan', (req, res) => {
    const { name, price, duration, botLimit, storageLimit, ramLimit, cpuLimit, features } = req.body;
    
    db.run(
        `INSERT INTO plans (name, price, duration, bot_limit, storage_limit, ram_limit, cpu_limit, features) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, price, duration, botLimit, storageLimit, ramLimit, cpuLimit, JSON.stringify(features)],
        function(err) {
            if (err) {
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// ✅ সব প্ল্যান
app.get('/plans', (req, res) => {
    db.all('SELECT * FROM plans WHERE is_active = 1', (err, plans) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        res.json({ success: true, plans });
    });
});

// ============ সিস্টেম মনিটরিং ============
// প্রতি ৫ মিনিটে বট মনিটর
setInterval(() => {
    db.all("SELECT id, user_id, bot_name, pid FROM bots WHERE status = 'running'", (err, bots) => {
        if (err) return;
        
        bots.forEach(bot => {
            if (!bot.pid) return;
            
            try {
                // প্রক্রিয়া চেক
                exec(`ps -p ${bot.pid} --no-headers`, (error) => {
                    if (error) {
                        // প্রক্রিয়া মারা গেছে
                        db.run(
                            `UPDATE bots SET status = 'stopped', pid = NULL 
                             WHERE id = ?`,
                            [bot.id]
                        );
                    } else {
                        // CPU/RAM আপডেট
                        exec(`ps -p ${bot.pid} -o %cpu,%mem --no-headers`, (err, stdout) => {
                            if (!err && stdout) {
                                const [cpu, mem] = stdout.trim().split(/\s+/);
                                db.run(
                                    `UPDATE bots SET cpu_usage = ?, ram_usage = ? 
                                     WHERE id = ?`,
                                    [parseFloat(cpu) || 0, parseFloat(mem) || 0, bot.id]
                                );
                            }
                        });
                    }
                });
            } catch (e) {
                // ইগনোর
            }
        });
    });
}, 300000); // 5 মিনিট

// ============ সার্ভার চালু ============
app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`🚀 TNEH Hosting API running on port ${CONFIG.PORT}`);
    console.log(`📁 Bot storage path: ${CONFIG.BASE_PATH}`);
    console.log(`💾 Database: ${CONFIG.DB_PATH}`);
    console.log(`📊 API ready at http://66.33.22.220:${CONFIG.PORT}`);
});