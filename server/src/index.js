import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
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

const BOARD_SIZE = 100;
const COUNTDOWN_SECONDS = 60;
const CALL_INTERVAL_MS = 5000;
const AVAILABLE_STAKES = [5, 10, 20, 50, 100, 200, 500];

const gameStates = new Map();

/* ---------------- SYSTEM PLAYERS ---------------- */
const SYSTEM_PLAYER_NAMES = [
  'Sami', 'Yoni', 'Nahome', 'Miki', 'Selam', 'Bini', 'Hana', 'Dani', 'Biruk',
  'Rahel', 'Martha', 'David', 'Asmara', 'Kale', 'Liya', 'Nelson', 'Robel',
  'Betty', 'Abel', 'Ruth'
];

const SYSTEM_PLAYERS_TEMPLATE = SYSTEM_PLAYER_NAMES.map((name, idx) => ({
  id: `system_${idx}`,
  oderId: `system_${idx}`,
  userId: `system_${idx}`,
  name,
  stake: null,
  picks: [],
  ready: false,
  isSystemPlayer: true,
  markedNumbers: new Set(),
}));

/* ---------------- BOARD LOGIC (server-side for bots) ---------------- */
const BOARD_GRIDS = {};
function getBoard(boardId) {
  if (!BOARD_GRIDS[boardId]) {
    const numbers = Array.from({ length: 75 }, (_, i) => i + 1);
    const offset = ((boardId - 1) * 7) % numbers.length;
    const grid = [];
    for (let i = 0; i < 25; i++) {
      grid.push(numbers[(offset + i * 3) % numbers.length]);
    }
    grid[12] = -1; // free center
    BOARD_GRIDS[boardId] = grid;
  }
  return BOARD_GRIDS[boardId];
}

function didBingo(board, marks, lastCall) {
  // Check rows
  for (let r = 0; r < 5; r++) {
    const row = [0, 1, 2, 3, 4].map(c => board[r * 5 + c]);
    if (row.includes(lastCall) && row.every(n => n === -1 || marks.has(n))) return true;
  }
  // Check columns
  for (let c = 0; c < 5; c++) {
    const col = [0, 1, 2, 3, 4].map(r => board[r * 5 + c]);
    if (col.includes(lastCall) && col.every(n => n === -1 || marks.has(n))) return true;
  }
  // Check diagonals
  const d1 = [0, 6, 12, 18, 24].map(i => board[i]);
  const d2 = [4, 8, 12, 16, 20].map(i => board[i]);
  if ((d1.includes(lastCall) && d1.every(n => n === -1 || marks.has(n))) ||
      (d2.includes(lastCall) && d2.every(n => n === -1 || marks.has(n)))) return true;
  return false;
}

function getWinningLine(board, marks, lastCall) {
  // Check rows
  for (let r = 0; r < 5; r++) {
    const idxs = [0,1,2,3,4].map(c => r * 5 + c);
    const vals = idxs.map(i => board[i]);
    if (vals.includes(lastCall) && vals.every(n => n === -1 || marks.has(n))) return idxs;
  }
  // Check columns
  for (let c = 0; c < 5; c++) {
    const idxs = [0,1,2,3,4].map(r => r * 5 + c);
    const vals = idxs.map(i => board[i]);
    if (vals.includes(lastCall) && vals.every(n => n === -1 || marks.has(n))) return idxs;
  }
  // Check diagonals
  const d1 = [0,6,12,18,24];
  const d1Vals = d1.map(i => board[i]);
  if (d1Vals.includes(lastCall) && d1Vals.every(n => n === -1 || marks.has(n))) return d1;
  const d2 = [4,8,12,16,20];
  const d2Vals = d2.map(i => board[i]);
  if (d2Vals.includes(lastCall) && d2Vals.every(n => n === -1 || marks.has(n))) return d2;
  return [];
}

/* ---------------- GAME STATE ---------------- */
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
    })),
    botsActivated: false,
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

/* ---------------- USERS / WALLET ---------------- */
const users = new Map();
const userSessions = new Map();
const userIdToUsername = new Map();
const userBalances = new Map();
const userBonuses = new Map();
const transactionIds = new Set();
const withdrawalRequests = new Map();

/* ---------------- KENO ---------------- */
const kenoPickStats = new Map();
const kenoOnlinePlayers = new Set();

function recordKenoPicks(picks) {
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

  picks.forEach(num => {
    if (!kenoPickStats.has(num)) kenoPickStats.set(num, []);
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

/* ---------------- BINGO HELPERS ---------------- */
function getOnlinePlayers(state) {
  return Array.from(state.players.values());
}

function getHumanSelectedBoardCount(state) {
  let count = 0;
  state.players.forEach(p => {
    if (!p.isSystemPlayer && Array.isArray(p.picks)) count += p.picks.length;
  });
  return count;
}

// Active participants (human + bot) that actually hold >= 1 board
function getActiveParticipantsCount(state) {
  let count = 0;
  state.players.forEach(p => {
    if (Array.isArray(p.picks) && p.picks.length > 0) count += 1;
  });
  return count;
}

function getTotalSelectedBoards(state) {
  let totalBoards = 0;
  state.players.forEach(player => {
    if (Array.isArray(player.picks)) totalBoards += player.picks.length;
  });
  return totalBoards;
}

function computePrizePool(state) {
  const totalBetAmount = getTotalSelectedBoards(state) * state.stake;
  return Math.floor(totalBetAmount * 0.8);
}

function rebuildTakenBoards(state) {
  state.takenBoards = new Set();
  state.players.forEach(player => {
    if (Array.isArray(player.picks)) {
      player.picks.forEach(bid => state.takenBoards.add(bid));
    }
  });
}

function resetSystemPlayers(state) {
  state.systemPlayers.forEach(sp => {
    sp.picks = [];
    sp.ready = false;
    sp.markedNumbers = new Set();
    state.players.delete(sp.id);
  });
  state.botsActivated = false;
  rebuildTakenBoards(state);
}

function activateSystemPlayersIfNeeded(state, stake) {
  if (state.phase === 'calling') return;

  // Trigger condition: at least 2 BOARDS chosen by real players
  const humanBoardCount = getHumanSelectedBoardCount(state);

  if (humanBoardCount < 2) {
    if (state.botsActivated) {
      resetSystemPlayers(state);
    }
    return;
  }

  // If already active and have picks, keep them stable for this round
  if (state.botsActivated && state.systemPlayers.every(sp => sp.ready && sp.picks.length > 0)) {
    return;
  }

  // Fresh activation
  resetSystemPlayers(state);

  const taken = new Set();
  state.players.forEach(p => {
    if (!p.isSystemPlayer && Array.isArray(p.picks)) {
      p.picks.forEach(bid => taken.add(bid));
    }
  });

  state.systemPlayers.forEach(sp => {
    const availableBoards = [];
    for (let i = 1; i <= BOARD_SIZE; i++) {
      if (!taken.has(i)) availableBoards.push(i);
    }

    const pickCount = Math.random() < 0.35 ? 1 : 2;
    const picks = [];

    for (let k = 0; k < pickCount; k++) {
      if (availableBoards.length === 0) break;
      const idx = Math.floor(Math.random() * availableBoards.length);
      const boardNum = availableBoards.splice(idx, 1)[0];
      picks.push(boardNum);
      taken.add(boardNum);
    }

    sp.picks = picks;
    sp.ready = picks.length > 0;
    sp.markedNumbers = new Set();
    state.players.set(sp.id, sp);
  });

  state.botsActivated = true;
  rebuildTakenBoards(state);
}

function emitRoomState(stake, state) {
  const roomId = state.roomId;
  io.to(roomId).emit('boards_taken', {
    stake,
    takenBoards: Array.from(state.takenBoards),
  });
  io.to(roomId).emit('players', {
    count: getActiveParticipantsCount(state),
    waitingCount: state.waitingPlayers.size,
    stake
  });
  io.emit('bet_houses_status', { betHouses: getAllBetHousesStatus() });
}

function finalizeRoundToLobby(stake) {
  const state = getGameState(stake);
  const roomId = state.roomId;

  clearInterval(state.caller);
  clearInterval(state.timer);

  state.phase = 'lobby';
  state.called = [];
  state.countdown = COUNTDOWN_SECONDS;

  // keep only real players
  const realPlayers = new Map();
  state.players.forEach((p, id) => {
    if (!p.isSystemPlayer) {
      p.picks = [];
      p.ready = false;
      realPlayers.set(id, p);
    }
  });
  state.players = realPlayers;

  // move waiting players in
  state.waitingPlayers.forEach((p, id) => {
    p.picks = [];
    p.ready = false;
    state.players.set(id, p);
  });
  state.waitingPlayers.clear();

  resetSystemPlayers(state);
  rebuildTakenBoards(state);

  io.to(roomId).emit('phase', { phase: state.phase, stake });
  emitRoomState(stake, state);

  startCountdown(stake);
}

/* ---------------- BINGO ROUND FLOW ---------------- */
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

  activateSystemPlayersIfNeeded(state, stake);
  rebuildTakenBoards(state);
  emitRoomState(stake, state);

  io.to(roomId).emit('phase', { phase: state.phase, stake });
  io.to(roomId).emit('tick', {
    seconds: state.countdown,
    players: getActiveParticipantsCount(state),
    prize: computePrizePool(state),
    stake: state.stake
  });

  state.timer = setInterval(() => {
    state.countdown -= 1;
    io.to(roomId).emit('tick', {
      seconds: state.countdown,
      players: getActiveParticipantsCount(state),
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

  // increment games played for real users only
  state.players.forEach(player => {
    if (player.isSystemPlayer) return;
    const userId = player.oderId;
    const username = userIdToUsername.get(userId);
    if (username) {
      const user = users.get(username);
      if (user) {
        user.gamesPlayed = (user.gamesPlayed || 0) + 1;
        const socket = io.sockets.sockets.get(player.id);
        if (socket) {
          socket.emit('balance_update', {
            balance: userBalances.get(userId) || 0,
            bonus: userBonuses.get(userId) || 0,
            gamesPlayed: user.gamesPlayed
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
      finalizeRoundToLobby(stake);
      return;
    }

    const n = numbers[idx++];
    state.called.push(n);

    // All players mark called number
    Array.from(state.players.values()).forEach(player => {
      if (!player.ready || !player.picks.length) return;
      player.markedNumbers.add(n);
    });

    io.to(roomId).emit('call', { number: n, called: state.called, stake });

    // Check for winners among all players (including system players)
    const allPlayers = Array.from(state.players.values());
    for (const player of allPlayers) {
      if (!player.ready || !Array.isArray(player.picks) || player.picks.length === 0) continue;

      for (const boardId of player.picks) {
        const board = getBoard(boardId);
        if (!board) continue;

        if (didBingo(board, player.markedNumbers, n)) {
          const prize = computePrizePool(state);
          io.to(roomId).emit('winner', {
            playerId: player.id,
            prize,
            stake,
            boardId,
            lineIndices: getWinningLine(board, player.markedNumbers, n),
            systemPlayer: player.isSystemPlayer || false,
            name: player.isSystemPlayer ? player.name : undefined
          });
          finalizeRoundToLobby(stake);
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
    const activeParticipants = getActiveParticipantsCount(state);
    const waitingPlayers = state.waitingPlayers.size;
    statuses.push({
      stake,
      phase: state.phase,
      activePlayers: activeParticipants,
      waitingPlayers,
      totalPlayers: activeParticipants + waitingPlayers,
      prize: computePrizePool(state),
      countdown: state.countdown,
      called: state.called.length
    });
  });
  return statuses;
}

/* ---------------- KENO LOOP ---------------- */
const KENO_BET_DURATION = 40;
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

const socketRooms = new Map();

/* ---------------- SOCKET.IO ---------------- */
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
    if (!userBalances.has(socket.userId)) userBalances.set(socket.userId, 0);
    if (!userBonuses.has(socket.userId)) userBonuses.set(socket.userId, 0);

    const uName = userIdToUsername.get(socket.userId);
    const user = uName ? users.get(uName) : null;
    const gamesPlayed = user ? (user.gamesPlayed || 0) : 0;

    socket.emit('balance_update', {
      balance: userBalances.get(socket.userId) || 0,
      bonus: userBonuses.get(socket.userId) || 0,
      gamesPlayed
    });
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

      const leavingPlayer = prevState.players.get(socket.id) || prevState.waitingPlayers.get(socket.id);
      if (leavingPlayer && Array.isArray(leavingPlayer.picks)) {
        leavingPlayer.picks.forEach(bid => prevState.takenBoards.delete(bid));
      }

      socket.leave(prevRoomId);
      prevState.players.delete(socket.id);
      prevState.waitingPlayers.delete(socket.id);

      activateSystemPlayersIfNeeded(prevState, previousStake);
      rebuildTakenBoards(prevState);
      emitRoomState(previousStake, prevState);
    }

    const state = getGameState(stake);
    const roomId = state.roomId;
    socket.join(roomId);
    socketRooms.set(socket.id, stake);

    const player = {
      id: socket.id,
      userId: socket.userId,
      oderId: socket.userId,
      name: socket.username,
      stake,
      picks: [],
      ready: false,
      isSystemPlayer: false,
      markedNumbers: new Set()
    };

    if (state.phase === 'calling') {
      state.waitingPlayers.set(socket.id, player);
    } else {
      state.players.set(socket.id, player);
    }

    activateSystemPlayersIfNeeded(state, stake);
    rebuildTakenBoards(state);

    socket.emit('init', {
      phase: state.phase,
      seconds: state.countdown,
      stake: state.stake,
      prize: computePrizePool(state),
      called: state.called,
      playerId: socket.id,
      isWaiting: state.phase === 'calling',
      balance: userBalances.get(socket.userId) || 0,
      bonus: userBonuses.get(socket.userId) || 0
    });

    emitRoomState(stake, state);
  });

  socket.on('select_numbers', (data) => {
    const { picks, stake: stakeAmount } = data;
    if (!Array.isArray(picks) || picks.length > 2) return;

    const stake = Number(stakeAmount);
    if (!socketRooms.has(socket.id) || socketRooms.get(socket.id) !== stake) return;

    const state = getGameState(stake);
    const player = state.players.get(socket.id) || state.waitingPlayers.get(socket.id);
    if (!player) return;

    // remove old picks
    if (Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.delete(boardId));
    }

    // recalc from everyone except current player first
    rebuildTakenBoards(state);
    if (Array.isArray(player.picks)) {
      player.picks.forEach(boardId => state.takenBoards.delete(boardId));
    }

    const uniquePicks = Array.from(new Set(picks));
    const availablePicks = uniquePicks.filter(boardId => !state.takenBoards.has(boardId));
    player.picks = availablePicks;

    // now bots may activate/deactivate based on current human picks
    activateSystemPlayersIfNeeded(state, stake);
    rebuildTakenBoards(state);

    emitRoomState(stake, state);
  });

  socket.on('start_game', (data) => {
    const stake = Number(data?.stake || socketRooms.get(socket.id));
    if (!stake || !socketRooms.has(socket.id) || socketRooms.get(socket.id) !== stake) return;

    const state = getGameState(stake);
    const player = state.players.get(socket.id) || state.waitingPlayers.get(socket.id);
    if (!player || player.picks.length === 0) return;

    player.ready = true;

    if (state.phase !== 'calling' && state.waitingPlayers.has(socket.id)) {
      state.waitingPlayers.delete(socket.id);
      state.players.set(socket.id, player);
    }

    activateSystemPlayersIfNeeded(state, stake);
    rebuildTakenBoards(state);

    socket.emit('start_game_confirm', { stake, isWaiting: state.phase === 'calling' });

    if (state.phase === 'countdown') {
      socket.emit('game_start', { stake });
    }

    emitRoomState(stake, state);
  });

  socket.on('bingo', (data) => {
    const stake = Number(data?.stake || socketRooms.get(socket.id));
    if (!stake || !socketRooms.has(socket.id) || socketRooms.get(socket.id) !== stake) return;

    const state = getGameState(stake);
    const roomId = state.roomId;
    const player = state.players.get(socket.id);
    if (!player || !player.picks || player.picks.length === 0) return;

    const boardId = data?.boardId;
    const lineIndices = Array.isArray(data?.lineIndices) ? data.lineIndices : undefined;

    const prize = computePrizePool(state);
    io.to(roomId).emit('winner', {
      playerId: socket.id,
      prize,
      stake,
      boardId,
      lineIndices
    });

    // payout only real users
    if (!player.isSystemPlayer && player.userId) {
      const winnerBalance = userBalances.get(player.userId) || 0;
      userBalances.set(player.userId, winnerBalance + prize);
      socket.emit('balance_update', {
        balance: userBalances.get(player.userId) || 0,
        bonus: userBonuses.get(player.userId) || 0
      });
    }

    finalizeRoundToLobby(stake);
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

    activateSystemPlayersIfNeeded(state, stake);
    rebuildTakenBoards(state);
    emitRoomState(stake, state);
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
      socket.leave(roomId);

      activateSystemPlayersIfNeeded(state, stake);
      rebuildTakenBoards(state);
      emitRoomState(stake, state);
    }
  });
});

/* ---------------- PAYMENT PARSERS ---------------- */
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

/* ---------------- API ROUTES ---------------- */
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

  let remainingCost = amountNum;
  if (currentWallet >= remainingCost) {
    userBalances.set(sessionUserId, currentWallet - remainingCost);
    remainingCost = 0;
  } else {
    userBalances.set(sessionUserId, 0);
    remainingCost -= currentWallet;
    userBonuses.set(sessionUserId, currentBonus - remainingCost);
  }

  recordKenoPicks(picks);
  const ticketId = Date.now();
  const username = userIdToUsername.get(sessionUserId) || 'Player';

  io.to('keno_room').emit('keno_player_bet', {
    oderId: sessionUserId,
    username,
    gameId: gameId || kenoState.gameId,
    picks,
    amount: amountNum,
    ticketId
  });

  res.json({
    success: true,
    newBalance: userBalances.get(sessionUserId),
    newBonus: userBonuses.get(sessionUserId),
    ticketId,
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

app.get('/api/games/keno/state', (_req, res) => {
  res.json({
    phase: kenoState.phase,
    seconds: kenoState.countdown,
    gameId: kenoState.gameId,
    currentBallIndex: kenoState.currentBallIndex,
    drawnBalls: kenoState.drawResult.slice(0, kenoState.currentBallIndex)
  });
});

/* ---------------- TELEGRAM ---------------- */
app.post('/api/telegram/check-user', async (req, res) => {
  try {
    const { telegramId } = req.body;
    if (!telegramId) return res.json({ success: false, error: 'Telegram ID required' });

    const tgId = String(telegramId);
    let foundUser = null;
    let foundToken = null;

    for (const [, userData] of users.entries()) {
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

app.post('/api/telegram/register', async (req, res) => {
  try {
    const { telegramId, username, phoneNumber, firstName, lastName, language } = req.body;

    if (!telegramId || !phoneNumber) {
      return res.json({ success: false, error: 'Missing required fields (telegramId or phoneNumber)' });
    }

    const tgId = String(telegramId);
    const existingUser = Array.from(users.entries()).find(
      ([, data]) => String(data.telegramId || '') === tgId
    );
    if (existingUser) return res.json({ success: false, error: 'User already registered' });

    let baseUsername = (username || '').trim();
    if (!baseUsername) baseUsername = (firstName || 'player').toString();
    let usernameLower = baseUsername.trim().toLowerCase();
    if (users.has(usernameLower)) usernameLower = `${usernameLower}_${tgId.slice(-6)}`;

    const userId = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(phoneNumber);

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
    userBalances.set(userId, 0);
    userBonuses.set(userId, 30);

    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
    userSessions.set(token, { userId, username: usernameLower, expiresAt, telegramId: tgId });

    res.json({
      success: true,
      userId,
      username: usernameLower,
      token,
      balance: 0,
      bonus: 30
    });
  } catch (error) {
    console.error('Telegram registration error:', error);
    res.json({ success: false, error: 'Server error during registration' });
  }
});

app.post('/api/telegram/auto-login', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.json({ success: false, error: 'Token required' });

    const session = userSessions.get(token);
    if (!session) return res.json({ success: false, error: 'Invalid token' });
    if (session.expiresAt < Date.now()) {
      userSessions.delete(token);
      return res.json({ success: false, error: 'Token expired' });
    }

    const username = userIdToUsername.get(session.userId);
    const balance = userBalances.get(session.userId) || 0;
    const bonus = userBonuses.get(session.userId) || 0;

    res.json({
      success: true,
      userId: session.userId,
      username,
      token,
      balance,
      bonus
    });
  } catch (error) {
    console.error('Auto-login error:', error);
    res.json({ success: false, error: 'Server error' });
  }
});

/* ---------------- DEPOSIT / WITHDRAW ---------------- */
app.post('/api/deposit', (req, res) => {
  try {
    const { userId, amount, account, message, transactionId } = req.body;

    if (!userId || !amount || !message || !transactionId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }
    if (!userIdToUsername.has(userId)) return res.json({ success: false, error: 'Invalid user' });

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.json({ success: false, error: 'Invalid amount' });
    }

    if (transactionIds.has(transactionId)) {
      return res.json({ success: false, error: 'This transaction ID has already been used' });
    }

    const msgNoSpaces = message.replace(/\s+/g, '');
    const accountNoSpaces = String(account || '').replace(/\s+/g, '');
    if (accountNoSpaces && !msgNoSpaces.includes(accountNoSpaces)) {
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
      playerSocket.emit('balance_update', {
        balance: userBalances.get(userId),
        bonus: userBonuses.get(userId) || 0
      });
    }

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
    if (!userIdToUsername.has(userId)) return res.json({ success: false, error: 'Invalid user' });

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.json({ success: false, error: 'Invalid amount' });
    }
    if (amountNum < 100) return res.json({ success: false, error: 'Minimum withdrawal amount is 100 Birr.' });

    const username = userIdToUsername.get(userId);
    const user = users.get(username);
    const gamesPlayed = user ? (user.gamesPlayed || 0) : 0;
    if (gamesPlayed < 10) {
      return res.json({ success: false, error: `You must play at least 10 games to withdraw. Played: ${gamesPlayed}` });
    }

    const currentBalance = userBalances.get(userId) || 0;
    if (amountNum > currentBalance) {
      return res.json({ success: false, error: 'Insufficient balance' });
    }

    withdrawalRequests.set(userId, {
      amount: amountNum,
      account,
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
    if (!userIdToUsername.has(userId)) return res.json({ success: false, error: 'Invalid user' });

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
    const accountNoSpaces = String(account || '').replace(/\s+/g, '');
    if (accountNoSpaces && !msgNoSpaces.includes(accountNoSpaces)) {
      return res.json({ success: false, error: 'Account number not found in confirmation message' });
    }

    transactionIds.add(transactionId.toUpperCase());
    withdrawalRequests.delete(userId);

    res.json({ success: true, message: 'Withdrawal verified successfully' });
  } catch (error) {
    console.error('Withdrawal verification error:', error);
    res.json({ success: false, error: 'Server error verifying withdrawal' });
  }
});

/* ---------------- AUTH ---------------- */
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

    users.set(usernameLower, {
      userId,
      passwordHash,
      createdAt: Date.now(),
      gamesPlayed: 0
    });

    userIdToUsername.set(userId, usernameLower);
    userBalances.set(userId, 0);
    userBonuses.set(userId, 30);

    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
    userSessions.set(token, { userId, username: usernameLower, expiresAt });

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

    if (!user) return res.json({ success: false, error: 'Invalid username or password' });

    const passwordHash = hashPassword(password);
    if (user.passwordHash !== passwordHash) {
      return res.json({ success: false, error: 'Invalid username or password' });
    }

    const token = generateToken();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
    userSessions.set(token, { userId: user.userId, username: usernameLower, expiresAt });

    if (!userBalances.has(user.userId)) userBalances.set(user.userId, 0);
    if (!userBonuses.has(user.userId)) userBonuses.set(user.userId, 0);

    res.json({
      success: true,
      userId: user.userId,
      username: usernameLower,
      token,
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
    if (!userId || !token) return res.json({ success: false });

    const session = userSessions.get(token);
    if (!session || session.userId !== userId) return res.json({ success: false });

    if (session.expiresAt < Date.now()) {
      userSessions.delete(token);
      return res.json({ success: false });
    }

    const username = userIdToUsername.get(userId);
    if (!username) return res.json({ success: false });

    const balance = userBalances.get(userId) || 0;
    const bonus = userBonuses.get(userId) || 0;
    const user = users.get(username);
    const gamesPlayed = user ? (user.gamesPlayed || 0) : 0;

    res.json({ success: true, username, balance, bonus, gamesPlayed });
  } catch (error) {
    console.error('Verify error:', error);
    res.json({ success: false });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of userSessions.entries()) {
    if (session.expiresAt < now) userSessions.delete(token);
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