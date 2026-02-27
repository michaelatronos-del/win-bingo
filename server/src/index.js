import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Add near the top with other imports
import bot from './telegram-bot.js';

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
const AVAILABLE_STAKES = [5, 10, 20, 50, 100, 200, 500];

const gameStates = new Map();

/* ---- SYSTEM PLAYER LOGIC ---- */
const SYSTEM_PLAYER_NAMES = [
  'Sami', 'Yoni', 'Nahome', 'Miki', 'Selam', 'Bini', 'Hana', 'Dani', 'Biruk',
  'Rahel', 'Martha', 'David', 'Asmara', 'Kale', 'Liya', 'Nelson', 'Robel',
  'Betty', 'Abel', 'Ruth'
];
const SYSTEM_PLAYERS_TEMPLATE = SYSTEM_PLAYER_NAMES.map((name, idx) => ({
  id: `system_${idx}`,
  oderId: `system_${idx}`,
  name,
  stake: null,
  picks: [],
  ready: false,
  isSystemPlayer: true,
  userId: `system_${idx}`,
  markedNumbers: new Set(),
}));

/* --- BOARD LOGIC (simple, deterministic) --- */
const BOARD_GRIDS = {};
function getBoard(boardId) {
  if (!BOARD_GRIDS[boardId]) {
    // Generates a deterministic but unique 5x5 grid for each boardId.
    const numbers = Array.from({ length: 75 }, (_, i) => i + 1);
    let offset = ((boardId - 1) * 5) % numbers.length;
    const grid = [];
    for (let i = 0; i < 25; ++i) {
      grid.push(numbers[(offset + i) % numbers.length]);
    }
    // Center is free space for bingo:
    grid[12] = -1;
    BOARD_GRIDS[boardId] = grid;
  }
  return BOARD_GRIDS[boardId];
}
function didBingo(board, marks, lastCall) {
  for (let i = 0; i < 5; ++i) {
    const row = board.slice(i * 5, i * 5 + 5);
    if (row.includes(lastCall) && row.every(n => n === -1 || marks.has(n))) return true;
    const col = [];
    for (let j = 0; j < 5; ++j) col.push(board[j * 5 + i]);
    if (col.includes(lastCall) && col.every(n => n === -1 || marks.has(n))) return true;
  }
  const diag1 = [0, 6, 12, 18, 24].map(i => board[i]);
  const diag2 = [4, 8, 12, 16, 20].map(i => board[i]);
  if (
    (diag1.includes(lastCall) && diag1.every(n => n === -1 || marks.has(n))) ||
    (diag2.includes(lastCall) && diag2.every(n => n === -1 || marks.has(n)))
  )
    return true;
  return false;
}
function getWinningLine(board, marks, lastCall) {
  for (let i = 0; i < 5; ++i) {
    const rowIdxs = [0, 1, 2, 3, 4].map(j => i * 5 + j);
    const rowVals = rowIdxs.map(idx => board[idx]);
    if (rowVals.includes(lastCall) && rowVals.every(n => n === -1 || marks.has(n))) return rowIdxs;
    const colIdxs = [0, 1, 2, 3, 4].map(j => j * 5 + i);
    const colVals = colIdxs.map(idx => board[idx]);
    if (colVals.includes(lastCall) && colVals.every(n => n === -1 || marks.has(n))) return colIdxs;
  }
  const diag1Idxs = [0, 6, 12, 18, 24];
  const diag1Vals = diag1Idxs.map(idx => board[idx]);
  if (diag1Vals.includes(lastCall) && diag1Vals.every(n => n === -1 || marks.has(n))) return diag1Idxs;
  const diag2Idxs = [4, 8, 12, 16, 20];
  const diag2Vals = diag2Idxs.map(idx => board[idx]);
  if (diag2Vals.includes(lastCall) && diag2Vals.every(n => n === -1 || marks.has(n))) return diag2Idxs;
  return [];
}

/* ---- ROOM CREATION: Add system players ---- */
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
    systemPlayers: SYSTEM_PLAYERS_TEMPLATE.map(p => ({
      ...p,
      stake,
      picks: [],
      ready: false,
      markedNumbers: new Set(),
    }))
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

const users = new Map();
const userSessions = new Map();
const userIdToUsername = new Map();
const userBalances = new Map();
const userBonuses = new Map();
const transactionIds = new Set();
const withdrawalRequests = new Map();

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

  state.waitingPlayers.forEach((player, socketId) => {
    state.players.set(socketId, player);
    state.waitingPlayers.delete(socketId);
  });

  // -------------- SYSTEM PLAYERS ACTIVATION --------------
  const realPlayersWithBoards = Array.from(state.players.values()).filter(
    p => !p.isSystemPlayer && Array.isArray(p.picks) && p.picks.length > 0
  );
  if (realPlayersWithBoards.length >= 2) {
    state.systemPlayers.forEach(sp => {
      if (!sp.ready) {
        const taken = new Set(state.takenBoards);
        const availableBoards = [];
        for (let i = 1; i <= BOARD_SIZE; ++i) {
          if (!taken.has(i)) availableBoards.push(i);
        }
        const n = Math.random() < 0.33 ? 1 : 2;
        sp.picks = [];
        for (let k = 0; k < n; ++k) {
          if (availableBoards.length === 0) break;
          const idx = Math.floor(Math.random() * availableBoards.length);
          sp.picks.push(availableBoards.splice(idx, 1)[0]);
        }
        sp.ready = true;
        sp.markedNumbers = new Set();
        sp.picks.forEach(bid => state.takenBoards.add(bid));
      }
    });
    state.systemPlayers.forEach(sp => {
      state.players.set(sp.id, sp);
    });
  }

  state.takenBoards = new Set();
  state.players.forEach(player => {
    if (Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.add(boardId));
    }
  });

  io.to(state.roomId).emit('phase', { phase: state.phase, stake });
  io.to(state.roomId).emit('tick', {
    seconds: state.countdown,
    players: getTotalSelectedBoards(state),
    prize: computePrizePool(state),
    stake: state.stake,
  });

  state.timer = setInterval(() => {
    state.countdown -= 1;
    io.to(state.roomId).emit('tick', {
      seconds: state.countdown,
      players: getTotalSelectedBoards(state),
      prize: computePrizePool(state),
      stake: state.stake,
    });

    if (state.countdown <= 0) {
      clearInterval(state.timer);
      const playersWithBoards = getOnlinePlayers(state).filter(
        p => Array.isArray(p.picks) && p.picks.length > 0
      );
      if (playersWithBoards.length > 0) {
        startCalling(stake);
      } else {
        state.phase = 'lobby';
        io.to(state.roomId).emit('phase', { phase: state.phase, stake });
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

  // Update stats for each player
  state.players.forEach(player => {
    const userId = player.oderId;
    const username = userIdToUsername.get(userId);
    if (username) {
      const user = users.get(username);
      if (user) {
        user.gamesPlayed = (user.gamesPlayed || 0) + 1;
        const socket = io.sockets.sockets.get(player.id);
        if (socket) {
          socket.emit('balance_update', {
            balance: userBalances.get(userId),
            bonus: userBonuses.get(userId),
            gamesPlayed: user.gamesPlayed,
          });
        }
      }
    }
  });

  const numbers = [];
  for (let i = 1; i <= 75; i++) numbers.push(i);

  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }

  let idx = 0;
  clearInterval(state.caller);

  state.caller = setInterval(() => {
    if (idx >= numbers.length) {
      clearInterval(state.caller);
      state.phase = 'lobby';
      io.to(roomId).emit('phase', { phase: state.phase, stake });
      state.players.clear();
      state.waitingPlayers.forEach((player, socketId) => {
        state.players.set(socketId, player);
        state.waitingPlayers.delete(socketId);
      });
      state.systemPlayers.forEach(p => { p.picks = []; p.ready = false; p.markedNumbers = new Set(); });
      startCountdown(stake);
      return;
    }
    const n = numbers[idx++];
    state.called.push(n);

    // --- SYSTEM PLAYERS MARK CALLED NUMBERS ---
    state.systemPlayers.forEach(sp => {
      if (!sp.isSystemPlayer || !sp.ready) return;
      if (!sp.markedNumbers) sp.markedNumbers = new Set();
      sp.picks.forEach(boardId => {
        sp.markedNumbers.add(n);
      });
    });

    io.to(roomId).emit('call', { number: n, called: state.called, stake });

    // --- SYSTEM PLAYER BINGO CHECK ---
    for (const sp of state.systemPlayers) {
      if (!sp.isSystemPlayer || !sp.ready) continue;
      for (const boardId of sp.picks) {
        const board = getBoard(boardId);
        if (!board) continue;
        if (didBingo(board, sp.markedNumbers, n)) {
          const prize = computePrizePool(state);
          io.to(roomId).emit('winner', {
            playerId: sp.id,
            prize,
            stake,
            boardId,
            lineIndices: getWinningLine(board, sp.markedNumbers, n),
            systemPlayer: true,
            name: sp.name,
          });

          clearInterval(state.caller);
          clearInterval(state.timer);

          state.players.clear();
          state.systemPlayers.forEach(p => {
            p.picks = []; p.ready = false; p.markedNumbers = new Set();
          });
          state.takenBoards = new Set();
          state.phase = 'lobby';
          io.to(roomId).emit('phase', { phase: state.phase, stake });
          io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

          startCountdown(stake);
          return;
        }
      }
    }
  }, CALL_INTERVAL_MS);
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
      prevState.players.delete(socket.id);
      prevState.waitingPlayers.delete(socket.id);
      io.to(prevRoomId).emit('players', {
        count: getOnlinePlayers(prevState).length,
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
      isWaiting: state.phase === 'calling',
      // Send current balances on join
      balance: userBalances.get(socket.userId) || 0,
      bonus: userBonuses.get(socket.userId) || 0
    });

    io.to(roomId).emit('players', {
      count: getTotalSelectedBoards(state),
      waitingCount: state.waitingPlayers.size,
      stake: stake
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

    // CHECK BALANCE + BONUS
    const currentBalance = userBalances.get(socket.userId) || 0;
    const currentBonus = userBonuses.get(socket.userId) || 0;
    
    // Logic: Is Total Funds enough? (Frontend handles this, but backend should too)
    // Note: Deductions happen when game starts or winner declared? 
    // Usually bingo deducts on start. For simplicity in this codebase, assuming balance check passed.

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

    const boardId = data?.boardId;
    const lineIndices = Array.isArray(data?.lineIndices) ? data.lineIndices : undefined;

    const prize = computePrizePool(state);
    io.to(roomId).emit('winner', { playerId: socket.id, prize, stake, boardId, lineIndices });

    // Winner gets money in WALLET (Winnings)
    const winnerBalance = userBalances.get(player.userId) || 0;
    userBalances.set(player.userId, winnerBalance + prize);
    
    // Emit update with both values
    socket.emit('balance_update', { 
      balance: userBalances.get(player.userId),
      bonus: userBonuses.get(player.userId) || 0
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
      count: getOnlinePlayers(state).length,
      waitingCount: state.waitingPlayers.size,
      stake,
    });

    io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });
    io.to(roomId).emit('boards_taken', {
      stake,
      takenBoards: Array.from(state.takenBoards),
    });
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

      io.to(roomId).emit('players', {
        count: getTotalSelectedBoards(state),
        waitingCount: state.waitingPlayers.size,
        stake: stake
      });

      io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });

      io.to(roomId).emit('boards_taken', {
        stake,
        takenBoards: Array.from(state.takenBoards),
      });
    }
  });
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

app.get('/api/user/balance', requireAuth, (req, res) => {
  const { userId } = req.session;
  const balance = userBalances.get(userId) || 0;
  const bonus = userBonuses.get(userId) || 0;
  
  const username = userIdToUsername.get(userId);
  const user = username ? users.get(username) : null;
  const gamesPlayed = user ? (user.gamesPlayed || 0) : 0;

  res.json({ balance, bonus, gamesPlayed });
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

  // UPDATED BETTING LOGIC: Check balance + bonus
  const currentWallet = userBalances.get(sessionUserId) || 0;
  const currentBonus = userBonuses.get(sessionUserId) || 0;
  const totalFunds = currentWallet + currentBonus;

  if (totalFunds < amountNum) {
    return res.json({ success: false, error: 'Insufficient funds' });
  }

  if (!Array.isArray(picks) || picks.length < 2 || picks.length > 10) {
    return res.json({ success: false, error: 'Invalid number of picks (2-10 required)' });
  }

  const validPicks = picks.every(p => Number.isInteger(p) && p >= 1 && p <= 80);
  if (!validPicks) {
    return res.json({ success: false, error: 'Invalid picks (must be 1-80)' });
  }

  // Deduct Logic: Wallet first, then Bonus? Or Bonus first?
  // Let's deduct from Wallet first, then Bonus if wallet is empty/insufficient
  let remainingCost = amountNum;
  
  if (currentWallet >= remainingCost) {
    userBalances.set(sessionUserId, currentWallet - remainingCost);
    remainingCost = 0;
  } else {
    // Wallet has some, but not enough
    userBalances.set(sessionUserId, 0); // Empty wallet
    remainingCost -= currentWallet;
    // Deduct rest from bonus
    userBonuses.set(sessionUserId, currentBonus - remainingCost);
  }

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
    newBalance: userBalances.get(sessionUserId), // Return updated wallet
    newBonus: userBonuses.get(sessionUserId),    // Return updated bonus
    ticketId: ticketId,
    gameId: kenoState.gameId
  });
});

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

app.get('/api/games/keno/state', (req, res) => {
  res.json({
    phase: kenoState.phase,
    seconds: kenoState.countdown,
    gameId: kenoState.gameId,
    currentBallIndex: kenoState.currentBallIndex,
    drawnBalls: kenoState.drawResult.slice(0, kenoState.currentBallIndex)
  });
});

/* =======================
   Telegram API endpoints
======================= */

// Check if user exists
app.post('/api/telegram/check-user', async (req, res) => {
  try {
    const { telegramId } = req.body;

    if (!telegramId) {
      return res.json({ success: false, error: 'Telegram ID required' });
    }

    const tgId = String(telegramId);

    let foundUser = null;
    let foundToken = null;

    for (const [username, userData] of users.entries()) {
      if (String(userData.telegramId || '') === tgId) {
        foundUser = userData;

        for (const [token, session] of userSessions.entries()) {
          if (session.userId === userData.userId) {
            foundToken = token;
            break;
          }
        }
        break;
      }
    }

    if (foundUser) {
      return res.json({
        success: true,
        exists: true,
        userId: foundUser.userId,
        token: foundToken,
        language: foundUser.language || 'en'
      });
    }

    res.json({ success: true, exists: false });
  } catch (error) {
    console.error('Check user error:', error);
    res.json({ success: false, error: 'Server error' });
  }
});

// Register Telegram user
app.post('/api/telegram/register', async (req, res) => {
  try {
    const { telegramId, username, phoneNumber, firstName, lastName, language } = req.body;

    console.log('📝 Telegram Registration attempt:', { 
      telegramId, 
      username, 
      phoneNumber: phoneNumber ? '***' + phoneNumber.slice(-4) : 'missing',
      firstName,
      language 
    });

    if (!telegramId || !phoneNumber) {
      return res.json({ 
        success: false, 
        error: 'Missing required fields (telegramId or phoneNumber)', 
      });
    }

    const tgId = String(telegramId);

    // Check if user already exists
    const existingUser = Array.from(users.entries()).find(
      ([_, data]) => String(data.telegramId || '') === tgId
    );
    
    if (existingUser) {
      console.log('⚠️ User already registered:', tgId);
      return res.json({ success: false, error: 'User already registered' });
    }

    // Create username
    let baseUsername = (username || '').trim();
    if (!baseUsername) {
      baseUsername = (firstName || 'player').toString();
    }
    let usernameLower = baseUsername.trim().toLowerCase();

    // If username already exists (collision), make it unique
    if (users.has(usernameLower)) {
      usernameLower = `${usernameLower}_${tgId.slice(-6)}`;
    }

    const userId = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(phoneNumber); // Use phone as password

    // Initialize gamesPlayed to 0
    users.set(usernameLower, {
      userId,
      passwordHash,
      createdAt: Date.now(),
      telegramId: tgId,
      phoneNumber,
      firstName,
      lastName,
      language: language || 'en',
      gamesPlayed: 0
    });

    userIdToUsername.set(userId, usernameLower);
    
    // ----------------------------------------------------
    // FIX: Set Wallet to 0 and Bonus to 30 for Bot Users
    // ----------------------------------------------------
    userBalances.set(userId, 0); 
    userBonuses.set(userId, 30); 

    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    userSessions.set(token, {
      userId,
      username: usernameLower,
      expiresAt,
      telegramId: tgId
    });

    console.log(`✅ Telegram user registered: ${usernameLower} (${userId}) - Wallet: 0, Bonus: 30`);

    res.json({
      success: true,
      userId,
      username: usernameLower,
      token,
      balance: 0,
      bonus: 30
    });
  } catch (error) {
    console.error('❌ Telegram registration error:', error);
    res.json({ 
      success: false, 
      error: 'Server error during registration', 
      details: error.message 
    });
  }
});

// Telegram auto-login endpoint
app.post('/api/telegram/auto-login', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.json({ success: false, error: 'Token required' });
    }

    const session = userSessions.get(token);

    if (!session) {
      return res.json({ success: false, error: 'Invalid token' });
    }

    if (session.expiresAt < Date.now()) {
      userSessions.delete(token);
      return res.json({ success: false, error: 'Token expired' });
    }

    const username = userIdToUsername.get(session.userId);
    // GET BOTH
    const balance = userBalances.get(session.userId) || 0;
    const bonus = userBonuses.get(session.userId) || 0;

    res.json({
      success: true,
      userId: session.userId,
      username,
      token,
      balance,
      bonus // Return bonus
    });
  } catch (error) {
    console.error('Auto-login error:', error);
    res.json({ success: false, error: 'Server error' });
  }
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
    // Deposit goes to Wallet (userBalances)
    userBalances.set(userId, currentBalance + amountNum);
    transactionIds.add(transactionId);

    const playerSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === userId);
    if (playerSocket) {
      playerSocket.emit('balance_update', { 
        balance: userBalances.get(userId),
        bonus: userBonuses.get(userId) || 0
      });
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

    // CHECK 1: Minimum 100 Birr
    if (amountNum < 100) {
      return res.json({ success: false, error: 'Minimum withdrawal amount is 100 Birr.' });
    }

    // CHECK 2: Minimum 10 Games Played
    const username = userIdToUsername.get(userId);
    const user = users.get(username);
    const gamesPlayed = user ? (user.gamesPlayed || 0) : 0;

    if (gamesPlayed < 10) {
      return res.json({ success: false, error: `You must play at least 10 games to withdraw. Played: ${gamesPlayed}` });
    }

    // Only withdraw from Wallet
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
      playerSocket.emit('balance_update', { 
        balance: userBalances.get(userId),
        bonus: userBonuses.get(userId) || 0
      });
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

    const userId = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password);

    // Initialize gamesPlayed to 0
    users.set(usernameLower, {
      userId,
      passwordHash,
      createdAt: Date.now(),
      gamesPlayed: 0
    });

    userIdToUsername.set(userId, usernameLower);
    
    // ----------------------------------------------------
    // FIX: Set Wallet to 0 and Bonus to 30 for Web Users
    // ----------------------------------------------------
    userBalances.set(userId, 0); 
    userBonuses.set(userId, 30); 

    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
    userSessions.set(token, { userId, username: usernameLower, expiresAt });

    console.log(`User signed up: ${usernameLower} (${userId}) -> Welcome bonus applied (Wallet: 0, Bonus: 30)`);

    res.json({
      success: true,
      userId,
      username: usernameLower,
      token,
      balance: 0,
      bonus: 30
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
    userSessions.set(token, { userId: user.userId, username: usernameLower, expiresAt });

    if (!userBalances.has(user.userId)) {
      userBalances.set(user.userId, 0);
    }
    if (!userBonuses.has(user.userId)) {
      userBonuses.set(user.userId, 0);
    }

    console.log(`User logged in: ${usernameLower} (${user.userId})`);

    res.json({
      success: true,
      userId: user.userId,
      username: usernameLower,
      token,
      // Return both on login
      balance: userBalances.get(user.userId) || 0,
      bonus: userBonuses.get(user.userId) || 0
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

    // Return balance/bonus during verify too
    const balance = userBalances.get(userId) || 0;
    const bonus = userBonuses.get(userId) || 0;

    res.json({ success: true, username, balance, bonus });
  } catch (error) {
    console.error('Verify error:', error);
    res.json({ success: false });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of userSessions.entries()) {
    if (session.expiresAt < now) {
      userSessions.delete(token);
    }
  }
}, 60 * 60 * 1000);

app.get('/api/bet-houses', (_req, res) => {
  res.json({ success: true, betHouses: getAllBetHousesStatus() });
});

app.get('/', (_req, res) => {
  res.json({
    message: 'Win Bingo server running',
    betHouses: getAllBetHousesStatus()
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
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
