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

// ============ ADMIN BOT CONFIGURATION ============
const ADMIN_BOT_ID = 'ADMIN_BOT_SYSTEM';
const ADMIN_BOT_USERNAME = 'HousePlayer';
const ADMIN_BOT_SOCKET_ID = 'admin-bot-virtual-socket';
const ADMIN_BOT_BOARD_COUNT = 10;
const REAL_PLAYER_THRESHOLD_MIN = 2;
const REAL_PLAYER_THRESHOLD_MAX = 50;

// ============ BOARD GENERATION ============
function generateBoardGrid(boardId) {
  let seed = boardId * 9973;

  const seededRandom = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const grid = [];
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 }
  ];

  const columns = [];
  for (let c = 0; c < 5; c++) {
    const colNums = new Set();
    while (colNums.size < 5) {
      const num = Math.floor(seededRandom() * (ranges[c].max - ranges[c].min + 1)) + ranges[c].min;
      colNums.add(num);
    }
    columns.push(Array.from(colNums));
  }

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) {
        grid.push(-1); // FREE space
      } else {
        grid.push(columns[c][r]);
      }
    }
  }

  return grid;
}

function getBoardLines(boardId) {
  const grid = generateBoardGrid(boardId);
  const lines = [];

  // Rows
  for (let r = 0; r < 5; r++) {
    const indices = [r * 5, r * 5 + 1, r * 5 + 2, r * 5 + 3, r * 5 + 4];
    const numbers = indices.map(i => grid[i]);
    lines.push({ indices, numbers });
  }

  // Columns
  for (let c = 0; c < 5; c++) {
    const indices = [c, c + 5, c + 10, c + 15, c + 20];
    const numbers = indices.map(i => grid[i]);
    lines.push({ indices, numbers });
  }

  // Diagonals
  const diag1 = [0, 6, 12, 18, 24];
  const diag2 = [4, 8, 12, 16, 20];
  lines.push({ indices: diag1, numbers: diag1.map(i => grid[i]) });
  lines.push({ indices: diag2, numbers: diag2.map(i => grid[i]) });

  return lines;
}

/**
 * Checks a board for a win.
 * @param {number} boardId 
 * @param {number[]} calledNumbers 
 * @param {boolean} strict - If true, requires the winning line to contain the LAST called number.
 */
function checkBoardForWin(boardId, calledNumbers, strict = true) {
  if (!Array.isArray(calledNumbers) || calledNumbers.length === 0) {
    return { hasWin: false, lineIndices: null, lineNumbers: null };
  }

  const lastCalled = calledNumbers[calledNumbers.length - 1];
  const calledSet = new Set(calledNumbers);
  const lines = getBoardLines(boardId);

  for (const line of lines) {
    // If strict mode is on, skip lines that don't include the most recent number
    if (strict && !line.numbers.includes(lastCalled)) {
      continue;
    }

    const isComplete = line.numbers.every(num => num === -1 || calledSet.has(num));
    if (isComplete) {
      return {
        hasWin: true,
        lineIndices: line.indices,
        lineNumbers: line.numbers
      };
    }
  }

  return { hasWin: false, lineIndices: null, lineNumbers: null };
}

function checkAdminBotForWin(adminState, calledNumbers) {
  for (const boardId of adminState.picks) {
    // Pass 'false' for strict mode. This ensures the bot wins if it has ANY full line,
    // even if it missed the specific turn the line was completed.
    const result = checkBoardForWin(boardId, calledNumbers, false);
    if (result.hasWin) {
      return {
        hasWin: true,
        boardId,
        lineIndices: result.lineIndices,
        lineNumbers: result.lineNumbers
      };
    }
  }
  return { hasWin: false };
}

// ============ ADMIN BOT STATE ============
const adminBotStates = new Map();

function initAdminBotState() {
  return {
    isActive: false,
    picks: [],
    shouldWin: false
  };
}

AVAILABLE_STAKES.forEach(stake => {
  adminBotStates.set(stake, initAdminBotState());
});

function getAdminBotState(stake) {
  if (!adminBotStates.has(stake)) {
    adminBotStates.set(stake, initAdminBotState());
  }
  return adminBotStates.get(stake);
}

// ============ GAME STATE ============
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

// ============ USER DATA ============
const users = new Map();
const userSessions = new Map();
const userIdToUsername = new Map();
const userBalances = new Map();
const transactionIds = new Set();
const withdrawalRequests = new Map();

// ============ KENO ============
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

// ============ AUTH HELPERS ============
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

// ============ GAME HELPERS ============
function getOnlinePlayers(state) {
  return Array.from(state.players.values());
}

function getRealPlayerBoardCount(state) {
  let totalBoards = 0;
  state.players.forEach((player, socketId) => {
    if (socketId !== ADMIN_BOT_SOCKET_ID && Array.isArray(player.picks)) {
      totalBoards += player.picks.length;
    }
  });
  return totalBoards;
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

function getAvailableBoards(state) {
  const available = [];
  for (let i = 1; i <= 100; i++) {
    if (!state.takenBoards.has(i)) {
      available.push(i);
    }
  }
  return available;
}

function selectRandomBoards(available, count) {
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ============ ADMIN BOT FUNCTIONS ============
function addAdminBotToGame(stake) {
  const state = getGameState(stake);
  const adminState = getAdminBotState(stake);
  
  const realPlayerBoards = getRealPlayerBoardCount(state);
  
  if (realPlayerBoards < REAL_PLAYER_THRESHOLD_MIN) {
    removeAdminBotFromGame(stake);
    return;
  }
  
  if (realPlayerBoards > REAL_PLAYER_THRESHOLD_MAX) {
    removeAdminBotFromGame(stake);
    return;
  }
  
  const availableBoards = getAvailableBoards(state);
  
  if (availableBoards.length < ADMIN_BOT_BOARD_COUNT) {
    removeAdminBotFromGame(stake);
    return;
  }
  
  const selectedBoards = selectRandomBoards(availableBoards, ADMIN_BOT_BOARD_COUNT);
  
  const adminPlayer = {
    id: ADMIN_BOT_SOCKET_ID,
    oderId: ADMIN_BOT_ID,
    name: ADMIN_BOT_USERNAME,
    stake: stake,
    picks: selectedBoards,
    ready: true,
    isAdminBot: true
  };
  
  state.players.set(ADMIN_BOT_SOCKET_ID, adminPlayer);
  selectedBoards.forEach(boardId => state.takenBoards.add(boardId));
  
  adminState.isActive = true;
  adminState.picks = selectedBoards;
  adminState.shouldWin = true;
  
  console.log(`[ADMIN BOT] Joined ${stake} Birr room with boards: ${selectedBoards.join(', ')}`);
  
  selectedBoards.forEach(boardId => {
    const grid = generateBoardGrid(boardId);
    console.log(`[ADMIN BOT] Board ${boardId} grid: ${grid.join(',')}`);
  });
  
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
}

function removeAdminBotFromGame(stake) {
  const state = getGameState(stake);
  const adminState = getAdminBotState(stake);
  
  if (!adminState.isActive) return;
  
  const adminPlayer = state.players.get(ADMIN_BOT_SOCKET_ID);
  
  if (adminPlayer && Array.isArray(adminPlayer.picks)) {
    adminPlayer.picks.forEach(boardId => state.takenBoards.delete(boardId));
  }
  
  state.players.delete(ADMIN_BOT_SOCKET_ID);
  
  adminState.isActive = false;
  adminState.picks = [];
  adminState.shouldWin = false;
  
  console.log(`[ADMIN BOT] Removed from ${stake} Birr room`);
  
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
}

function checkAndUpdateAdminBot(stake) {
  const state = getGameState(stake);
  const adminState = getAdminBotState(stake);
  const realPlayerBoards = getRealPlayerBoardCount(state);
  
  console.log(`[ADMIN BOT CHECK] Stake: ${stake}, Real boards: ${realPlayerBoards}, Admin active: ${adminState.isActive}`);
  
  if (realPlayerBoards >= REAL_PLAYER_THRESHOLD_MIN && realPlayerBoards <= REAL_PLAYER_THRESHOLD_MAX) {
    if (!adminState.isActive) {
      addAdminBotToGame(stake);
    }
  } else {
    if (adminState.isActive) {
      removeAdminBotFromGame(stake);
    }
  }
}

function triggerAdminBotWin(stake, boardId, lineIndices, lineNumbers) {
  const state = getGameState(stake);
  const adminState = getAdminBotState(stake);
  const roomId = state.roomId;
  
  if (!adminState.isActive) {
    console.log('[ADMIN BOT] Cannot trigger win - not active');
    return;
  }
  
  const prize = computePrizePool(state);
  
  console.log(`[ADMIN BOT] Won in ${stake} Birr room!`);
  console.log(`[ADMIN BOT] Board: ${boardId}, Line indices: ${lineIndices.join(',')}`);
  console.log(`[ADMIN BOT] Line numbers: ${lineNumbers.join(',')}`);
  console.log(`[ADMIN BOT] Called numbers: ${state.called.join(',')}`);
  console.log(`[ADMIN BOT] Prize: ${prize}`);
  
  io.to(roomId).emit('winner', { 
    playerId: ADMIN_BOT_SOCKET_ID, 
    playerName: ADMIN_BOT_USERNAME,
    isSystemPlayer: true,
    prize, 
    stake, 
    boardId, 
    lineIndices,
    lineNumbers
  });

  clearInterval(state.caller);
  clearInterval(state.timer);

  state.players.clear();
  state.waitingPlayers.forEach((waitingPlayer, socketId) => {
    waitingPlayer.picks = [];
    waitingPlayer.ready = false;
    state.players.set(socketId, waitingPlayer);
  });
  state.waitingPlayers.clear();
  state.takenBoards = new Set();

  adminState.isActive = false;
  adminState.picks = [];
  adminState.shouldWin = false;

  state.phase = 'lobby';
  io.to(roomId).emit('phase', { phase: state.phase, stake });
  io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

  setTimeout(() => {
    startCountdown(stake);
  }, 3000);
}

// ============ GAME FLOW ============
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

function startCountdown(stake) {
  const state = getGameState(stake);
  const roomId = state.roomId;

  clearInterval(state.timer);
  clearInterval(state.caller);
  
  state.phase = 'countdown';
  state.countdown = COUNTDOWN_SECONDS;
  state.called = [];

  state.waitingPlayers.forEach((player, socketId) => {
    state.players.set(socketId, player);
    state.waitingPlayers.delete(socketId);
  });

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
    
    if (state.countdown % 10 === 0 && state.countdown > 5) {
      checkAndUpdateAdminBot(stake);
    }
    
    if (state.countdown === 5) {
      const realPlayerBoards = getRealPlayerBoardCount(state);
      const adminState = getAdminBotState(stake);
      
      if (realPlayerBoards > REAL_PLAYER_THRESHOLD_MAX && adminState.isActive) {
        console.log(`[ADMIN BOT] Removing - Real players (${realPlayerBoards}) exceed threshold`);
        removeAdminBotFromGame(stake);
      } else if (realPlayerBoards < REAL_PLAYER_THRESHOLD_MIN && adminState.isActive) {
        console.log(`[ADMIN BOT] Removing - Not enough real players (${realPlayerBoards})`);
        removeAdminBotFromGame(stake);
      } else if (realPlayerBoards >= REAL_PLAYER_THRESHOLD_MIN && 
                 realPlayerBoards <= REAL_PLAYER_THRESHOLD_MAX && 
                 !adminState.isActive) {
        addAdminBotToGame(stake);
      }
    }
    
    io.to(roomId).emit('tick', {
      seconds: state.countdown,
      players: getTotalSelectedBoards(state),
      prize: computePrizePool(state),
      stake: state.stake
    });

    if (state.countdown <= 0) {
      clearInterval(state.timer);
      const playersWithBoards = getOnlinePlayers(state).filter(
        p => Array.isArray(p.picks) && p.picks.length > 0
      );
      if (playersWithBoards.length > 0) {
        startCalling(stake);
      } else {
        const adminState = getAdminBotState(stake);
        if (adminState.isActive) {
          removeAdminBotFromGame(stake);
        }
        
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
  const adminState = getAdminBotState(stake);

  state.phase = 'calling';
  io.to(roomId).emit('phase', { phase: state.phase, stake });
  io.to(roomId).emit('game_start', { stake });

  const numbers = [];
  for (let i = 1; i <= 75; i++) numbers.push(i);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }

  let idx = 0;
  let gameEnded = false;
  
  clearInterval(state.caller);
  state.caller = setInterval(() => {
    if (gameEnded) return;
    
    if (idx >= numbers.length) {
      clearInterval(state.caller);
      gameEnded = true;
      
      if (adminState.isActive && adminState.shouldWin) {
        const winResult = checkAdminBotForWin(adminState, state.called);
        if (winResult.hasWin) {
          triggerAdminBotWin(stake, winResult.boardId, winResult.lineIndices, winResult.lineNumbers);
          return;
        }
      }
      
      state.phase = 'lobby';
      io.to(roomId).emit('phase', { phase: state.phase, stake });

      state.players.clear();
      state.waitingPlayers.forEach((player, socketId) => {
        state.players.set(socketId, player);
        state.waitingPlayers.delete(socketId);
      });

      adminState.isActive = false;
      adminState.picks = [];
      adminState.shouldWin = false;

      startCountdown(stake);
      return;
    }
    
    const n = numbers[idx++];
    state.called.push(n);
    io.to(roomId).emit('call', { number: n, called: state.called, stake });
    
    if (adminState.isActive && adminState.shouldWin && !gameEnded) {
      const winResult = checkAdminBotForWin(adminState, state.called);
      if (winResult.hasWin) {
        console.log(`[ADMIN BOT] Valid bingo detected after ${state.called.length} calls!`);
        gameEnded = true;
        
        setTimeout(() => {
          triggerAdminBotWin(stake, winResult.boardId, winResult.lineIndices, winResult.lineNumbers);
        }, 500);
      }
    }
    
  }, CALL_INTERVAL_MS);
}

// ============ KENO STATE ============
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

startKenoLoop();

// ============ SOCKET HANDLERS ============
const socketRooms = new Map();

io.on('connection', (socket) => {
  const auth = socket.handshake.auth;
  const userId = auth?.userId;
  const username = auth?.username;
  const token = auth?.token;

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

  if (socket.userId) {
    if (!userBalances.has(socket.userId)) {
      userBalances.set(socket.userId, 0);
    }
    socket.emit('balance_update', { balance: userBalances.get(socket.userId) || 0 });
  }

  socket.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

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

  socket.on('join_bet_house', (stakeAmount) => {
    const stake = Number(stakeAmount);
    if (!AVAILABLE_STAKES.includes(stake)) {
      socket.emit('error', { message: 'Invalid stake amount' });
      return;
    }

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
      
      checkAndUpdateAdminBot(previousStake);
      
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

    if (Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.delete(boardId));
    }

    const uniquePicks = Array.from(new Set(picks));
    const availablePicks = uniquePicks.filter(boardId => !state.takenBoards.has(boardId));
    availablePicks.forEach(boardId => state.takenBoards.add(boardId));
    player.picks = availablePicks;

    if (state.phase === 'countdown') {
      checkAndUpdateAdminBot(stake);
    }

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

    checkAndUpdateAdminBot(stake);

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
    if (player.oderId === ADMIN_BOT_ID) return;

    const boardId = data?.boardId;
    if (!boardId || !player.picks.includes(boardId)) return;

    // Strict mode for real players (default is true)
    const result = checkBoardForWin(boardId, state.called, true);

    if (!result.hasWin) {
      socket.emit('bingo_invalid', {
        success: false,
        message: 'No valid winning line detected. A winning line must include the most recently called number.',
        stake
      });
      return;
    }

    const prize = computePrizePool(state);
    
    io.to(roomId).emit('winner', {
      playerId: socket.id,
      playerName: player.name || 'Player',
      isSystemPlayer: false,
      prize,
      stake,
      boardId,
      lineIndices: result.lineIndices,
      lineNumbers: result.lineNumbers
    });

    const winnerBalance = userBalances.get(player.oderId) || 0;
    userBalances.set(player.oderId, winnerBalance + prize);
    socket.emit('balance_update', { balance: userBalances.get(player.oderId) });

    clearInterval(state.caller);
    clearInterval(state.timer);

    state.players.clear();
    state.waitingPlayers.forEach((waitingPlayer, socketId) => {
      waitingPlayer.picks = [];
      waitingPlayer.ready = false;
      state.players.set(socketId, waitingPlayer);
    });
    state.waitingPlayers.clear();
    state.takenBoards = new Set();

    const adminState = getAdminBotState(stake);
    adminState.isActive = false;
    adminState.picks = [];
    adminState.shouldWin = false;

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

    checkAndUpdateAdminBot(stake);

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
    if (kenoOnlinePlayers.has(socket.id)) {
      kenoOnlinePlayers.delete(socket.id);
      io.to('keno_room').emit('keno_online_count', { count: kenoOnlinePlayers.size });
    }

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

      checkAndUpdateAdminBot(stake);

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

// ============ API ROUTES ============
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

app.get('/api/user/balance', requireAuth, (req, res) => {
  const { userId } = req.session;
  const balance = userBalances.get(userId) || 0;
  res.json({ balance });
});

app.get('/api/games/keno/hot-numbers', requireAuth, (req, res) => {
  const numbers = getHotNumbers();
  res.json({ numbers });
});

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

app.post('/api/games/keno/settle', requireAuth, (req, res) => {
  const sessionUserId = req.session.userId;
  const { totalWin } = req.body;

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

app.get('/api/games/keno/state', (req, res) => {
  res.json({
    phase: kenoState.phase,
    seconds: kenoState.countdown,
    gameId: kenoState.gameId,
    currentBallIndex: kenoState.currentBallIndex,
    drawnBalls: kenoState.drawResult.slice(0, kenoState.currentBallIndex)
  });
});

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
      message: 'Withdrawal request processed.'
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.json({ success: false, error: 'Server error processing withdrawal' });
  }
});

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
    userBalances.set(oderId, 100);

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

app.get('/api/debug/board/:boardId', (req, res) => {
  const boardId = parseInt(req.params.boardId);
  if (isNaN(boardId) || boardId < 1) {
    return res.json({ error: 'Invalid board ID' });
  }
  
  const grid = generateBoardGrid(boardId);
  const lines = getBoardLines(boardId);
  
  res.json({
    boardId,
    grid,
    lines: lines.map(l => ({
      indices: l.indices,
      numbers: l.numbers
    }))
  });
});

app.get('/api/admin/bot-status', (req, res) => {
  const status = {};
  AVAILABLE_STAKES.forEach(stake => {
    const adminState = getAdminBotState(stake);
    const gameState = getGameState(stake);
    
    let currentWinStatus = null;
    if (adminState.isActive && gameState.called.length > 0) {
      const winResult = checkAdminBotForWin(adminState, gameState.called);
      currentWinStatus = winResult;
    }
    
    status[stake] = {
      isActive: adminState.isActive,
      picks: adminState.picks,
      realPlayerBoards: getRealPlayerBoardCount(gameState),
      totalBoards: getTotalSelectedBoards(gameState),
      phase: gameState.phase,
      calledCount: gameState.called.length,
      currentWinStatus
    };
  });
  res.json({ success: true, adminBotStatus: status });
});

app.get('/api/bet-houses', (_req, res) => {
  res.json({ success: true, betHouses: getAllBetHousesStatus() });
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Win Bingo server running',
    betHouses: getAllBetHousesStatus()
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of userSessions.entries()) {
    if (session.expiresAt < now) {
      userSessions.delete(token);
    }
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🎰 Win Bingo Server Started`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🤖 Admin Bot: ${ADMIN_BOT_BOARD_COUNT} boards, activates at ${REAL_PLAYER_THRESHOLD_MIN}-${REAL_PLAYER_THRESHOLD_MAX} real boards`);
  console.log(`🎲 Stakes: ${AVAILABLE_STAKES.join(', ')} Birr\n`);
  
  AVAILABLE_STAKES.forEach(stake => {
    const state = getGameState(stake);
    if (!state.timer && state.phase === 'lobby') {
      startCountdown(stake);
    }
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use!`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});