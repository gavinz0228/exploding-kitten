const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const RoomManager = require('./roomManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const roomManager = new RoomManager(io);

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
  console.log(`Socket connected: ${socket.id}`);

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
      console.log(`Player reconnecting: ${socket.playerName} (${socket.playerId})`);
    } else {
      // Generate new persistent player ID
      socket.playerId = uuidv4();
      console.log(`New player joined: ${socket.playerName} (${socket.playerId})`);
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

    console.log(`Creating room for player: ${socket.playerName} (${socket.playerId})`);
    const result = roomManager.createRoom(socket.playerId, socket.playerName, socket.id);
    
    if (result.success) {
      socket.roomId = result.roomId;
      socket.join(result.roomId);
      
      console.log(`Room created successfully: ${result.roomId}`);
      
      socket.emit('room-created', {
        success: true,
        roomId: result.roomId,
        gameState: result.game
      });
    } else {
      console.log(`Failed to create room: ${result.message}`);
      socket.emit('error', { message: result.message });
    }
  });

  // Handle joining existing room
  socket.on('join-room', (data) => {
    if (!socket.playerName || !socket.playerId) {
      socket.emit('error', { message: 'Must set player name first' });
      return;
    }

    console.log(`Player ${socket.playerName} (${socket.playerId}) attempting to join room: ${data.roomId}`);
    
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
      
      console.log(`Player successfully joined room: ${result.roomId}${result.reconnected ? ' (reconnected)' : ''}`);
      
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
      console.log(`Failed to join room ${data.roomId}: ${result.message}`);
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
    if (playerRoom) {
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
    console.log(`Socket disconnected: ${socket.id}`);
    
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
    if (playerRoom) {
      socket.playerId = data.playerId;
      socket.playerName = data.playerName;
      socket.roomId = playerRoom.roomId;
      socket.join(playerRoom.roomId);
      
      // Update socket mapping
      roomManager.socketToPlayer.set(socket.id, data.playerId);
      roomManager.playerToSocket.set(data.playerId, socket.id);
      
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

// Cleanup empty rooms periodically
setInterval(() => {
  const cleanupResult = roomManager.cleanupEmptyRooms();
  if (cleanupResult.cleanedCount > 0) {
    console.log(`Cleaned up ${cleanupResult.cleanedCount} empty rooms`);

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
}, 300000); // Every 5 minutes

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Exploding Kittens server running on port ${PORT}`);
  console.log(`Visit http://"0.0.0.0":${PORT} to play!`);
});
