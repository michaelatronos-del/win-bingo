import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://win-bingo-frontend.onrender.com';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Store user sessions (in production, use Redis or database)
const userSessions = new Map();

// Language translations
const translations = {
  en: {
    welcome: "Welcome to Win Bingo! 🎮",
    selectLanguage: "Please select your language/ቋንቋዎን ይምረጡ/Afaan filadhu/ቋንቋ ምረጽ",
    languageSet: "Language set to English",
    sharePhone: "Please share your phone number to register and start playing!",
    registered: "You are registered. You can start playing. Have fun!",
    alreadyRegistered: "Welcome back! You're already registered. Click Play to start!",
    playButton: "🎮 Play",
    errorOccurred: "An error occurred. Please try again.",
    insufficientBalance: "Insufficient balance. Please deposit to continue playing."
  },
  am: {
    welcome: "እንኳን ወደ ዊን ቢንጎ በደህና መጡ! 🎮",
    selectLanguage: "Please select your language/ቋንቋዎን ይምረጡ/Afaan filadhu/ቋንቋ ምረጽ",
    languageSet: "ቋንቋ ወደ አማርኛ ተቀይሯል",
    sharePhone: "ለመመዝገብ እና ለመጫወት የስልክ ቁጥርዎን ያጋሩ!",
    registered: "ተመዝግበዋል። አሁን መጫወት ይችላሉ። ይዝናኑ!",
    alreadyRegistered: "እንኳን ደህና መጡ! አስቀድመው ተመዝግበዋል። ለመጫወት Play ይጫኑ!",
    playButton: "🎮 ተጫወት",
    errorOccurred: "ስህተት ተፈጥሯል። እባክዎ እንደገና ይሞክሩ።",
    insufficientBalance: "በቂ ሂሳብ የለም። ለመቀጠል እባክዎ ገንዘብ ያስገቡ።"
  },
  ti: {
    welcome: "ናብ ዊን ቢንጎ እንቋዕ ብደሓን መጻእኩም! 🎮",
    selectLanguage: "Please select your language/ቋንቋዎን ይምረጡ/Afaan filadhu/ቋንቋ ምረጽ",
    languageSet: "ቋንቋ ናብ ትግርኛ ተቀይሩ",
    sharePhone: "ንምዝገባን ንምጽዋትን ናይ ስልክ ቁጽሪኹም ኣካፍሉ!",
    registered: "ተመዝጊብኩም ኣለኹም። ሕጂ ክትጻወቱ ትኽእሉ። ተዘናገዑ!",
    alreadyRegistered: "እንቋዕ ደሓን መጻእኩም! ኣስቀድም ተመዝጊብኩም። ንምጽዋት Play ጠውቑ!",
    playButton: "🎮 ተጫወት",
    errorOccurred: "ጌጋ ተፈጢሩ። በጃኹም ተመለሱ ሞክሩ።",
    insufficientBalance: "በቂ ሂሳብ የለን። ንምቕፃል በጃኹም ገንዘብ ኣእትዉ።"
  },
  or: {
    welcome: "Gara Win Bingo baga nagaan dhuftan! 🎮",
    selectLanguage: "Please select your language/ቋንቋዎን ይምረጡ/Afaan filadhu/ቋንቋ ምረጽ",
    languageSet: "Afaan gara Oromigna jijjirame",
    sharePhone: "Galmaa'uu fi taphaachuuf lakkoofsa bilbilaa keessan qooddadhaa!",
    registered: "Galmaa'amtaniirtu. Amma taphachuu dandeessu. Gammadaa!",
    alreadyRegistered: "Baga nagaan dhuftan! Duraanuu galmaa'amtaniirtu. Play cuqaasaa!",
    playButton: "🎮 Taphadhu",
    errorOccurred: "Dogongora uumame. Mee irra deebi'ii yaali.",
    insufficientBalance: "Baalansiin hin gahu. Itti fufuuf maadhee galchaa."
  }
};

// Get translation
const t = (userId, key) => {
  const lang = userSessions.get(userId)?.language || 'en';
  return translations[lang][key] || translations.en[key];
};

// Language selection keyboard
const languageKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "🇬🇧 English", callback_data: "lang_en" }],
      [{ text: "🇪🇹 አማርኛ", callback_data: "lang_am" }],
      [{ text: "🇪🇹 Afaan Oromoo", callback_data: "lang_or" }],
      [{ text: "🇪🇹 ትግርኛ", callback_data: "lang_ti" }]
    ]
  }
};

// Share contact keyboard
const getContactKeyboard = (userId) => {
  return {
    reply_markup: {
      keyboard: [
        [{
          text: "📱 Share Phone Number",
          request_contact: true
        }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
};

// Play button keyboard
const getPlayKeyboard = (userId) => {
  const session = userSessions.get(userId);
  const token = session?.token || '';
  
  return {
    reply_markup: {
      inline_keyboard: [
        [{
          text: t(userId, 'playButton'),
          web_app: { url: `${FRONTEND_URL}?tg_token=${token}` }
        }]
      ]
    }
  };
};

// Command: /start
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // Initialize session
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      telegramId: userId,
      username: msg.from.username || `user${userId}`,
      firstName: msg.from.first_name,
      language: null,
      registered: false
    });
  }

  // Check if user is already registered
  try {
    const checkResponse = await fetch(`${API_BASE_URL}/telegram/check-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: userId })
    });

    const checkData = await checkResponse.json();

    if (checkData.exists) {
      // User already registered
      const session = userSessions.get(userId);
      session.registered = true;
      session.token = checkData.token;
      session.language = checkData.language || 'en';
      
      await bot.sendMessage(
        chatId,
        t(userId, 'alreadyRegistered'),
        getPlayKeyboard(userId)
      );
      return;
    }
  } catch (error) {
    console.error('Error checking user:', error);
  }

  // New user - ask for language
  await bot.sendMessage(
    chatId,
    t(userId, 'selectLanguage'),
    languageKeyboard
  );
});

// Handle language selection
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('lang_')) {
    const lang = data.replace('lang_', '');
    const session = userSessions.get(userId) || {};
    session.language = lang;
    userSessions.set(userId, session);

    await bot.answerCallbackQuery(query.id);
    await bot.deleteMessage(chatId, query.message.message_id);

    await bot.sendMessage(chatId, t(userId, 'languageSet'));
    await bot.sendMessage(chatId, t(userId, 'welcome'));
    
    // Request phone number
    await bot.sendMessage(
      chatId,
      t(userId, 'sharePhone'),
      getContactKeyboard(userId)
    );
  }
});

// Handle contact sharing
bot.on('contact', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const contact = msg.contact;

  // Verify it's the user's own contact
  if (contact.user_id !== userId) {
    await bot.sendMessage(chatId, "Please share your own contact information.");
    return;
  }

  const session = userSessions.get(userId);
  if (!session) {
    await bot.sendMessage(chatId, "Session expired. Please type /start again.");
    return;
  }

  const username = msg.from.username || `user${userId}`;
  const phoneNumber = contact.phone_number;

  try {
    // Register user via API
    const response = await fetch(`${API_BASE_URL}/telegram/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: userId,
        username: username,
        phoneNumber: phoneNumber,
        firstName: msg.from.first_name,
        lastName: msg.from.last_name,
        language: session.language || 'en'
      })
    });

    const result = await response.json();

    if (!result.success) {
      await bot.sendMessage(chatId, result.error || t(userId, 'errorOccurred'));
      return;
    }

    // Update session
    session.registered = true;
    session.token = result.token;
    session.gameUserId = result.userId;
    userSessions.set(userId, session);

    // Remove keyboard
    await bot.sendMessage(chatId, t(userId, 'registered'), {
      reply_markup: { remove_keyboard: true }
    });

    // Send play button
    await bot.sendMessage(
      chatId,
      `${t(userId, 'playButton')} 👇`,
      getPlayKeyboard(userId)
    );

  } catch (error) {
    console.error('Registration error:', error);
    await bot.sendMessage(chatId, t(userId, 'errorOccurred'));
  }
});

// Command: /play
bot.onText(/\/play/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const session = userSessions.get(userId);

  if (!session || !session.registered) {
    await bot.sendMessage(chatId, "Please register first using /start");
    return;
  }

  await bot.sendMessage(
    chatId,
    "Click the button below to play! 🎮",
    getPlayKeyboard(userId)
  );
});

// Command: /language
bot.onText(/\/language/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, "Select your language:", languageKeyboard);
});

// Command: /help
bot.onText(/\/help/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  const helpText = `
🎮 *Win Bingo Bot Help*

Commands:
/start - Register and start playing
/play - Open the game
/language - Change language
/help - Show this help message

How to play:
1. Use /start to register
2. Share your phone number
3. Click Play to start gaming!

Need support? Contact @YourSupportUsername
  `;
  
  await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

console.log('✅ Telegram Bot is running...');

export default bot;