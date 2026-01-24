import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

// Serve audio files from the repository's /audio directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// projectRoot: server/src -> ../../
const projectRoot = path.resolve(__dirname, '..', '..');
const audioDir = path.join(projectRoot, 'audio');
app.use('/audio', express.static(audioDir));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const ROOM_ID = 'main';
const BOARD_SIZE = 75; // BINGO: B(1-15), I(16-30), N(31-45), G(46-60), O(61-75)
const COUNTDOWN_SECONDS = 60;
const CALL_INTERVAL_MS = 3000;

let state = {
  phase: 'lobby',
  countdown: COUNTDOWN_SECONDS,
  players: new Map(),
  stake: 10,
  called: [],
  timer: null,
  caller: null,
};

// Store user accounts
const users = new Map(); // username -> { userId, passwordHash, createdAt }
const userSessions = new Map(); // token -> { userId, username, expiresAt }
const userIdToUsername = new Map(); // userId -> username

// Store player balances and transaction history (now using userId)
const userBalances = new Map(); // userId -> balance
const transactionIds = new Set(); // Set of used transaction IDs
const withdrawalRequests = new Map(); // userId -> { amount, account, timestamp }

// Helper function to hash passwords
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Helper function to generate session token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getOnlinePlayers() {
  return Array.from(state.players.values());
}

function computePrizePool() {
  const total = getOnlinePlayers().length * state.stake;
  return Math.floor(total * 0.8);
}

function startCountdown() {
  clearInterval(state.timer);
  state.phase = 'countdown';
  state.countdown = COUNTDOWN_SECONDS;
  state.called = [];
  io.to(ROOM_ID).emit('phase', { phase: state.phase });
  io.to(ROOM_ID).emit('tick', { seconds: state.countdown, players: getOnlinePlayers().length, prize: computePrizePool(), stake: state.stake });
  
  state.timer = setInterval(() => {
    state.countdown -= 1;
    io.to(ROOM_ID).emit('tick', { seconds: state.countdown, players: getOnlinePlayers().length, prize: computePrizePool(), stake: state.stake });
    
    if (state.countdown <= 0) {
      clearInterval(state.timer);
      // Only start calling if there are players with boards selected
      const playersWithBoards = getOnlinePlayers().filter(p => p.picks && p.picks.length > 0);
      if (playersWithBoards.length > 0) {
        startCalling();
      } else {
        // No players ready, restart lobby
        state.phase = 'lobby';
        io.to(ROOM_ID).emit('phase', { phase: state.phase });
        startCountdown();
      }
    }
  }, 1000);
}

function startCalling() {
  state.phase = 'calling';
  io.to(ROOM_ID).emit('phase', { phase: state.phase });
  io.to(ROOM_ID).emit('game_start');
  
  // Generate BINGO numbers: B(1-15), I(16-30), N(31-45), G(46-60), O(61-75)
  const numbers = [];
  for (let i = 1; i <= 75; i++) {
    numbers.push(i);
  }
  
  // Shuffle the numbers
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  
  let idx = 0;
  clearInterval(state.caller);
  state.caller = setInterval(() => {
    if (idx >= numbers.length) {
      clearInterval(state.caller);
      // Game over, restart lobby
      state.phase = 'lobby';
      io.to(ROOM_ID).emit('phase', { phase: state.phase });
      startCountdown();
      return;
    }
    const n = numbers[idx++];
    state.called.push(n);
    io.to(ROOM_ID).emit('call', { number: n, called: state.called });
  }, CALL_INTERVAL_MS);
}

io.on('connection', (socket) => {
  const auth = socket.handshake.auth;
  const userId = auth?.userId;
  const username = auth?.username;
  
  if (!userId || !username) {
    socket.disconnect();
    return;
  }
  
  socket.join(ROOM_ID);
  state.players.set(socket.id, { 
    id: socket.id, 
    userId: userId,
    name: username, 
    stake: state.stake, 
    picks: [],
    ready: false
  });
  
  // Initialize balance if not exists
  if (!userBalances.has(userId)) {
    userBalances.set(userId, 0);
  }
  
  io.to(ROOM_ID).emit('players', { count: getOnlinePlayers().length });

  socket.emit('init', { 
    phase: state.phase, 
    seconds: state.countdown, 
    stake: state.stake, 
    prize: computePrizePool(), 
    called: state.called, 
    playerId: socket.id 
  });
  
  // Send balance to client
  socket.emit('balance_update', { balance: userBalances.get(userId) || 0 });

  socket.on('select_numbers', (picks) => {
    if (!Array.isArray(picks) || picks.length > 2) return;
    const player = state.players.get(socket.id);
    if (!player) return;
    player.picks = picks;
  });

  socket.on('start_game', () => {
    const player = state.players.get(socket.id);
    if (!player || player.picks.length === 0) return;
    player.ready = true;
    
    // Confirm the player is ready and redirect them to game page
    socket.emit('start_game_confirm');
    
    // If we're in countdown phase and player is ready, they can join the game
    if (state.phase === 'countdown') {
      // Player is ready to play, they'll be redirected to game page
      socket.emit('game_start');
    }
  });

  // Allow clients to choose a stake (bet house)
  socket.on('set_stake', (amount) => {
    const num = Number(amount)
    if (!Number.isFinite(num) || num <= 0) return
    state.stake = num
    io.to(ROOM_ID).emit('tick', { seconds: state.countdown, players: getOnlinePlayers().length, prize: computePrizePool(), stake: state.stake })
  })

  socket.on('bingo', () => {
    const player = state.players.get(socket.id);
    if (!player || !player.picks || player.picks.length === 0) return;
    
    // For now, simple validation - in real implementation, you'd validate the actual board
    const hasValidBingo = true; // Placeholder - implement actual board validation
    
    if (hasValidBingo) {
      io.to(ROOM_ID).emit('winner', { playerId: socket.id, prize: computePrizePool() });
      clearInterval(state.caller);
      clearInterval(state.timer);
      // Reset all players
      state.players.forEach(p => {
        p.picks = [];
        p.ready = false;
      });
      state.phase = 'lobby';
      io.to(ROOM_ID).emit('phase', { phase: state.phase });
      startCountdown();
    } else {
      // Invalid bingo - disqualify player
      player.disqualified = true;
      socket.emit('bingo_result', { valid: false, message: 'Invalid BINGO!' });
    }
  });

  socket.on('disconnect', () => {
    state.players.delete(socket.id);
    io.to(ROOM_ID).emit('players', { count: getOnlinePlayers().length });
  });
});

// Helper functions for verification
function parseAmount(message) {
  const patterns = [
    /(\d+\.?\d*)\s*(?:birr|etb|br)/i,
    /(?:birr|etb|br)\s*(\d+\.?\d*)/i,
    /amount[:\s]*(\d+\.?\d*)/i,
    /(\d+\.?\d*)\s*(?:sent|transferred|deposited|credited)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const amount = parseFloat(match[1]);
      if (!isNaN(amount) && amount > 0) return amount;
    }
  }
  const numbers = message.match(/\b(\d{2,}(?:\.\d{2})?)\b/g);
  if (numbers && numbers.length > 0) {
    const amounts = numbers.map(n => parseFloat(n)).filter(n => !isNaN(n) && n >= 10);
    if (amounts.length > 0) return Math.max(...amounts);
  }
  return null;
}

function parseTransactionId(text) {
  const patterns = [
    /(?:txn|trans|ref|reference|transaction\s*id|id)[:\s-]*([A-Z0-9]{6,})/i,
    /(?:txn|trans|ref|reference|transaction\s*id|id)[:\s-]*([a-z0-9]{6,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim().toUpperCase();
  }
  const tokens = text.match(/[A-Z0-9]{8,20}/gi);
  if (tokens) {
    return tokens.sort((a,b)=>b.length-a.length)[0].toUpperCase();
  }
  return null;
}

// Deposit API endpoint
app.post('/api/deposit', (req, res) => {
  try {
    const { userId, amount, provider, account, accountName, message, transactionId } = req.body;
    
    if (!userId || !amount || !message || !transactionId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }
    
    // Verify user exists
    if (!userIdToUsername.has(userId)) {
      return res.json({ success: false, error: 'Invalid user' });
    }
    
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.json({ success: false, error: 'Invalid amount' });
    }
    
    // Check if transaction ID was already used
    if (transactionIds.has(transactionId)) {
      return res.json({ success: false, error: 'This transaction ID has already been used' });
    }
    
    // Verify account number in message
    const msgNoSpaces = message.replace(/\s+/g, '');
    const accountNoSpaces = account.replace(/\s+/g, '');
    if (!msgNoSpaces.includes(accountNoSpaces)) {
      return res.json({ success: false, error: 'Account number not found in confirmation message' });
    }
    
    // Verify account holder name (OPTIONAL - if present, good; if not, that's fine as long as account number matches)
    // Note: We don't fail if name is not found - account number is the primary verification
    
    // Verify amount matches
    const detectedAmount = parseAmount(message);
    if (!detectedAmount || Math.abs(detectedAmount - amountNum) > 0.01) {
      return res.json({ 
        success: false, 
        error: `Amount mismatch. Expected: ${amountNum} Birr, Found: ${detectedAmount || 'N/A'} Birr` 
      });
    }
    
    // All checks passed - process deposit
    const currentBalance = userBalances.get(userId) || 0;
    userBalances.set(userId, currentBalance + amountNum);
    transactionIds.add(transactionId);
    
    // Notify client of balance update
    const playerSocket = Array.from(io.sockets.sockets.values()).find(s => {
      const player = state.players.get(s.id);
      return player && player.userId === userId;
    });
    if (playerSocket) {
      playerSocket.emit('balance_update', { balance: userBalances.get(userId) });
    }
    
    console.log(`Deposit processed: User ${userId}, Amount: ${amountNum}, TxnID: ${transactionId}`);
    
    res.json({ 
      success: true, 
      balance: userBalances.get(userId),
      message: 'Deposit verified and processed successfully' 
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.json({ success: false, error: 'Server error processing deposit' });
  }
});

// Withdrawal API endpoint
app.post('/api/withdrawal', (req, res) => {
  try {
    const { userId, amount, account } = req.body;
    
    if (!userId || !amount || !account) {
      return res.json({ success: false, error: 'Missing required fields' });
    }
    
    // Verify user exists
    if (!userIdToUsername.has(userId)) {
      return res.json({ success: false, error: 'Invalid user' });
    }
    
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.json({ success: false, error: 'Invalid amount' });
    }
    
    const currentBalance = userBalances.get(userId) || 0;
    if (amountNum > currentBalance) {
      return res.json({ success: false, error: 'Insufficient balance' });
    }
    
    // Store withdrawal request (in production, this would trigger actual bank transfer)
    withdrawalRequests.set(userId, {
      amount: amountNum,
      account: account,
      timestamp: Date.now()
    });
    
    // Deduct balance immediately (in production, you might want to hold it pending)
    userBalances.set(userId, currentBalance - amountNum);
    
    // Notify client of balance update
    const playerSocket = Array.from(io.sockets.sockets.values()).find(s => {
      const player = state.players.get(s.id);
      return player && player.userId === userId;
    });
    if (playerSocket) {
      playerSocket.emit('balance_update', { balance: userBalances.get(userId) });
    }
    
    console.log(`Withdrawal requested: User ${userId}, Amount: ${amountNum}, Account: ${account}`);
    
    res.json({ 
      success: true, 
      balance: userBalances.get(userId),
      message: 'Withdrawal request processed. Please check your account and paste the confirmation message.' 
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.json({ success: false, error: 'Server error processing withdrawal' });
  }
});

// Withdrawal verification API endpoint
app.post('/api/withdrawal/verify', (req, res) => {
  try {
    const { userId, amount, account, message, transactionId } = req.body;
    
    if (!userId || !amount || !message || !transactionId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }
    
    // Verify user exists
    if (!userIdToUsername.has(userId)) {
      return res.json({ success: false, error: 'Invalid user' });
    }
    
    const amountNum = Number(amount);
    
    // Verify amount in message
    const detectedAmount = parseAmount(message);
    if (!detectedAmount || Math.abs(detectedAmount - amountNum) > 0.01) {
      return res.json({ 
        success: false, 
        error: `Amount mismatch. Expected: ${amountNum} Birr, Found: ${detectedAmount || 'N/A'} Birr` 
      });
    }
    
    // Verify transaction ID
    const detectedTxnId = parseTransactionId(message);
    if (!detectedTxnId || detectedTxnId !== transactionId.toUpperCase()) {
      return res.json({ success: false, error: 'Transaction ID mismatch' });
    }
    
    // Check if transaction ID was already used
    if (transactionIds.has(transactionId.toUpperCase())) {
      return res.json({ success: false, error: 'This transaction ID has already been used' });
    }
    
    // Verify account in message
    const msgNoSpaces = message.replace(/\s+/g, '');
    const accountNoSpaces = account.replace(/\s+/g, '');
    if (!msgNoSpaces.includes(accountNoSpaces)) {
      return res.json({ success: false, error: 'Account number not found in confirmation message' });
    }
    
    // All checks passed - mark transaction as verified
    transactionIds.add(transactionId.toUpperCase());
    
    // Remove withdrawal request
    withdrawalRequests.delete(userId);
    
    console.log(`Withdrawal verified: User ${userId}, Amount: ${amountNum}, TxnID: ${transactionId}`);
    
    res.json({ 
      success: true, 
      message: 'Withdrawal verified successfully' 
    });
  } catch (error) {
    console.error('Withdrawal verification error:', error);
    res.json({ success: false, error: 'Server error verifying withdrawal' });
  }
});

// Authentication API endpoints
app.post('/api/auth/signup', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.json({ success: false, error: 'Username and password required' });
    }
    
    const usernameLower = username.trim().toLowerCase();
    
    if (usernameLower.length < 3) {
      return res.json({ success: false, error: 'Username must be at least 3 characters' });
    }
    
    if (password.length < 6) {
      return res.json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    if (users.has(usernameLower)) {
      return res.json({ success: false, error: 'Username already exists' });
    }
    
    // Create user
    const userId = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password);
    
    users.set(usernameLower, {
      userId,
      passwordHash,
      createdAt: Date.now()
    });
    
    userIdToUsername.set(userId, usernameLower);
    
    // Initialize balance
    userBalances.set(userId, 0);
    
    // Create session
    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    userSessions.set(token, { userId, username: usernameLower, expiresAt });
    
    console.log(`User signed up: ${usernameLower} (${userId})`);
    
    res.json({
      success: true,
      userId,
      username: usernameLower,
      token
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.json({ success: false, error: 'Server error during signup' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.json({ success: false, error: 'Username and password required' });
    }
    
    const usernameLower = username.trim().toLowerCase();
    const user = users.get(usernameLower);
    
    if (!user) {
      return res.json({ success: false, error: 'Invalid username or password' });
    }
    
    const passwordHash = hashPassword(password);
    if (user.passwordHash !== passwordHash) {
      return res.json({ success: false, error: 'Invalid username or password' });
    }
    
    // Create session
    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    userSessions.set(token, { userId: user.userId, username: usernameLower, expiresAt });
    
    // Initialize balance if not exists
    if (!userBalances.has(user.userId)) {
      userBalances.set(user.userId, 0);
    }
    
    console.log(`User logged in: ${usernameLower} (${user.userId})`);
    
    res.json({
      success: true,
      userId: user.userId,
      username: usernameLower,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, error: 'Server error during login' });
  }
});

app.post('/api/auth/verify', (req, res) => {
  try {
    const { userId, token } = req.body;
    
    if (!userId || !token) {
      return res.json({ success: false });
    }
    
    const session = userSessions.get(token);
    
    if (!session || session.userId !== userId) {
      return res.json({ success: false });
    }
    
    if (session.expiresAt < Date.now()) {
      userSessions.delete(token);
      return res.json({ success: false });
    }
    
    const username = userIdToUsername.get(userId);
    if (!username) {
      return res.json({ success: false });
    }
    
    res.json({ success: true, username });
  } catch (error) {
    console.error('Verify error:', error);
    res.json({ success: false });
  }
});

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of userSessions.entries()) {
    if (session.expiresAt < now) {
      userSessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Every hour

app.get('/', (_req, res) => {
  res.send('Go Bingo server running');
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
  if (!state.timer && state.phase === 'lobby') startCountdown();
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use!`);
    console.error(`Please either:`);
    console.error(`  1. Kill the process using port ${PORT}`);
    console.error(`  2. Or set a different PORT environment variable`);
    console.error(`\nTo find and kill the process on Windows:`);
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error(`  taskkill /F /PID <PID_NUMBER>`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});