import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const app = express();

// CORS with Authorization header support
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
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

const BOARD_SIZE = 75; // BINGO: B(1-15), I(16-30), N(31-45), G(46-60), O(61-75)
const COUNTDOWN_SECONDS = 60;
const CALL_INTERVAL_MS = 5000;

// Available stake amounts (bet houses)
const AVAILABLE_STAKES = [10, 20, 50, 100, 200, 500];

// Game states for each stake amount (bet house)
// Key: stake amount, Value: game state object
const gameStates = new Map();

// Helper to create an empty game state for a given stake
function createEmptyGameState(stake, roomIdOverride) {
  const roomId = roomIdOverride || `room-${stake}`;
  return {
    roomId,
    phase: 'lobby',
    countdown: COUNTDOWN_SECONDS,
    players: new Map(), // active players in current game
    waitingPlayers: new Map(), // players waiting for next game
    takenBoards: new Set(), // reserved board numbers in current selection phase
    stake,
    called: [],
    timer: null,
    caller: null,
  };
}

// Initialize game states for all stake amounts
AVAILABLE_STAKES.forEach(stake => {
  const roomId = `room-${stake}`;
  gameStates.set(stake, createEmptyGameState(stake, roomId));
});

// Helper to get room ID from stake
function getRoomId(stake) {
  return `room-${stake}`;
}

// Helper to get game state for a stake
function getGameState(stake) {
  if (!gameStates.has(stake)) {
    // Initialize if doesn't exist
    const roomId = getRoomId(stake);
    gameStates.set(stake, createEmptyGameState(stake, roomId));
  }
  return gameStates.get(stake);
}

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

// ---- AUTH HELPERS FOR REST (KENO, BALANCE, ETC.) ----
function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const [type, token] = h.split(' ');
  if (type !== 'Bearer' || !token) return null;
  return token;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ success: false, error: 'Missing token' });

  const session = userSessions.get(token);
  if (!session) return res.status(401).json({ success: false, error: 'Invalid token' });

  if (session.expiresAt < Date.now()) {
    userSessions.delete(token);
    return res.status(401).json({ success: false, error: 'Session expired' });
  }

  req.session = session; // { userId, username, expiresAt }
  next();
}

function getOnlinePlayers(state) {
  return Array.from(state.players.values());
}

function getTotalSelectedBoards(state) {
  let totalBoards = 0;
  state.players.forEach(player => {
    if (Array.isArray(player.picks)) {
      totalBoards += player.picks.length;
    }
  });
  return totalBoards;
}

function computePrizePool(state) {
  // Prize = 80% of (total selected boards * stake)
  const totalBetAmount = getTotalSelectedBoards(state) * state.stake;
  return Math.floor(totalBetAmount * 0.8);
}

function startCountdown(stake) {
  const state = getGameState(stake);
  const roomId = state.roomId;

  clearInterval(state.timer);
  state.phase = 'countdown';
  state.countdown = COUNTDOWN_SECONDS;
  state.called = [];

  // Move waiting players to active players if game is starting
  state.waitingPlayers.forEach((player, socketId) => {
    state.players.set(socketId, player);
    state.waitingPlayers.delete(socketId);
  });

  // Reset taken boards based on current active players
  state.takenBoards = new Set();
  state.players.forEach(player => {
    if (Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.add(boardId));
    }
  });

  io.to(roomId).emit('phase', { phase: state.phase, stake });
  io.to(roomId).emit('tick', {
    seconds: state.countdown,
    players: getTotalSelectedBoards(state),
    prize: computePrizePool(state),
    stake: state.stake
  });

  state.timer = setInterval(() => {
    state.countdown -= 1;
    io.to(roomId).emit('tick', {
      seconds: state.countdown,
      players: getTotalSelectedBoards(state),
      prize: computePrizePool(state),
      stake: state.stake
    });

    if (state.countdown <= 0) {
      clearInterval(state.timer);
      // Only start calling if there are players with boards selected.
      // Consider any active player that has at least one board selected.
      const playersWithBoards = getOnlinePlayers(state).filter(
        p => Array.isArray(p.picks) && p.picks.length > 0
      );
      if (playersWithBoards.length > 0) {
        startCalling(stake);
      } else {
        // No players ready, restart lobby
        state.phase = 'lobby';
        io.to(roomId).emit('phase', { phase: state.phase, stake });
        startCountdown(stake);
      }
    }
  }, 1000);
}

function startCalling(stake) {
  const state = getGameState(stake);
  const roomId = state.roomId;

  state.phase = 'calling';
  io.to(roomId).emit('phase', { phase: state.phase, stake });
  io.to(roomId).emit('game_start', { stake });

  // Generate BINGO numbers: 1..75
  const numbers = [];
  for (let i = 1; i <= 75; i++) numbers.push(i);

  // Shuffle
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }

  let idx = 0;
  clearInterval(state.caller);
  state.caller = setInterval(() => {
    if (idx >= numbers.length) {
      clearInterval(state.caller);
      // Game over, restart lobby and move waiting players in
      state.phase = 'lobby';
      io.to(roomId).emit('phase', { phase: state.phase, stake });

      // Reset active players, move waiting players to active
      state.players.clear();
      state.waitingPlayers.forEach((player, socketId) => {
        state.players.set(socketId, player);
        state.waitingPlayers.delete(socketId);
      });

      startCountdown(stake);
      return;
    }
    const n = numbers[idx++];
    state.called.push(n);
    io.to(roomId).emit('call', { number: n, called: state.called, stake });
  }, CALL_INTERVAL_MS);
}

// Get status of all bet houses
function getAllBetHousesStatus() {
  const statuses = [];
  AVAILABLE_STAKES.forEach(stake => {
    const state = getGameState(stake);
    const activePlayers = getTotalSelectedBoards(state);
    const waitingPlayers = state.waitingPlayers.size;
    statuses.push({
      stake,
      phase: state.phase,
      activePlayers,
      waitingPlayers,
      totalPlayers: activePlayers + waitingPlayers,
      prize: computePrizePool(state),
      countdown: state.countdown,
      called: state.called.length
    });
  });
  return statuses;
}

// Track which room each socket is in
const socketRooms = new Map(); // socket.id -> stake amount

io.on('connection', (socket) => {
  const auth = socket.handshake.auth;
  const userId = auth?.userId;
  const username = auth?.username;

  if (!userId || !username) {
    socket.disconnect();
    return;
  }

  // Initialize balance if not exists
  if (!userBalances.has(userId)) {
    userBalances.set(userId, 0);
  }

  // Send balance to client
  socket.emit('balance_update', { balance: userBalances.get(userId) || 0 });

  // Send all bet houses status on connection
  socket.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

  // Join a specific bet house (stake amount)
  socket.on('join_bet_house', (stakeAmount) => {
    const stake = Number(stakeAmount);
    if (!AVAILABLE_STAKES.includes(stake)) {
      socket.emit('error', { message: 'Invalid stake amount' });
      return;
    }

    // Leave previous room if any
    const previousStake = socketRooms.get(socket.id);
    if (previousStake && previousStake !== stake) {
      const prevState = getGameState(previousStake);
      const prevRoomId = prevState.roomId;
      socket.leave(prevRoomId);
      prevState.players.delete(socket.id);
      prevState.waitingPlayers.delete(socket.id);
      io.to(prevRoomId).emit('players', {
        count: getOnlinePlayers(prevState).length,
        waitingCount: prevState.waitingPlayers.size,
        stake: previousStake
      });
    }

    // Join new room
    const state = getGameState(stake);
    const roomId = state.roomId;
    socket.join(roomId);
    socketRooms.set(socket.id, stake);

    // Add player to waiting players (they can select boards even during live games)
    const player = {
      id: socket.id,
      userId: userId,
      name: username,
      stake: stake,
      picks: [],
      ready: false
    };

    // If game is live, add to waiting players; otherwise add to active players
    if (state.phase === 'calling') {
      state.waitingPlayers.set(socket.id, player);
    } else {
      state.players.set(socket.id, player);
    }

    // Send current state to player
    socket.emit('init', {
      phase: state.phase,
      seconds: state.countdown,
      stake: state.stake,
      prize: computePrizePool(state),
      called: state.called,
      playerId: socket.id,
      isWaiting: state.phase === 'calling'
    });

    // Update room with player count
    io.to(roomId).emit('players', {
      count: getTotalSelectedBoards(state),
      waitingCount: state.waitingPlayers.size,
      stake: stake
    });

    // Broadcast updated bet houses status to all clients
    io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });
  });

  socket.on('select_numbers', (data) => {
    const { picks, stake: stakeAmount } = data;
    if (!Array.isArray(picks) || picks.length > 2) return;

    const stake = Number(stakeAmount);
    if (!socketRooms.has(socket.id) || socketRooms.get(socket.id) !== stake) {
      return;
    }

    const state = getGameState(stake);
    const player = state.players.get(socket.id) || state.waitingPlayers.get(socket.id);
    if (!player) return;

    // Release previously taken boards for this player
    if (Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.delete(boardId));
    }

    // Reserve new boards and assign to player
    const uniquePicks = Array.from(new Set(picks));
    const availablePicks = uniquePicks.filter(boardId => !state.takenBoards.has(boardId));
    availablePicks.forEach(boardId => state.takenBoards.add(boardId));
    player.picks = availablePicks;

    // Notify room about taken boards so other players can see which boards are unavailable
    const roomId = state.roomId;
    io.to(roomId).emit('boards_taken', {
      stake,
      takenBoards: Array.from(state.takenBoards),
    });
  });

  socket.on('start_game', (data) => {
    const stake = Number(data?.stake || socketRooms.get(socket.id));
    if (!stake || !socketRooms.has(socket.id) || socketRooms.get(socket.id) !== stake) {
      return;
    }

    const state = getGameState(stake);
    const player = state.players.get(socket.id) || state.waitingPlayers.get(socket.id);
    if (!player || player.picks.length === 0) return;

    player.ready = true;

    // If player was waiting and game is live, keep them in waiting
    // Otherwise, move them to active players if not already there
    if (state.phase !== 'calling' && state.waitingPlayers.has(socket.id)) {
      state.waitingPlayers.delete(socket.id);
      state.players.set(socket.id, player);
    }

    // Confirm the player is ready
    socket.emit('start_game_confirm', { stake, isWaiting: state.phase === 'calling' });

    // If we're in countdown phase and player is ready, they can join the game
    if (state.phase === 'countdown') {
      socket.emit('game_start', { stake });
    }

    // Update room
    const roomId = state.roomId;
    io.to(roomId).emit('players', {
      count: getOnlinePlayers(state).length,
      waitingCount: state.waitingPlayers.size,
      stake: stake
    });
  });

  socket.on('bingo', (data) => {
    const stake = Number(data?.stake || socketRooms.get(socket.id));
    if (!stake || !socketRooms.has(socket.id) || socketRooms.get(socket.id) !== stake) {
      return;
    }

    const state = getGameState(stake);
    const roomId = state.roomId;
    const player = state.players.get(socket.id);
    if (!player || !player.picks || player.picks.length === 0) return;

    // Trust the client for which board/line won (validation is done on client for now)
    const boardId = data?.boardId;
    const lineIndices = Array.isArray(data?.lineIndices) ? data.lineIndices : undefined;

    const prize = computePrizePool(state);
    io.to(roomId).emit('winner', { playerId: socket.id, prize, stake, boardId, lineIndices });

    // Award prize to winner
    const winnerBalance = userBalances.get(player.userId) || 0;
    userBalances.set(player.userId, winnerBalance + prize);
    socket.emit('balance_update', { balance: userBalances.get(player.userId) });

    clearInterval(state.caller);
    clearInterval(state.timer);

    // Reset active players, move waiting players to active for next game
    state.players.clear();
    state.waitingPlayers.forEach((waitingPlayer, socketId) => {
      waitingPlayer.picks = [];
      waitingPlayer.ready = false;
      state.players.set(socketId, waitingPlayer);
    });
    state.waitingPlayers.clear();
    state.takenBoards = new Set();

    state.phase = 'lobby';
    io.to(roomId).emit('phase', { phase: state.phase, stake });

    // Broadcast updated bet houses status
    io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

    startCountdown(stake);
  });

  socket.on('get_bet_houses_status', () => {
    socket.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });
  });

  // Allow player to leave current game (but stay connected)
  socket.on('leave_current_game', () => {
    const stake = socketRooms.get(socket.id);
    if (!stake) return;
    const state = getGameState(stake);
    const roomId = state.roomId;

    // Release any boards taken by this player
    const player = state.players.get(socket.id) || state.waitingPlayers.get(socket.id);
    if (player && Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.delete(boardId));
    }

    // Remove player from current game state and room
    state.players.delete(socket.id);
    state.waitingPlayers.delete(socket.id);
    socket.leave(roomId);
    socketRooms.delete(socket.id);

    io.to(roomId).emit('players', {
      count: getOnlinePlayers(state).length,
      waitingCount: state.waitingPlayers.size,
      stake,
    });

    // Broadcast updated bet houses and taken boards
    io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });
    io.to(roomId).emit('boards_taken', {
      stake,
      takenBoards: Array.from(state.takenBoards),
    });
  });

  socket.on('disconnect', () => {
    const stake = socketRooms.get(socket.id);
    if (stake) {
      const state = getGameState(stake);
      const roomId = state.roomId;

      // Release any boards taken by this player
      const player = state.players.get(socket.id) || state.waitingPlayers.get(socket.id);
      if (player && Array.isArray(player.picks)) {
        player.picks.forEach(boardId => state.takenBoards.delete(boardId));
      }

      state.players.delete(socket.id);
      state.waitingPlayers.delete(socket.id);
      socketRooms.delete(socket.id);

      io.to(roomId).emit('players', {
        count: getTotalSelectedBoards(state),
        waitingCount: state.waitingPlayers.size,
        stake: stake
      });

      // Broadcast updated bet houses status
      io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

      // Broadcast updated taken boards for this stake
      io.to(roomId).emit('boards_taken', {
        stake,
        takenBoards: Array.from(state.takenBoards),
      });
    }
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
    const sorted = tokens.sort((a,b)=>b.length-a.length);
    return sorted[0].toUpperCase();
  }
  return null;
}

/* =========  KENO / WALLET REST ENDPOINTS (NEW)  ========= */

// 1) Balance for Keno page
app.get('/api/user/balance', requireAuth, (req, res) => {
  const { userId } = req.session;
  const balance = userBalances.get(userId) || 0;
  res.json({ balance });
});

// 2) Place Keno bet (deduct from balance)
app.post('/api/games/keno/bet', requireAuth, (req, res) => {
  const sessionUserId = req.session.userId;
  const { userId: bodyUserId, amount } = req.body;

  if (bodyUserId && bodyUserId !== sessionUserId) {
    return res.json({ success: false, error: 'User mismatch' });
  }

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.json({ success: false, error: 'Invalid amount' });
  }

  const current = userBalances.get(sessionUserId) || 0;
  if (current < amountNum) {
    return res.json({ success: false, error: 'Insufficient funds' });
  }

  userBalances.set(sessionUserId, current - amountNum);
  res.json({
    success: true,
    newBalance: userBalances.get(sessionUserId),
    ticketId: Date.now(), // simple unique ID
  });
});

// 3) Settle Keno wins (add to balance)
app.post('/api/games/keno/settle', requireAuth, (req, res) => {
  const sessionUserId = req.session.userId;
  const { userId: bodyUserId, totalWin } = req.body;

  if (bodyUserId && bodyUserId !== sessionUserId) {
    return res.json({ success: false, error: 'User mismatch' });
  }

  const winNum = Number(totalWin) || 0;
  if (winNum < 0) {
    return res.json({ success: false, error: 'Invalid totalWin' });
  }

  const current = userBalances.get(sessionUserId) || 0;
  userBalances.set(sessionUserId, current + winNum);

  res.json({
    success: true,
    newBalance: userBalances.get(sessionUserId),
  });
});

/* =========  EXISTING WALLET ENDPOINTS (DEPOSIT/WITHDRAW)  ========= */

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

    // Notify client of balance update (search across all rooms)
    const playerSocket = Array.from(io.sockets.sockets.values()).find(s => {
      const stake = socketRooms.get(s.id);
      if (!stake) return false;
      const state = getGameState(stake);
      const player = state.players.get(s.id) || state.waitingPlayers.get(s.id);
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

    // Store withdrawal request
    withdrawalRequests.set(userId, {
      amount: amountNum,
      account: account,
      timestamp: Date.now()
    });

    // Deduct balance immediately
    userBalances.set(userId, currentBalance - amountNum);

    // Notify client of balance update
    const playerSocket = Array.from(io.sockets.sockets.values()).find(s => {
      const stake = socketRooms.get(s.id);
      if (!stake) return false;
      const state = getGameState(stake);
      const player = state.players.get(s.id) || state.waitingPlayers.get(s.id);
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

    // All checks passed
    transactionIds.add(transactionId.toUpperCase());
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

    // ✅ Welcome Bonus: start new users with 100 Birr
    userBalances.set(userId, 100);

    // Create session
    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    userSessions.set(token, { userId, username: usernameLower, expiresAt });

    console.log(`User signed up: ${usernameLower} (${userId}) -> Welcome bonus applied: 100 Birr`);

    res.json({
      success: true,
      userId,
      username: usernameLower,
      token,
      balance: 100, // optional: helps client show it instantly
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

// API endpoint to get all bet houses status
app.get('/api/bet-houses', (_req, res) => {
  res.json({ success: true, betHouses: getAllBetHousesStatus() });
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Win Bingo server running',
    betHouses: getAllBetHousesStatus()
  });
});
// ... (keep your existing imports and Bingo code) ...

// --- GLOBAL KENO STATE ---
let kenoState = {
  phase: 'BETTING', // 'BETTING' or 'DRAWING'
  countdown: 30,
  drawResult: [],
  currentBallIndex: 0,
  timer: null
};

// Function to run the Keno Loop
function startKenoLoop() {
  setInterval(() => {
    if (kenoState.phase === 'BETTING') {
      kenoState.countdown--;
      
      // Broadcast time to all Keno players
      io.emit('keno_tick', { 
        phase: kenoState.phase, 
        seconds: kenoState.countdown 
      });

      if (kenoState.countdown <= 0) {
        // Start Drawing Phase
        kenoState.phase = 'DRAWING';
        kenoState.countdown = 0;
        
        // Generate 20 unique numbers once for everyone
        const pool = Array.from({ length: 80 }, (_, i) => i + 1);
        kenoState.drawResult = [];
        for (let i = 0; i < 20; i++) {
          const idx = Math.floor(Math.random() * pool.length);
          kenoState.drawResult.push(pool.splice(idx, 1)[0]);
        }
        
        kenoState.currentBallIndex = 0;
        io.emit('keno_phase', { phase: 'DRAWING' });
        runKenoDrawing();
      }
    }
  }, 1000);
}

function runKenoDrawing() {
  const drawInterval = setInterval(() => {
    if (kenoState.currentBallIndex < 20) {
      const ball = kenoState.drawResult[kenoState.currentBallIndex];
      io.emit('keno_ball', { ball, index: kenoState.currentBallIndex });
      kenoState.currentBallIndex++;
    } else {
      clearInterval(drawInterval);
      // Wait 5 seconds to show results then reset to betting
      setTimeout(() => {
        kenoState.phase = 'BETTING';
        kenoState.countdown = 30;
        io.emit('keno_phase', { phase: 'BETTING', lastDraw: kenoState.drawResult });
      }, 5000);
    }
  }, 1000); // Ball speed
}

// Start the loop when server starts
startKenoLoop();

// Update your Socket Connection handler to send initial state
io.on('connection', (socket) => {
  // ... existing code ...
  
  // Send current Keno status so joiners know if a game is in progress
  socket.emit('keno_init', {
    phase: kenoState.phase,
    seconds: kenoState.countdown,
    currentBalls: kenoState.drawResult.slice(0, kenoState.currentBallIndex)
  });
});

// ... (Rest of your Bingo/Auth code)
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
  // Initialize countdowns for all bet houses
  AVAILABLE_STAKES.forEach(stake => {
    const state = getGameState(stake);
    if (!state.timer && state.phase === 'lobby') {
      startCountdown(stake);
    }
  });
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