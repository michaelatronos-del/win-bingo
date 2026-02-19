import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8265646245:AAFoz7VyX2P71G4zkd4YNrKWdWpHRgniOOE';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://win-bingo-frontend.onrender.com';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

console.log('🤖 Bot Configuration:');
console.log('   Frontend URL:', FRONTEND_URL);
console.log('   API Base URL:', API_BASE_URL);
console.log('   Bot Token:', BOT_TOKEN ? '✓ Set' : '✗ Missing');

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set!');
  process.exit(1);
}

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
    insufficientBalance: "Insufficient balance. Please deposit to continue playing.",
    sessionExpired: "Session expired. Please type /start again.",
    shareOwnContact: "Please share your own contact information.",
    registering: "Registering your account... ⏳"
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
    insufficientBalance: "በቂ ሂሳብ የለም። ለመቀጠል እባክዎ ገንዘብ ያስገቡ።",
    sessionExpired: "ጊዜው አልፏል። እባክዎ /start ይጻፉ።",
    shareOwnContact: "እባክዎ የራስዎን ስልክ ቁጥር ያጋሩ።",
    registering: "እየመዘገቡ ነው... ⏳"
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
    insufficientBalance: "በቂ ሂሳብ የለን። ንምቕፃል በጃኹም ገንዘብ ኣእትዉ።",
    sessionExpired: "ጊዜኹም ወዲኡ። በጃኹም /start ጽሓፉ።",
    shareOwnContact: "በጃኹም ናይ ገዛእ ርእስኹም ስልክ ቁጽሪ ኣካፍሉ።",
    registering: "ይምዝገብ ኣሎ... ⏳"
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
    insufficientBalance: "Baalansiin hin gahu. Itti fufuuf maadhee galchaa.",
    sessionExpired: "Yeroon darbee jira. Mee /start barreessaa.",
    shareOwnContact: "Mee lakkoofsa bilbila keessan qooddadhaa.",
    registering: "Galmaa'uu jira... ⏳"
  }
};

// Get translation
const t = (userId, key) => {
  const lang = userSessions.get(userId)?.language || 'en';
  return translations[lang]?.[key] || translations.en[key] || key;
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

  console.log(`\n📱 /start command from:`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Username: @${msg.from.username || 'none'}`);
  console.log(`   Name: ${msg.from.first_name || ''} ${msg.from.last_name || ''}`);

  // Initialize session
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      telegramId: userId,
      username: msg.from.username || `user${userId}`,
      firstName: msg.from.first_name,
      language: null,
      registered: false
    });
    console.log('   ✓ Session initialized');
  }

  // Check if user is already registered
  try {
    const checkUrl = `${API_BASE_URL}/telegram/check-user`;
    console.log(`   🔍 Checking registration at: ${checkUrl}`);
    
    const checkResponse = await fetch(checkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: userId })
    });

    if (!checkResponse.ok) {
      throw new Error(`HTTP ${checkResponse.status}: ${checkResponse.statusText}`);
    }

    const checkData = await checkResponse.json();
    console.log('   📥 Check response:', checkData);

    if (checkData.exists) {
      // User already registered
      const session = userSessions.get(userId);
      session.registered = true;
      session.token = checkData.token;
      session.language = checkData.language || 'en';
      
      console.log('   ✅ User already registered, sending Play button');
      
      await bot.sendMessage(
        chatId,
        t(userId, 'alreadyRegistered'),
        getPlayKeyboard(userId)
      );
      return;
    }
    
    console.log('   ℹ️ New user, showing language selection');
  } catch (error) {
    console.error('   ❌ Error checking user:', error.message);
    console.error('   Stack:', error.stack);
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

  console.log(`\n🌐 Language selection: ${data} from user ${userId}`);

  if (data.startsWith('lang_')) {
    const lang = data.replace('lang_', '');
    const session = userSessions.get(userId) || {};
    session.language = lang;
    userSessions.set(userId, session);

    console.log(`   ✓ Language set to: ${lang}`);

    await bot.answerCallbackQuery(query.id);
    await bot.deleteMessage(chatId, query.message.message_id);

    await bot.sendMessage(chatId, t(userId, 'languageSet'));
    await bot.sendMessage(chatId, t(userId, 'welcome'));
    
    // Request phone number
    console.log('   📞 Requesting phone number');
    await bot.sendMessage(
      chatId,
      t(userId, 'sharePhone'),
      getContactKeyboard(userId)
    );
  }
});

// Handle contact sharing - UPDATED WITH BETTER ERROR HANDLING
bot.on('contact', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const contact = msg.contact;

  console.log(`\n📞 Contact received:`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Contact Phone: ${contact.phone_number}`);
  console.log(`   Contact User ID: ${contact.user_id || 'not provided'}`);
  console.log(`   First Name: ${contact.first_name || ''}`);
  console.log(`   Last Name: ${contact.last_name || ''}`);

  // Verify it's the user's own contact (if user_id is provided)
  if (contact.user_id && contact.user_id !== userId) {
    console.log('   ⚠️ User tried to share someone else\'s contact');
    await bot.sendMessage(chatId, t(userId, 'shareOwnContact'));
    return;
  }

  const session = userSessions.get(userId);
  if (!session) {
    console.log('   ❌ No session found for user');
    await bot.sendMessage(chatId, t(userId, 'sessionExpired'));
    return;
  }

  const username = msg.from.username || `user${userId}`;
  const phoneNumber = contact.phone_number;

  // Send "registering" message
  await bot.sendMessage(chatId, t(userId, 'registering'));

  try {
    const registerUrl = `${API_BASE_URL}/telegram/register`;
    console.log(`   📝 Registering at: ${registerUrl}`);
    
    const requestBody = {
      telegramId: userId,
      username: username,
      phoneNumber: phoneNumber,
      firstName: msg.from.first_name || contact.first_name || '',
      lastName: msg.from.last_name || contact.last_name || '',
      language: session.language || 'en'
    };
    
    console.log('   📤 Request body:', {
      ...requestBody,
      phoneNumber: '***' + phoneNumber.slice(-4)
    });

    const response = await fetch(registerUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`   📥 Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`   ❌ HTTP Error: ${errorText}`);
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('   📥 Response data:', result);

    if (!result.success) {
      console.error('   ❌ Registration failed:', result.error);
      await bot.sendMessage(chatId, result.error || t(userId, 'errorOccurred'));
      return;
    }

    // Update session
    session.registered = true;
    session.token = result.token;
    session.gameUserId = result.userId;
    userSessions.set(userId, session);

    console.log(`   ✅ Registration successful!`);
    console.log(`      Username: ${result.username}`);
    console.log(`      User ID: ${result.userId}`);
    console.log(`      Balance: ${result.balance} Birr`);

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

    console.log('   🎮 Play button sent');

  } catch (error) {
    console.error('   ❌ Registration error:', error.message);
    console.error('   Stack:', error.stack);
    
    await bot.sendMessage(
      chatId, 
      t(userId, 'errorOccurred') + 
      '\n\n🔧 Error: ' + error.message +
      '\n\nPlease contact support if this persists.'
    );
  }
});

// Command: /play
bot.onText(/\/play/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const session = userSessions.get(userId);

  console.log(`\n🎮 /play command from user ${userId}`);

  if (!session || !session.registered) {
    console.log('   ⚠️ User not registered');
    await bot.sendMessage(chatId, "Please register first using /start");
    return;
  }

  console.log('   ✓ Sending play button');
  await bot.sendMessage(
    chatId,
    "Click the button below to play! 🎮",
    getPlayKeyboard(userId)
  );
});

// Command: /language
bot.onText(/\/language/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`\n🌐 /language command from user ${msg.from.id}`);
  await bot.sendMessage(chatId, "Select your language:", languageKeyboard);
});

// Command: /help
bot.onText(/\/help/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  console.log(`\n❓ /help command from user ${userId}`);
  
  const helpText = `
🎮 *Win Bingo Bot Help*

Commands:
/start - Register and start playing
/play - Open the game
/language - Change language
/help - Show this help message
/debug - Show debug information

How to play:
1. Use /start to register
2. Share your phone number
3. Click Play to start gaming!

Need support? Contact @YourSupportUsername
  `;
  
  await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// Command: /debug (for troubleshooting)
bot.onText(/\/debug/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const session = userSessions.get(userId);
  
  console.log(`\n🔧 /debug command from user ${userId}`);
  
  const debugInfo = `
🔧 *Debug Info*

User ID: \`${userId}\`
Session exists: ${session ? '✓' : '✗'}
Registered: ${session?.registered ? '✓' : '✗'}
Language: ${session?.language || 'not set'}
Token: ${session?.token ? '✓ Set' : '✗ Missing'}

API URL: \`${API_BASE_URL}\`
Frontend: \`${FRONTEND_URL}\`

Bot Status: ✓ Running
  `;
  
  await bot.sendMessage(chatId, debugInfo, { parse_mode: 'Markdown' });
});

// Error handling for polling
bot.on('polling_error', (error) => {
  console.error('❌ Telegram polling error:', error.code);
  console.error('   Message:', error.message);
  
  // Don't exit on common errors
  if (error.code === 'EFATAL') {
    console.error('   Fatal error - bot may need restart');
  }
});

// Error handling for webhook errors (if using webhooks)
bot.on('webhook_error', (error) => {
  console.error('❌ Telegram webhook error:', error);
});

// General error handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('   Reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('   Stack:', error.stack);
  // Don't exit - keep bot running
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️ Received SIGINT, shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️ Received SIGTERM, shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});

// Log successful bot start
console.log('✅ Telegram Bot is running...');
console.log('📡 Listening for commands...');
console.log('');

export default bot;