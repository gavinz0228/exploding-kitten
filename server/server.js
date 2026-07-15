const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const RoomManager = require('./roomManager');
const logger = require('./logger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const roomManager = new RoomManager(io);

function serializeError(error) {
  if (!(error instanceof Error)) return error;

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

// Record every HTTP request with a correlation ID and completion details.
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  const startedAt = process.hrtime.bigint();

  res.set('X-Request-Id', requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('http_request_completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip
    });
  });

  next();
});

// API Routes (must come before static files)
app.get('/api/rooms', (req, res) => {
  const playerId = req.query.playerId || req.headers['player-id'];
  res.json(roomManager.getRoomList(playerId));
});

app.get('/api/stats', (req, res) => {
  res.json(roomManager.getStats());
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/game/:roomId?', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/game.html'));
});

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// Serve static files (must come after API routes)
app.use(express.static(path.join(__dirname, '../public')));

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info('socket_connected', { socketId: socket.id });

  // Store player info
  socket.playerName = null;
  socket.playerId = null;
  socket.roomId = null;

  // Handle player joining
  socket.on('join-lobby', (data) => {
    socket.playerName = data.playerName;
    
    // Generate or use existing persistent player ID
    if (data.playerId && data.playerId !== socket.id) {
      // Client provided a persistent player ID (reconnection case)
      socket.playerId = data.playerId;
      logger.info('player_reconnecting', {
        playerName: socket.playerName,
        playerId: socket.playerId,
        socketId: socket.id
      });
    } else {
      // Generate new persistent player ID
      socket.playerId = uuidv4();
      logger.info('player_joined_lobby', {
        playerName: socket.playerName,
        playerId: socket.playerId,
        socketId: socket.id
      });
    }
    
    socket.emit('lobby-joined', {
      success: true,
      playerId: socket.playerId,
      playerName: socket.playerName
    });
  });

  // Handle room creation
  socket.on('create-room', (data) => {
    if (!socket.playerName || !socket.playerId) {
      socket.emit('error', { message: 'Must set player name first' });
      return;
    }

    logger.info('room_create_attempt', {
      playerName: socket.playerName,
      playerId: socket.playerId
    });
    const result = roomManager.createRoom(socket.playerId, socket.playerName, socket.id);
    
    if (result.success) {
      socket.roomId = result.roomId;
      socket.join(result.roomId);
      
      logger.info('room_created', {
        roomId: result.roomId,
        playerId: socket.playerId
      });
      
      socket.emit('room-created', {
        success: true,
        roomId: result.roomId,
        gameState: result.game
      });
    } else {
      logger.warn('room_create_failed', {
        playerId: socket.playerId,
        reason: result.message
      });
      socket.emit('error', { message: result.message });
    }
  });

  // Handle joining existing room
  socket.on('join-room', (data) => {
    if (!socket.playerName || !socket.playerId) {
      socket.emit('error', { message: 'Must set player name first' });
      return;
    }

    logger.info('room_join_attempt', {
      roomId: data.roomId,
      playerName: socket.playerName,
      playerId: socket.playerId
    });
    
    // Check if player is currently in a different room
    const currentRoom = roomManager.getPlayerRoom(socket.playerId);
    const oldRoomId = currentRoom ? currentRoom.roomId : null;
    
    const result = roomManager.joinRoom(data.roomId, socket.playerId, socket.playerName, socket.id);
    
    if (result.success) {
      // If player left an old room to join this new room, notify the old room
      if (oldRoomId && oldRoomId !== result.roomId && !result.reconnected) {
        const oldRoom = roomManager.getRoom(oldRoomId);
        if (oldRoom) {
          // Broadcast updated game state to the old room
          roomManager.broadcastGameState(oldRoomId, {
            type: 'player-left',
            player: socket.playerName,
            message: `${socket.playerName} left the game`
          });
        }
      }
      
      // Leave previous room if any
      if (socket.roomId) {
        socket.leave(socket.roomId);
      }
      
      socket.roomId = result.roomId;
      socket.join(result.roomId);
      
      logger.info('room_joined', {
        roomId: result.roomId,
        playerId: socket.playerId,
        reconnected: Boolean(result.reconnected)
      });
      
      // Notify the joining player that they have successfully joined
      socket.emit('room-joined-success', {
        success: true,
        roomId: result.roomId,
        gameState: result.game,
        reconnected: result.reconnected
      });

      // Broadcast to room that a new player has joined (only if not reconnecting)
      if (!result.reconnected) {
        roomManager.broadcastGameState(result.roomId, {
          type: 'player-joined',
          player: socket.playerName,
          message: `${socket.playerName} joined the game`
        });
      }
    } else {
      logger.warn('room_join_failed', {
        roomId: data.roomId,
        playerId: socket.playerId,
        reason: result.message
      });
      socket.emit('error', { message: result.message });
    }
  });

  // Handle game start
  socket.on('start-game', () => {
    if (!socket.roomId || !socket.playerId) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const result = roomManager.startGame(socket.roomId, socket.playerId);
    
    if (!result.success) {
      socket.emit('error', { message: result.message });
    }
  });

  // Handle card play
  socket.on('play-card', (data) => {
    if (!socket.playerId) {
      socket.emit('error', { message: 'Player ID not set' });
      return;
    }

    const result = roomManager.playCard(
      socket.playerId, 
      data.cardId, 
      data.targetPlayerId, 
      data.additionalData
    );

    if (result.success) {
      // Handle special responses
      if (result.data && result.data.topCards) {
        // See Future card - only send to player who played it
        socket.emit('see-future', {
          topCards: result.data.topCards
        });
      }
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // Handle multiple card play (for cat cards)
  socket.on('play-multiple-cards', (data) => {
    if (!socket.playerId) {
      socket.emit('error', { message: 'Player ID not set' });
      return;
    }

    const result = roomManager.playMultipleCards(
      socket.playerId,
      data.cardIds,
      data.primaryCardId,
      data.targetPlayerId,
      data.additionalData
    );

    if (!result.success) {
      socket.emit('error', { message: result.message });
    }
  });

  // Handle card draw
  socket.on('draw-card', () => {
    if (!socket.playerId) {
      socket.emit('error', { message: 'Player ID not set' });
      return;
    }

    const result = roomManager.drawCard(socket.playerId);

    if (result.success) {
      // Handle exploding kitten
      if (result.data && result.data.exploded) {
        socket.emit('player-exploded', {
          message: 'You exploded!',
          gameEnded: result.data.gameEnded
        });
      }
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // Handle pending action responses
  socket.on('respond-to-action', (data) => {
    if (!socket.playerId) {
      socket.emit('error', { message: 'Player ID not set' });
      return;
    }

    const result = roomManager.respondToPendingAction(socket.playerId, data);

    if (!result.success) {
      socket.emit('error', { message: result.message });
    }
  });

  // Handle getting current game state
  socket.on('get-game-state', () => {
    if (!socket.playerId) {
      socket.emit('error', { message: 'Player ID not set' });
      return;
    }

    const playerRoom = roomManager.getPlayerRoom(socket.playerId);
    if (playerRoom?.game) {
      socket.emit('game-state', {
        gameState: playerRoom.game
      });
    } else {
      socket.emit('error', { message: 'Not in a game' });
    }
  });

  // Handle game reset
  socket.on('reset-game', () => {
    if (!socket.roomId || !socket.playerId) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const result = roomManager.resetGame(socket.roomId, socket.playerId);
    
    if (result.success) {
      roomManager.broadcastGameState(socket.roomId, {
        type: 'game-reset',
        player: socket.playerName,
        message: 'Game has been reset'
      });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // Handle chat messages
  socket.on('chat-message', (data) => {
    if (socket.roomId && socket.playerName) {
      socket.to(socket.roomId).emit('chat-message', {
        playerName: socket.playerName,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    logger.info('socket_disconnected', {
      socketId: socket.id,
      playerId: socket.playerId,
      roomId: socket.roomId
    });
    
    // Handle socket disconnect but don't immediately remove from room
    const playerId = roomManager.handleSocketDisconnect(socket.id);
    
    if (playerId && socket.roomId) {
      // Notify other players about disconnection
      socket.to(socket.roomId).emit('player-disconnected', {
        playerName: socket.playerName,
        playerId: playerId
      });
    }
  });

  // Handle reconnection attempts
  socket.on('reconnect-attempt', (data) => {
    if (!data.playerId) {
      socket.emit('reconnected', {
        success: false,
        message: 'No player ID provided'
      });
      return;
    }

    // Try to rejoin the player to their previous room
    const playerRoom = roomManager.getPlayerRoom(data.playerId);
    if (playerRoom?.roomId) {
      socket.playerId = data.playerId;
      socket.playerName = data.playerName;
      socket.roomId = playerRoom.roomId;
      socket.join(playerRoom.roomId);
      
      // Update socket mapping
      roomManager.socketToPlayer.set(socket.id, data.playerId);
      roomManager.playerToSocket.set(data.playerId, socket.id);
      roomManager.markPlayerConnected(
        roomManager.getRoom(playerRoom.roomId),
        data.playerId
      );
      
      socket.emit('reconnected', {
        success: true,
        gameState: playerRoom.game
      });
      
      // Notify other players about reconnection
      socket.to(playerRoom.roomId).emit('player-reconnected', {
        playerName: data.playerName,
        playerId: data.playerId
      });
    } else {
      socket.emit('reconnected', {
        success: false,
        message: 'Could not reconnect to previous game'
      });
    }
  });
});

const configuredCleanupInterval = Number(process.env.ROOM_CLEANUP_INTERVAL_MS);
const ROOM_CLEANUP_INTERVAL_MS = Number.isFinite(configuredCleanupInterval) && configuredCleanupInterval > 0
  ? configuredCleanupInterval
  : 60000;

// Cleanup abandoned rooms and expired disconnected players periodically.
setInterval(() => {
  const cleanupResult = roomManager.cleanupEmptyRooms();
  if (cleanupResult.cleanedCount > 0) {
    logger.info('empty_rooms_cleaned', {
      count: cleanupResult.cleanedCount,
      affectedPlayerCount: cleanupResult.affectedPlayers.length
    });

    // Notify affected players
    cleanupResult.affectedPlayers.forEach(playerId => {
      const socketId = roomManager.getSocketFromPlayerId(playerId);
      const playerSocket = socketId ? io.sockets.sockets.get(socketId) : null;
      if (playerSocket) {
        playerSocket.emit('room-closed', {
          message: 'The room has been closed due to inactivity.'
        });
      }
    });
  }
}, ROOM_CLEANUP_INTERVAL_MS);

// Error handling
process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { error: serializeError(error) });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('unhandled_rejection', {
    reason: serializeError(reason),
    promise: String(promise)
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  logger.info('server_started', {
    port: Number(PORT),
    host: '0.0.0.0',
    logDirectory: logger.logDirectory
  });
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('server_shutdown_started', { signal });
  server.close(() => {
    logger.info('server_stopped', { signal });
    logger.on('finish', () => process.exit(0));
    logger.end();
  });

  setTimeout(() => {
    logger.error('server_shutdown_timeout', { signal });
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
