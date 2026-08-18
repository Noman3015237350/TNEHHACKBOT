const { Telegraf, Markup, Scenes, session } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============ কনফিগারেশন ============
const CONFIG = {
    BOT_TOKEN: process.env.BOT_TOKEN || '8240762466:AAGFwt6bVA9cJDfeOOtS6Eb3Q6lF85kb5w4',
    ADMIN_ID: parseInt(process.env.ADMIN_ID || '8128648817'),
    VPS_API: process.env.VPS_API || 'http://66.33.22.220:3000',
    WEBHOOK_URL: process.env.WEBHOOK_URL || 'https://TNEHHACKBOT.vercel.app',
};

const bot = new Telegraf(CONFIG.BOT_TOKEN);

// ============ ডাটাবেস ইউটিলিটি (সিম্পল) ============
// Vercel-এ SQLite কাজ করবে না, তাই মেমোরি স্টোর ব্যবহার
const userStates = new Map();
const botCache = new Map();

// ============ এনিমে ক্যারেক্টার এমোজি ============
const EMOJIS = {
    menu: '🧝‍♀️',
    bots: '🧙‍♀️',
    upload: '👸',
    plans: '💃',
    profile: '🧚‍♀️',
    support: '🧜‍♀️',
    referral: '🧝‍♂️',
    wallet: '🧙‍♂️',
    admin: '👑',
    running: '🟢',
    stopped: '⏹',
    loading: '⏳',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
};

// ============ মিডলওয়্যার ============
bot.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        console.error('Error:', err);
        await ctx.reply(`${EMOJIS.error} Something went wrong. Please try again later.`);
    }
});

// ============ ইউজার রেজিস্টার ============
const registerUser = async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || '';
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';
    
    try {
        const response = await axios.post(`${CONFIG.VPS_API}/user/register`, {
            userId,
            username,
            firstName,
            lastName,
            referredBy: ctx.startPayload ? parseInt(ctx.startPayload) : null
        });
        return response.data;
    } catch (error) {
        console.error('Register error:', error.message);
        return { success: false };
    }
};

// ============ মেম্বারশিপ চেক ============
const checkMembership = async (userId) => {
    try {
        const response = await axios.post(`${CONFIG.VPS_API}/check/membership`, { userId });
        return response.data;
    } catch {
        return { success: true, joined_all: true, requirements: [] };
    }
};

// ============ কীবোর্ড তৈরি ============
const getMainKeyboard = (isAdmin = false) => {
    const buttons = [
        ['🤖 My Bots', '📤 Upload Bot'],
        ['💎 Plans', '🛒 Buy Plan'],
        ['👥 Referral', '👤 Profile'],
        ['💰 Wallet', '🎫 Tickets'],
        ['❓ Help', '🛰 Support'],
        ['📊 My Stats', '🎟️ Coupon']
    ];
    
    if (isAdmin) {
        buttons.push(['👑 Admin Panel']);
    }
    
    return Markup.keyboard(buttons)
        .resize()
        .oneTime(false);
};

const getBotControlKeyboard = (botId, status) => {
    const buttons = [];
    
    if (status === 'running') {
        buttons.push([Markup.button.callback('⏹ Stop', `stop_${botId}`)]);
        buttons.push([Markup.button.callback('🔄 Restart', `restart_${botId}`)]);
    } else {
        buttons.push([Markup.button.callback('🟢 Start', `start_${botId}`)]);
    }
    
    buttons.push([
        Markup.button.callback('📊 Status', `status_${botId}`),
        Markup.button.callback('📋 Logs', `logs_${botId}`)
    ]);
    buttons.push([
        Markup.button.callback('⚙️ Env Vars', `env_${botId}`),
        Markup.button.callback('📦 Install', `install_${botId}`)
    ]);
    buttons.push([
        Markup.button.callback('🔗 Clone', `clone_${botId}`),
        Markup.button.callback('⬇️ Download', `download_${botId}`)
    ]);
    buttons.push([Markup.button.callback('🗑 Delete', `delete_${botId}`)]);
    buttons.push([Markup.button.callback('🔙 Back', 'back_to_bots')]);
    
    return Markup.inlineKeyboard(buttons);
};

// ============ কমান্ড হ্যান্ডলার ============

// ✅ /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    
    // ইউজার রেজিস্টার
    await registerUser(ctx);
    
    // মেম্বারশিপ চেক
    const membership = await checkMembership(userId);
    
    if (!membership.joined_all && membership.requirements?.length > 0) {
        const buttons = membership.requirements.map(req => {
            const label = req.type === 'channel' ? '📢 Join Channel' : '👥 Join Group';
            return [Markup.button.url(label, req.invite_link || 'https://t.me/')];
        });
        buttons.push([Markup.button.callback('🔄 Verify Membership', 'verify_membership')]);
        
        return ctx.reply(
            `🔐 JOIN REQUIRED\n\nTo use this bot, you must join all required groups/channels first.\n\nAfter joining, click the button below.`,
            Markup.inlineKeyboard(buttons)
        );
    }
    
    // Welcome Message
    const welcomeMsg = `🎉 WELCOME ${ctx.from.first_name}!\n\n` +
        `👤 Username: @${ctx.from.username || 'N/A'}\n` +
        `🆔 User ID: ${userId}\n` +
        `👥 Total Referral: 0\n` +
        `🤖 Total Active Bot: 0\n\n` +
        `🚀 Welcome to TNEH PREMIUM HOSTING BOT!\n` +
        `Choose an option below 👇`;
    
    const isAdmin = userId === CONFIG.ADMIN_ID;
    await ctx.reply(welcomeMsg, getMainKeyboard(isAdmin));
});

// ✅ Verify Membership Callback
bot.action('verify_membership', async (ctx) => {
    await ctx.answerCbQuery();
    const membership = await checkMembership(ctx.from.id);
    
    if (membership.joined_all) {
        await ctx.reply(`${EMOJIS.success} All requirements verified!`);
        const isAdmin = ctx.from.id === CONFIG.ADMIN_ID;
        await ctx.reply('🏠 Main Menu', getMainKeyboard(isAdmin));
    } else {
        await ctx.reply(`${EMOJIS.error} You haven't joined all required channels/groups. Please join and try again.`);
    }
});

// ============ মেইন মেনু হ্যান্ডলার ============

// 🤖 My Bots
bot.hears('🤖 My Bots', async (ctx) => {
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/bots/${ctx.from.id}`);
        const bots = response.data.bots || [];
        
        if (bots.length === 0) {
            return ctx.reply(
                `${EMOJIS.info} You don't have any bots yet.\n\n📤 Upload a bot using the "Upload Bot" button.`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('📤 Upload Bot', 'upload_bot')]
                ])
            );
        }
        
        let msg = '🤖 MY BOTS\n━━━━━━━━━━━━━━━\n\n';
        const buttons = [];
        
        bots.forEach((bot, index) => {
            const status = bot.status === 'running' ? '🟢 Running' : '⏹ Stopped';
            msg += `${index + 1}. ${bot.bot_name}\n`;
            msg += `${status}\n`;
            msg += `🐍 Python\n`;
            msg += `💾 ${bot.storage || 0} MB\n\n`;
            buttons.push([Markup.button.callback(`${index + 1}. ${bot.bot_name}`, `select_bot_${bot.id}`)]);
        });
        
        await ctx.reply(msg, Markup.inlineKeyboard(buttons));
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} Failed to load bots: ${error.message}`);
    }
});

// Select Bot Callback
bot.action(/select_bot_(\d+)/, async (ctx) => {
    const botId = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/bot/${botId}`);
        const bot = response.data.bot;
        
        if (!bot) {
            return ctx.reply(`${EMOJIS.error} Bot not found.`);
        }
        
        const status = bot.status === 'running' ? '🟢 Running' : '⏹ Stopped';
        const uptime = bot.status === 'running' ? `⏱ ${Math.floor((Date.now() - new Date(bot.last_started).getTime()) / 1000 / 60)} mins` : '⏱ Stopped';
        
        const msg = `🤖 ${bot.bot_name}\n━━━━━━━━━━━━━━━\n\n` +
            `📊 Status: ${status}\n` +
            `${uptime}\n` +
            `🐍 Runtime: Python\n` +
            `💾 Storage: ${bot.storage || 0} MB\n` +
            `🧠 RAM: ${bot.ram_usage || 0} MB\n` +
            `⚡ CPU: ${bot.cpu_usage || 0}%\n` +
            `📦 Packages: ${bot.env_count || 0}\n` +
            `🔄 Restarts: ${bot.restart_count || 0}\n` +
            `📅 Created: ${new Date(bot.created_at).toLocaleDateString()}`;
        
        await ctx.editMessageText(msg, getBotControlKeyboard(botId, bot.status));
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ============ বট কন্ট্রোল কলব্যাক ============

// 🟢 Start Bot
bot.action(/start_(\d+)/, async (ctx) => {
    const botId = ctx.match[1];
    await ctx.answerCbQuery('🔄 Starting bot...');
    
    try {
        await ctx.reply(`${EMOJIS.loading} Starting bot...`);
        
        const response = await axios.post(`${CONFIG.VPS_API}/bot/start`, {
            userId: ctx.from.id,
            botId: parseInt(botId)
        });
        
        if (response.data.success) {
            await ctx.reply(`${EMOJIS.success} Bot started successfully! (PID: ${response.data.pid})`);
            // রিফ্রেশ
            const botResponse = await axios.get(`${CONFIG.VPS_API}/bot/${botId}`);
            const bot = botResponse.data.bot;
            await ctx.editMessageText(
                `🤖 ${bot.bot_name}\n🟢 Running\nPID: ${bot.pid}`,
                getBotControlKeyboard(botId, 'running')
            );
        } else {
            await ctx.reply(`${EMOJIS.error} ${response.data.error || 'Failed to start bot'}`);
        }
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ⏹ Stop Bot
bot.action(/stop_(\d+)/, async (ctx) => {
    const botId = ctx.match[1];
    await ctx.answerCbQuery('🔄 Stopping bot...');
    
    try {
        const response = await axios.post(`${CONFIG.VPS_API}/bot/stop`, {
            userId: ctx.from.id,
            botId: parseInt(botId)
        });
        
        if (response.data.success) {
            await ctx.reply(`${EMOJIS.success} Bot stopped successfully.`);
            const botResponse = await axios.get(`${CONFIG.VPS_API}/bot/${botId}`);
            const bot = botResponse.data.bot;
            await ctx.editMessageText(
                `🤖 ${bot.bot_name}\n⏹ Stopped`,
                getBotControlKeyboard(botId, 'stopped')
            );
        } else {
            await ctx.reply(`${EMOJIS.error} ${response.data.error}`);
        }
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 🔄 Restart Bot
bot.action(/restart_(\d+)/, async (ctx) => {
    const botId = ctx.match[1];
    await ctx.answerCbQuery('🔄 Restarting bot...');
    
    try {
        await ctx.reply(`${EMOJIS.loading} Restarting bot...`);
        
        const response = await axios.post(`${CONFIG.VPS_API}/bot/restart`, {
            userId: ctx.from.id,
            botId: parseInt(botId)
        });
        
        if (response.data.success) {
            await ctx.reply(`${EMOJIS.success} Bot restarted successfully! (PID: ${response.data.pid})`);
        } else {
            await ctx.reply(`${EMOJIS.error} ${response.data.error}`);
        }
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 📊 Status
bot.action(/status_(\d+)/, async (ctx) => {
    const botId = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/bot/${botId}`);
        const bot = response.data.bot;
        
        const msg = `📊 BOT STATUS\n━━━━━━━━━━━━━━━\n\n` +
            `🤖 ${bot.bot_name}\n` +
            `🆔 ID: ${bot.id}\n` +
            `👤 Owner: @${bot.username || 'N/A'}\n` +
            `📊 Status: ${bot.status === 'running' ? '🟢 Running' : '⏹ Stopped'}\n` +
            `💾 Storage: ${bot.storage || 0} MB\n` +
            `🧠 RAM: ${bot.ram_usage || 0} MB\n` +
            `⚡ CPU: ${bot.cpu_usage || 0}%\n` +
            `📦 Packages: ${bot.env_count || 0}\n` +
            `🔄 Restarts: ${bot.restart_count || 0}\n` +
            `📅 Created: ${new Date(bot.created_at).toLocaleString()}`;
        
        await ctx.reply(msg);
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 📋 Logs
bot.action(/logs_(\d+)/, async (ctx) => {
    const botId = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/bot/logs/${botId}?lines=50`);
        const logs = response.data.logs || 'No logs available';
        
        const logMsg = `📋 BOT LOGS\n━━━━━━━━━━━━━━━\n\n\`\`\`\n${logs.substring(0, 3500)}\n\`\`\``;
        
        await ctx.replyWithMarkdown(logMsg, {
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔄 Refresh', `logs_${botId}`)],
                    [Markup.button.callback('🔙 Back', `select_bot_${botId}`)]
                ]
            }
        });
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 🗑 Delete Bot
bot.action(/delete_(\d+)/, async (ctx) => {
    const botId = ctx.match[1];
    await ctx.answerCbQuery();
    
    await ctx.reply(
        `${EMOJIS.warning} DELETE BOT\n\nAre you sure you want to delete this bot?\nThis action cannot be undone!`,
        Markup.inlineKeyboard([
            [Markup.button.callback('❌ Delete Permanently', `confirm_delete_${botId}`)],
            [Markup.button.callback('↩️ Cancel', `select_bot_${botId}`)]
        ])
    );
});

bot.action(/confirm_delete_(\d+)/, async (ctx) => {
    const botId = ctx.match[1];
    await ctx.answerCbQuery('🗑 Deleting bot...');
    
    try {
        const response = await axios.delete(`${CONFIG.VPS_API}/bot/${botId}`, {
            data: { userId: ctx.from.id }
        });
        
        if (response.data.success) {
            await ctx.reply(`${EMOJIS.success} Bot deleted successfully.`);
            // My Bots-এ ফিরে যান
            ctx.hears('🤖 My Bots');
        } else {
            await ctx.reply(`${EMOJIS.error} ${response.data.error}`);
        }
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 🔙 Back
bot.action('back_to_bots', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.hears('🤖 My Bots');
});

// ============ 📤 Upload Bot ============
bot.hears('📤 Upload Bot', async (ctx) => {
    // ইউজার প্ল্যান চেক
    try {
        const userResponse = await axios.get(`${CONFIG.VPS_API}/user/${ctx.from.id}`);
        const user = userResponse.data.user;
        
        const planLimits = {
            free: 1,
            basic: 3,
            premium: 10,
            pro: 25
        };
        
        const maxBots = planLimits[user?.plan || 'free'] || 1;
        const botCount = user?.bot_count || 0;
        
        if (botCount >= maxBots) {
            return ctx.reply(
                `${EMOJIS.error} Bot limit reached!\n\n` +
                `📊 Your Plan: ${user?.plan || 'free'}\n` +
                `🤖 Bots: ${botCount}/${maxBots}\n\n` +
                `💎 Upgrade your plan to host more bots.`
            );
        }
        
        await ctx.reply(
            `📤 UPLOAD BOT\n━━━━━━━━━━━━━━━\n\n` +
            `📊 Current Plan: ${user?.plan || 'free'}\n` +
            `🤖 Bots: ${botCount}/${maxBots}\n` +
            `💾 Storage: ${user?.storage || 0} MB\n\n` +
            `Please send your Python bot file (.py)\n` +
            `📦 requirements.txt supported\n` +
            `⚙️ Automatic setup & hosting`,
            Markup.inlineKeyboard([
                [Markup.button.callback('📤 Send File', 'upload_file')],
                [Markup.button.callback('🔙 Back', 'back_to_menu')]
            ])
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

bot.action('upload_file', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`📤 Please send your Python file (.py)`);
});

// ফাইল হ্যান্ডলার
bot.on('document', async (ctx) => {
    const document = ctx.message.document;
    const fileName = document.file_name || '';
    
    if (!fileName.endsWith('.py')) {
        return ctx.reply(`${EMOJIS.error} Only .py files are supported.`);
    }
    
    // ফাইল সাইজ চেক (max 10MB)
    if (document.file_size > 10 * 1024 * 1024) {
        return ctx.reply(`${EMOJIS.error} File size too large. Maximum 10MB allowed.`);
    }
    
    await ctx.reply(`${EMOJIS.loading} Processing your file...`);
    
    try {
        // ফাইল ডাউনলোড
        const fileLink = await ctx.telegram.getFileLink(document.file_id);
        const response = await fetch(fileLink);
        const code = await response.text();
        
        // বট নাম (ফাইল নাম থেকে)
        const botName = fileName.replace('.py', '').replace(/[^a-zA-Z0-9_]/g, '_');
        
        // আপলোড API কল
        const uploadResponse = await axios.post(`${CONFIG.VPS_API}/bot/upload`, {
            userId: ctx.from.id,
            botName: botName,
            code: code,
            requirements: '', // পরে আপডেট করা যাবে
            botToken: '' // ইউজার পরে দিতে পারে
        });
        
        if (uploadResponse.data.success) {
            const botId = uploadResponse.data.botId;
            
            await ctx.reply(
                `${EMOJIS.success} BOT UPLOADED SUCCESSFULLY!\n\n` +
                `🤖 Name: ${botName}\n` +
                `🆔 Bot ID: ${botId}\n` +
                `📁 File: ${fileName}\n` +
                `💾 Size: ${Math.round(document.file_size / 1024)} KB\n\n` +
                `🟢 The bot is ready to start!\n` +
                `Use "🤖 My Bots" to manage it.`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('🚀 Start Bot', `start_${botId}`)],
                    [Markup.button.callback('📋 View Bots', 'view_bots')]
                ])
            );
            
            // Admin Notification
            await ctx.telegram.sendMessage(
                CONFIG.ADMIN_ID,
                `📥 NEW BOT UPLOADED\n\n` +
                `👤 User: @${ctx.from.username || 'N/A'} (${ctx.from.id})\n` +
                `📁 File: ${fileName}\n` +
                `🤖 Bot: ${botName}\n` +
                `🆔 Bot ID: ${botId}\n` +
                `📅 Time: ${new Date().toLocaleString()}`
            );
        } else {
            await ctx.reply(`${EMOJIS.error} ${uploadResponse.data.error || 'Upload failed'}`);
        }
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

bot.action('view_bots', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.hears('🤖 My Bots');
});

bot.action('back_to_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const isAdmin = ctx.from.id === CONFIG.ADMIN_ID;
    await ctx.reply('🏠 Main Menu', getMainKeyboard(isAdmin));
});

// ============ 💎 Plans ============
bot.hears('💎 Plans', async (ctx) => {
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/plans`);
        const plans = response.data.plans || [];
        
        let msg = '💎 HOSTING PLANS\n━━━━━━━━━━━━━━━\n\n';
        const buttons = [];
        
        plans.forEach(plan => {
            msg += `📍 ${plan.name.toUpperCase()}\n`;
            msg += `💰 Price: ৳${plan.price}\n`;
            msg += `🤖 Bots: ${plan.bot_limit}\n`;
            msg += `💾 Storage: ${plan.storage_limit} MB\n`;
            msg += `🧠 RAM: ${plan.ram_limit || 'N/A'} MB\n`;
            msg += `⚡ CPU: ${plan.cpu_limit || 'N/A'}%\n`;
            msg += `⏱ Duration: ${plan.duration} days\n\n`;
            buttons.push([Markup.button.callback(`🛒 Buy ${plan.name}`, `buy_${plan.id}`)]);
        });
        
        await ctx.reply(msg, Markup.inlineKeyboard(buttons));
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ============ 🛒 Buy Plan ============
bot.hears('🛒 Buy Plan', async (ctx) => {
    ctx.hears('💎 Plans');
});

bot.action(/buy_(\d+)/, async (ctx) => {
    const planId = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/plans`);
        const plans = response.data.plans || [];
        const plan = plans.find(p => p.id == planId);
        
        if (!plan) {
            return ctx.reply(`${EMOJIS.error} Plan not found.`);
        }
        
        const paymentMethods = [
            [Markup.button.callback('📱 bKash', `pay_bkash_${planId}`)],
            [Markup.button.callback('📱 Nagad', `pay_nagad_${planId}`)]
        ];
        
        await ctx.reply(
            `🛒 BUY ${plan.name.toUpperCase()} PLAN\n━━━━━━━━━━━━━━━\n\n` +
            `💰 Price: ৳${plan.price}\n` +
            `🤖 Bot Limit: ${plan.bot_limit}\n` +
            `💾 Storage: ${plan.storage_limit} MB\n` +
            `🧠 RAM: ${plan.ram_limit || 'N/A'} MB\n` +
            `⏱ Duration: ${plan.duration} days\n\n` +
            `Select payment method:`,
            Markup.inlineKeyboard(paymentMethods)
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ============ 💳 Payment ============
bot.action(/pay_(bkash|nagad)_(\d+)/, async (ctx) => {
    const method = ctx.match[1];
    const planId = ctx.match[2];
    await ctx.answerCbQuery();
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/plans`);
        const plans = response.data.plans || [];
        const plan = plans.find(p => p.id == planId);
        
        if (!plan) {
            return ctx.reply(`${EMOJIS.error} Plan not found.`);
        }
        
        const number = method === 'bkash' ? '01869325626' : '01869325626';
        
        await ctx.reply(
            `📱 ${method.toUpperCase()} PAYMENT\n━━━━━━━━━━━━━━━\n\n` +
            `💰 Amount: ৳${plan.price}\n` +
            `📞 Number: ${number}\n` +
            `💎 Plan: ${plan.name}\n\n` +
            `Please send the exact amount to the number above.\n\n` +
            `After payment, send your transaction ID:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🧾 Submit Transaction ID', `submit_txid_${planId}_${method}`)],
                [Markup.button.callback('🔙 Back', 'back_to_plans')]
            ])
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

bot.action(/submit_txid_(\d+)_(\w+)/, async (ctx) => {
    const planId = ctx.match[1];
    const method = ctx.match[2];
    await ctx.answerCbQuery();
    
    // ইউজারকে ট্রানজেকশন আইডি পাঠাতে বলুন
    ctx.reply(
        `🧾 SEND TRANSACTION ID\n\n` +
        `Please send your transaction ID.\n` +
        `Example: ABC123XYZ\n\n` +
        `📍 Plan: ${await getPlanName(planId)}\n` +
        `📱 Method: ${method.toUpperCase()}`
    );
    
    // স্টেট সেভ করুন
    userStates.set(ctx.from.id, { action: 'payment_txid', planId, method });
});

// ট্রানজেকশন আইডি হ্যান্ডলার
bot.on('text', async (ctx) => {
    const state = userStates.get(ctx.from.id);
    if (!state) return;
    
    if (state.action === 'payment_txid') {
        const txId = ctx.message.text.trim();
        const { planId, method } = state;
        
        try {
            // প্ল্যানের তথ্য
            const response = await axios.get(`${CONFIG.VPS_API}/plans`);
            const plans = response.data.plans || [];
            const plan = plans.find(p => p.id == planId);
            
            if (!plan) {
                return ctx.reply(`${EMOJIS.error} Plan not found.`);
            }
            
            // পেমেন্ট রিকোয়েস্ট
            await axios.post(`${CONFIG.VPS_API}/payment/request`, {
                userId: ctx.from.id,
                amount: plan.price,
                method: method,
                transactionId: txId,
                plan: plan.name
            });
            
            await ctx.reply(
                `${EMOJIS.info} PAYMENT SUBMITTED\n\n` +
                `💳 Method: ${method.toUpperCase()}\n` +
                `💰 Amount: ৳${plan.price}\n` +
                `🧾 Transaction ID: ${txId}\n` +
                `📊 Status: 🟡 Pending\n\n` +
                `Please wait for admin verification.\n` +
                `You will be notified when approved.`
            );
            
            // Admin Notification
            await ctx.telegram.sendMessage(
                CONFIG.ADMIN_ID,
                `💳 NEW PAYMENT\n\n` +
                `👤 User: @${ctx.from.username || 'N/A'} (${ctx.from.id})\n` +
                `💎 Plan: ${plan.name}\n` +
                `💰 Amount: ৳${plan.price}\n` +
                `📱 Method: ${method.toUpperCase()}\n` +
                `🧾 TxID: ${txId}\n` +
                `📅 Time: ${new Date().toLocaleString()}`
            );
            
            userStates.delete(ctx.from.id);
        } catch (error) {
            await ctx.reply(`${EMOJIS.error} ${error.message}`);
        }
    }
});

// ============ 👥 Referral ============
bot.hears('👥 Referral', async (ctx) => {
    const referLink = `https://t.me/TNEH_Hosting_Bot?start=${ctx.from.id}`;
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/user/${ctx.from.id}`);
        const user = response.data.user;
        
        await ctx.reply(
            `👥 REFERRAL\n━━━━━━━━━━━━━━━\n\n` +
            `🔗 Your Referral Link:\n` +
            `${referLink}\n\n` +
            `👤 Referrals: ${user?.referral_count || 0}\n` +
            `💰 Earned: ৳${(user?.referral_count || 0) * 10}\n\n` +
            `Invite friends and earn ৳10 per referral!`,
            Markup.inlineKeyboard([
                [Markup.button.callback('📤 Share Link', `share_${ctx.from.id}`)],
                [Markup.button.callback('👥 My Referrals', 'my_referrals')]
            ])
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

bot.action(/share_(\d+)/, async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery();
    const link = `https://t.me/TNEH_Hosting_Bot?start=${userId}`;
    await ctx.reply(`🔗 ${link}`);
});

// ============ 👤 Profile ============
bot.hears('👤 Profile', async (ctx) => {
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/user/${ctx.from.id}`);
        const user = response.data.user;
        
        if (!user) {
            return ctx.reply(`${EMOJIS.error} Profile not found. Please /start first.`);
        }
        
        const planEmoji = {
            free: '🆓',
            basic: '🥉',
            premium: '🥇',
            pro: '💎'
        };
        
        await ctx.reply(
            `👤 PROFILE\n━━━━━━━━━━━━━━━\n\n` +
            `👤 Name: ${user.first_name || 'N/A'} ${user.last_name || ''}\n` +
            `👤 Username: @${user.username || 'N/A'}\n` +
            `🆔 Telegram ID: ${user.id}\n\n` +
            `${planEmoji[user.plan] || '🆓'} Plan: ${user.plan?.toUpperCase() || 'FREE'}\n` +
            `🤖 Bots: ${user.bot_count || 0}\n` +
            `💰 Balance: ৳${user.balance || 0}\n` +
            `👥 Referrals: ${user.referral_count || 0}\n` +
            `📅 Joined: ${new Date(user.created_at).toLocaleDateString()}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('💰 Wallet', 'wallet')],
                [Markup.button.callback('📊 My Stats', 'stats')]
            ])
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ============ 💰 Wallet ============
bot.hears('💰 Wallet', async (ctx) => {
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/user/${ctx.from.id}`);
        const user = response.data.user;
        
        await ctx.reply(
            `💰 WALLET\n━━━━━━━━━━━━━━━\n\n` +
            `💳 Balance: ৳${user?.balance || 0}\n\n` +
            `[➕ Add Balance]`,
            Markup.inlineKeyboard([
                [Markup.button.callback('➕ Add Balance', 'add_balance')],
                [Markup.button.callback('📜 Transaction History', 'transactions')]
            ])
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ============ 🎫 Tickets ============
bot.hears('🎫 Tickets', async (ctx) => {
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/tickets/${ctx.from.id}`);
        const tickets = response.data.tickets || [];
        
        let msg = '🎫 SUPPORT TICKETS\n━━━━━━━━━━━━━━━\n\n';
        
        if (tickets.length === 0) {
            msg += 'No tickets found.';
        } else {
            tickets.slice(0, 5).forEach(ticket => {
                const statusEmoji = ticket.status === 'open' ? '🟡' : '🟢';
                msg += `${statusEmoji} #${ticket.id} ${ticket.subject}\n`;
                msg += `📊 ${ticket.status}\n`;
                msg += `📅 ${new Date(ticket.created_at).toLocaleDateString()}\n\n`;
            });
        }
        
        await ctx.reply(
            msg,
            Markup.inlineKeyboard([
                [Markup.button.callback('➕ New Ticket', 'new_ticket')]
            ])
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

bot.action('new_ticket', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('🎫 NEW TICKET\n\nPlease send your message in this format:\n\n`/ticket <subject> | <message>`\n\nExample:\n`/ticket Payment Issue | I paid but plan not activated`');
});

// টিকেট কমান্ড
bot.command('ticket', async (ctx) => {
    const text = ctx.message.text;
    const parts = text.replace('/ticket', '').trim().split('|');
    
    if (parts.length < 2) {
        return ctx.reply('Please use format: `/ticket <subject> | <message>`', { parse_mode: 'Markdown' });
    }
    
    try {
        await axios.post(`${CONFIG.VPS_API}/ticket/create`, {
            userId: ctx.from.id,
            subject: parts[0].trim(),
            message: parts.slice(1).join('|').trim()
        });
        
        await ctx.reply(`${EMOJIS.success} Ticket created successfully! Admin will respond soon.`);
        
        // Admin Notification
        await ctx.telegram.sendMessage(
            CONFIG.ADMIN_ID,
            `🎫 NEW TICKET\n\n` +
            `👤 User: @${ctx.from.username || 'N/A'} (${ctx.from.id})\n` +
            `📋 Subject: ${parts[0].trim()}\n` +
            `📝 Message: ${parts.slice(1).join('|').trim()}\n` +
            `📅 Time: ${new Date().toLocaleString()}`
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ============ ❓ Help ============
bot.hears('❓ Help', async (ctx) => {
    await ctx.reply(
        `❓ HELP\n━━━━━━━━━━━━━━━\n\n` +
        `📤 How to Upload Bot\n` +
        `Send a .py file to the bot\n` +
        `System will automatically detect and host it\n\n` +
        `🚀 How to Start Bot\n` +
        `Go to My Bots → Select Bot → Click Start\n\n` +
        `⏹ How to Stop Bot\n` +
        `Go to My Bots → Select Bot → Click Stop\n\n` +
        `⚡ How to View Logs\n` +
        `Go to My Bots → Select Bot → Click Logs\n\n` +
        `📦 How to Install Package\n` +
        `Use the Install Package button in bot control\n\n` +
        `⚙️ How to Use Env Vars\n` +
        `Add environment variables in bot control\n\n` +
        `💎 Plans & Limits\n` +
        `Free: 1 bot\n` +
        `Basic: 3 bots\n` +
        `Premium: 10 bots\n` +
        `Pro: 25 bots`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🛰 Support', 'support')]
        ])
    );
});

// ============ 🛰 Support ============
bot.hears('🛰 Support', async (ctx) => {
    await ctx.reply(
        `🛰 SUPPORT\n━━━━━━━━━━━━━━━\n\n` +
        `Need help?\n\n` +
        `🎫 Create a support ticket\n` +
        `💬 Contact support\n` +
        `📢 Join support channel`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🎫 Create Ticket', 'new_ticket')],
            [Markup.button.callback('📢 Support Channel', 'support_channel')]
        ])
    );
});

// ============ 📊 My Stats ============
bot.hears('📊 My Stats', async (ctx) => {
    try {
        const [userRes, botsRes] = await Promise.all([
            axios.get(`${CONFIG.VPS_API}/user/${ctx.from.id}`),
            axios.get(`${CONFIG.VPS_API}/bots/${ctx.from.id}`)
        ]);
        
        const user = userRes.data.user;
        const bots = botsRes.data.bots || [];
        const runningBots = bots.filter(b => b.status === 'running').length;
        const totalStorage = bots.reduce((sum, b) => sum + (b.storage || 0), 0);
        
        await ctx.reply(
            `📊 MY STATISTICS\n━━━━━━━━━━━━━━━\n\n` +
            `👤 Account\n` +
            `🤖 Total Bots: ${bots.length}\n` +
            `🟢 Running: ${runningBots}\n` +
            `⏹ Stopped: ${bots.length - runningBots}\n\n` +
            `💾 Storage Used: ${totalStorage} MB\n` +
            `🧠 Current RAM: ${runningBots * 50} MB (approx)\n\n` +
            `💎 Current Plan: ${user?.plan?.toUpperCase() || 'FREE'}\n` +
            `👥 Referrals: ${user?.referral_count || 0}\n` +
            `💰 Referral Earned: ৳${(user?.referral_count || 0) * 10}`
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ============ 🎟️ Coupon ============
bot.hears('🎟️ Coupon', async (ctx) => {
    await ctx.reply(
        `🎟️ COUPON\n━━━━━━━━━━━━━━━\n\n` +
        `Enter your coupon code to get discounts!\n\n` +
        `Send your coupon code in this format:\n` +
        `/coupon <code>`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'back_to_menu')]
        ])
    );
});

bot.command('coupon', async (ctx) => {
    const code = ctx.message.text.replace('/coupon', '').trim();
    
    if (!code) {
        return ctx.reply('Please send a coupon code: `/coupon <code>`');
    }
    
    try {
        const response = await axios.post(`${CONFIG.VPS_API}/coupon/apply`, {
            code: code,
            userId: ctx.from.id
        });
        
        if (response.data.success) {
            await ctx.reply(
                `${EMOJIS.success} COUPON APPLIED!\n\n` +
                `🎁 Discount: ${response.data.discount}\n` +
                `📊 Type: ${response.data.type}\n` +
                `💰 Value: ${response.data.value}\n\n` +
                `This discount will be applied to your next purchase.`
            );
        } else {
            await ctx.reply(`${EMOJIS.error} ${response.data.error}`);
        }
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// ============ 👑 ADMIN PANEL ============
bot.hears('👑 Admin Panel', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) {
        return ctx.reply(`${EMOJIS.error} You are not authorized to access this panel.`);
    }
    
    await ctx.reply(
        `👑 ADMIN PANEL\n━━━━━━━━━━━━━━━\n\n` +
        `Select an option:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('👥 Users', 'admin_users')],
            [Markup.button.callback('🤖 All Bots', 'admin_bots')],
            [Markup.button.callback('💎 Plans', 'admin_plans')],
            [Markup.button.callback('💳 Payments', 'admin_payments')],
            [Markup.button.callback('🎟️ Coupons', 'admin_coupons')],
            [Markup.button.callback('🎫 Tickets', 'admin_tickets')],
            [Markup.button.callback('📢 Broadcast', 'admin_broadcast')],
            [Markup.button.callback('📊 System Stats', 'admin_stats')],
            [Markup.button.callback('📢 Join Requirements', 'admin_requirements')],
            [Markup.button.callback('🔙 Back', 'back_to_menu')]
        ])
    );
});

// ============ অ্যাডমিন কলব্যাক ============

// 👥 Users
bot.action('admin_users', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    await ctx.answerCbQuery();
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/admin/users`);
        const users = response.data.users || [];
        
        let msg = '👥 USERS\n━━━━━━━━━━━━━━━\n\n';
        
        users.slice(0, 10).forEach(user => {
            msg += `👤 ${user.first_name || 'N/A'} @${user.username || 'N/A'}\n`;
            msg += `🆔 ${user.id}\n`;
            msg += `💎 ${user.plan?.toUpperCase() || 'FREE'}\n`;
            msg += `🤖 ${user.bot_count || 0} bots\n`;
            msg += `💰 ৳${user.balance || 0}\n`;
            msg += `📅 ${new Date(user.created_at).toLocaleDateString()}\n\n`;
        });
        
        msg += `Total: ${users.length} users`;
        
        await ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'admin_back')]
        ]));
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 🤖 All Bots
bot.action('admin_bots', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    await ctx.answerCbQuery();
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/admin/bots`);
        const bots = response.data.bots || [];
        
        let msg = '🤖 ALL BOTS\n━━━━━━━━━━━━━━━\n\n';
        
        bots.slice(0, 10).forEach(bot => {
            const status = bot.status === 'running' ? '🟢' : '⏹';
            msg += `${status} ${bot.bot_name}\n`;
            msg += `👤 @${bot.username || 'N/A'}\n`;
            msg += `💾 ${bot.storage || 0} MB\n`;
            msg += `📅 ${new Date(bot.created_at).toLocaleDateString()}\n\n`;
        });
        
        msg += `Total: ${bots.length} bots`;
        
        await ctx.reply(msg, Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'admin_back')]
        ]));
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 💳 Payments
bot.action('admin_payments', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    await ctx.answerCbQuery();
    
    try {
        const stats = await axios.get(`${CONFIG.VPS_API}/admin/stats`);
        const pending = stats.data.stats?.pending_payments || 0;
        
        await ctx.reply(
            `💳 PAYMENTS\n━━━━━━━━━━━━━━━\n\n` +
            `⏳ Pending Payments: ${pending}\n\n` +
            `Check pending payments and approve/reject them.`,
            Markup.inlineKeyboard([
                [Markup.button.callback('📋 View Pending', 'admin_pending_payments')],
                [Markup.button.callback('🔙 Back', 'admin_back')]
            ])
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 📊 System Stats
bot.action('admin_stats', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    await ctx.answerCbQuery();
    
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/admin/stats`);
        const stats = response.data.stats || {};
        
        await ctx.reply(
            `📊 SYSTEM STATISTICS\n━━━━━━━━━━━━━━━\n\n` +
            `👥 Total Users: ${stats.total_users || 0}\n` +
            `🤖 Total Bots: ${stats.total_bots || 0}\n` +
            `🟢 Running Bots: ${stats.running_bots || 0}\n` +
            `⏹ Stopped Bots: ${(stats.total_bots || 0) - (stats.running_bots || 0)}\n\n` +
            `💎 Active Plans: ${stats.active_plans || 0}\n` +
            `💳 Pending Payments: ${stats.pending_payments || 0}\n` +
            `💰 Total Revenue: ৳${stats.total_revenue || 0}\n\n` +
            `🧠 RAM: ${stats.ram_usage || 'N/A'}\n` +
            `⚡ CPU: ${stats.cpu_load || 'N/A'}\n` +
            `💾 Disk: ${stats.disk_usage || 'N/A'}\n\n` +
            `📡 Server Status: 🟢 Online`
        );
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 📢 Broadcast
bot.action('admin_broadcast', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    await ctx.answerCbQuery();
    
    await ctx.reply(
        `📢 BROADCAST\n━━━━━━━━━━━━━━━\n\n` +
        `Send your broadcast message.\n\n` +
        `Format: /broadcast <message>`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'admin_back')]
        ])
    );
});

bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    
    const message = ctx.message.text.replace('/broadcast', '').trim();
    if (!message) {
        return ctx.reply('Please provide a message: `/broadcast <message>`');
    }
    
    try {
        await axios.post(`${CONFIG.VPS_API}/admin/broadcast`, {
            message: message,
            target: 'all'
        });
        
        await ctx.reply(`${EMOJIS.success} Broadcast sent successfully!`);
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// 🎟️ Admin Coupons
bot.action('admin_coupons', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    await ctx.answerCbQuery();
    
    await ctx.reply(
        `🎟️ COUPONS\n━━━━━━━━━━━━━━━\n\n` +
        `Create and manage coupons.\n\n` +
        `Format: /coupon_create <code> <type> <value> <max_uses>\n` +
        `Type: percentage or fixed\n` +
        `Example: /coupon_create SUMMER50 percentage 50 100`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'admin_back')]
        ])
    );
});

bot.command('coupon_create', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    
    const args = ctx.message.text.replace('/coupon_create', '').trim().split(' ');
    if (args.length < 4) {
        return ctx.reply('Format: /coupon_create <code> <type> <value> <max_uses>');
    }
    
    const [code, type, value, maxUses] = args;
    
    try {
        await axios.post(`${CONFIG.VPS_API}/admin/coupon`, {
            code: code.toUpperCase(),
            type: type,
            value: parseInt(value),
            maxUses: parseInt(maxUses)
        });
        
        await ctx.reply(`${EMOJIS.success} Coupon created successfully!\n\n` +
            `Code: ${code.toUpperCase()}\n` +
            `Type: ${type}\n` +
            `Value: ${value}\n` +
            `Max Uses: ${maxUses}`);
    } catch (error) {
        await ctx.reply(`${EMOJIS.error} ${error.message}`);
    }
});

// Admin Back
bot.action('admin_back', async (ctx) => {
    if (ctx.from.id !== CONFIG.ADMIN_ID) return;
    await ctx.answerCbQuery();
    ctx.hears('👑 Admin Panel');
});

// ============ হেল্পার ফাংশন ============
const getPlanName = async (planId) => {
    try {
        const response = await axios.get(`${CONFIG.VPS_API}/plans`);
        const plans = response.data.plans || [];
        const plan = plans.find(p => p.id == planId);
        return plan?.name || 'Unknown';
    } catch {
        return 'Unknown';
    }
};

// ============ লঞ্চ ============
module.exports = async (req, res) => {
    try {
        await bot.handleUpdate(req.body, res);
    } catch (error) {
        console.error('Error handling update:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// ============ সুইচ? ============
if (process.env.NODE_ENV === 'development') {
    bot.launch();
}

console.log('✅ Bot is ready!');
