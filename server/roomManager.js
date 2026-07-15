const Game = require('./gameLogic');
const logger = require('./logger');

function parseDuration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

class RoomManager {
  constructor(io, options = {}) {
    this.io = io;
    this.rooms = new Map();
    this.playerRooms = new Map(); // Track which room each player is in (by persistent player ID)
    this.socketToPlayer = new Map(); // Map socket IDs to persistent player IDs
    this.playerToSocket = new Map(); // Map persistent player IDs to current socket IDs
    this.disconnectGraceMs = options.disconnectGraceMs ?? parseDuration(
      process.env.ROOM_DISCONNECT_GRACE_MS,
      5 * 60 * 1000
    );
    this.finishedRoomTtlMs = options.finishedRoomTtlMs ?? parseDuration(
      process.env.FINISHED_ROOM_TTL_MS,
      60 * 60 * 1000
    );
  }

  markPlayerConnected(game, playerId) {
    if (!game) return;
    const player = game.getPlayer(playerId);
    if (!player) return;

    player.connected = true;
    player.disconnectedAt = null;
    game.emptySince = null;
    game.lastActivityAt = Date.now();
  }

  broadcastGameState(roomId, customAction = null) {
    const game = this.rooms.get(roomId);
    if (!game) return;

    game.players.forEach(player => {
      const socketId = this.playerToSocket.get(player.id);
      if (socketId) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          const action = customAction ? { ...customAction, player: player.name } : null;
          logger.debug('game_state_broadcast', {
            roomId,
            playerId: player.id,
            nopeWindowOpen: Boolean(game.nopeWindow)
          });
          socket.emit('game-updated', {
            gameState: game.getPlayerGameState(player.id),
            action: action
          });
        }
      }
    });
  }

  createRoom(hostPlayerId, hostPlayerName, socketId) {
    const roomId = this.generateRoomId();
    const game = new Game(roomId);

    // Inject broadcast callback for async actions (nope windows)
    game.setBroadcastCallback((customAction = null) => {
      this.broadcastGameState(roomId, customAction);
    });
    
    // Add host as first player
    const result = game.addPlayer(hostPlayerId, hostPlayerName);
    if (!result.success) {
      return { success: false, message: result.message };
    }

    this.rooms.set(roomId, game);
    this.playerRooms.set(hostPlayerId, roomId);
    
    // Track socket mapping
    this.socketToPlayer.set(socketId, hostPlayerId);
    this.playerToSocket.set(hostPlayerId, socketId);

    // Ensure the room is accessible immediately after creation
    if (!this.rooms.has(roomId)) {
      return { success: false, message: 'Room creation failed. Please try again.' };
    }

    return {
      success: true,
      roomId,
      game: game.getPlayerGameState(hostPlayerId)
    };
  }

  joinRoom(roomId, playerId, playerName, socketId) {
    const game = this.rooms.get(roomId);
    if (!game) {
      logger.warn('room_not_found', { roomId, playerId });
      return { success: false, message: 'Room not found' };
    }

    // Check if player is already in this room (reconnection case)
    const existingRoom = this.playerRooms.get(playerId);
    if (existingRoom === roomId) {
      // Player is reconnecting to the same room
      const oldSocketId = this.playerToSocket.get(playerId);
      if (oldSocketId) {
        this.socketToPlayer.delete(oldSocketId);
      }
      
      // Update socket mapping
      this.socketToPlayer.set(socketId, playerId);
      this.playerToSocket.set(playerId, socketId);
      this.markPlayerConnected(game, playerId);
      
      return {
        success: true,
        roomId,
        game: game.getPlayerGameState(playerId),
        reconnected: true
      };
    }

    // Remove player from previous room if they were in one
    this.leaveRoom(playerId);

    const result = game.addPlayer(playerId, playerName);
    if (!result.success) {
      return { success: false, message: result.message };
    }

    this.playerRooms.set(playerId, roomId);
    
    // Track socket mapping
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);

    this.broadcastGameState(roomId, { type: 'player-joined', message: `${playerName} joined the game` });

    return {
      success: true,
      roomId,
      game: game.getPlayerGameState(playerId)
    };
  }

  leaveRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return { success: false, message: 'Player not in any room' };
    }

    const game = this.rooms.get(roomId);
    if (!game) {
      this.playerRooms.delete(playerId);
      this.cleanupPlayerMappings(playerId);
      return { success: false, message: 'Room not found' };
    }

    const leavingPlayer = game.getPlayer(playerId);
    if (leavingPlayer) {
      leavingPlayer.connected = false;
      leavingPlayer.disconnectedAt = Date.now();
    }

    game.removePlayer(playerId);
    this.playerRooms.delete(playerId);
    this.cleanupPlayerMappings(playerId);

    const hasRemainingMembers = game.players.some(
      player => this.playerRooms.get(player.id) === roomId
    );

    if (!hasRemainingMembers) {
      this.deleteRoom(roomId, 'no_room_members_remaining');
    } else {
      this.broadcastGameState(roomId, { type: 'player-left', message: `${game.getPlayer(playerId)?.name || 'A player'} left the game` });
    }

    return { success: true, roomRemoved: !hasRemainingMembers };
  }

  getPlayerRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      // Emit an event to the client to redirect them to join the game server again
      const socketId = this.playerToSocket.get(playerId);
      if (socketId) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('redirect', { message: 'User not recognized. Please join the game server again.' });
        }
      }
      return { success: false, message: 'User not recognized. Redirecting to join the game server again.' };
    }

    const game = this.rooms.get(roomId);
    if (!game) {
      this.playerRooms.delete(playerId);
      return null;
    }

    return {
      roomId,
      game: game.getPlayerGameState(playerId)
    };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  startGame(roomId, playerId) {
    const game = this.rooms.get(roomId);
    if (!game) {
      return { success: false, message: 'Room not found' };
    }

    // Handle both socket ID and player ID
    const actualPlayerId = this.socketToPlayer.get(playerId) || playerId;
    
    // Check if player is in this room
    const playerRoom = this.playerRooms.get(actualPlayerId);
    if (playerRoom !== roomId) {
      return { success: false, message: 'Player not in this room' };
    }

    const result = game.startGame();
    if (result.success) {
      this.broadcastGameState(roomId, { type: 'game-started', message: 'Game started!' });
    }
    return result;
  }

  playCard(playerId, cardId, targetPlayerId = null, additionalData = null) {
    // Handle both socket ID and player ID
    const actualPlayerId = this.socketToPlayer.get(playerId) || playerId;
    const roomId = this.playerRooms.get(actualPlayerId);
    if (!roomId) {
      return { success: false, message: 'Player not in any room' };
    }

    const game = this.rooms.get(roomId);
    if (!game) {
      return { success: false, message: 'Room not found' };
    }

    const result = game.playCard(actualPlayerId, cardId, targetPlayerId, additionalData);
    if (result.success) {
      this.broadcastGameState(roomId, { type: 'card-played', message: result.message });
    }
    return result;
  }

  playMultipleCards(playerId, cardIds, primaryCardId, targetPlayerId = null, additionalData = null) {
    // Handle both socket ID and player ID
    const actualPlayerId = this.socketToPlayer.get(playerId) || playerId;
    const roomId = this.playerRooms.get(actualPlayerId);
    if (!roomId) {
      return { success: false, message: 'Player not in any room' };
    }

    const game = this.rooms.get(roomId);
    if (!game) {
      return { success: false, message: 'Room not found' };
    }

    const result = game.playMultipleCards(actualPlayerId, cardIds, primaryCardId, targetPlayerId, additionalData);

    // If this is a random steal, the result will be "in progress" and the actual state update will be handled asynchronously
    if (result && result.data && result.data.nopeable && result.data.action === 'random_steal') {
      // Do not broadcast here; broadcast will happen when the nope window resolves
      return result;
    }

    if (result.success) {
      this.broadcastGameState(roomId, { type: 'multiple-cards-played', message: result.message });
    }
    return result;
  }

  drawCard(playerId) {
    // Handle both socket ID and player ID
    const actualPlayerId = this.socketToPlayer.get(playerId) || playerId;
    const roomId = this.playerRooms.get(actualPlayerId);
    if (!roomId) {
      return { success: false, message: 'Player not in any room' };
    }

    const game = this.rooms.get(roomId);
    if (!game) {
      return { success: false, message: 'Room not found' };
    }

    const result = game.drawCard(actualPlayerId);
    if (result.success) {
      this.broadcastGameState(roomId, { type: 'card-drawn', message: result.message });
    }
    return result;
  }

  respondToPendingAction(playerId, response) {
    // Handle both socket ID and player ID
    const actualPlayerId = this.socketToPlayer.get(playerId) || playerId;
    const roomId = this.playerRooms.get(actualPlayerId);
    if (!roomId) {
      return { success: false, message: 'Player not in any room' };
    }

    const game = this.rooms.get(roomId);
    if (!game) {
      return { success: false, message: 'Room not found' };
    }

    const result = game.respondToPendingAction(actualPlayerId, response);
    if (result.success) {
      this.broadcastGameState(roomId, { type: 'action-response', message: result.message });
    }
    return result;
  }

  generateRoomId() {
    // Generate a 6-character room code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Make sure it's unique
    if (this.rooms.has(result)) {
      return this.generateRoomId();
    }
    
    return result;
  }

  getRoomList(playerId) {
    logger.debug('room_list_requested', { playerId });
    const roomList = [];
    this.rooms.forEach((game, roomId) => {
      const connectedPlayerCount = game.players.filter(player => player.connected).length;
      const isMember = this.playerRooms.get(playerId) === roomId;
      const isAvailable = game.gameState === 'waiting' && connectedPlayerCount > 0;

      // The lobby is an available-room list. Keep a player's own room visible
      // so they can reconnect, but hide other in-progress and abandoned rooms.
      if (!isMember && !isAvailable) return;

      roomList.push({
        roomId,
        playerCount: connectedPlayerCount,
        maxPlayers: game.maxPlayers,
        gameState: game.gameState,
        canJoin: isMember || (isAvailable && game.players.length < game.maxPlayers),
        isRejoin: isMember
      });
    });
    return roomList;
  }

  // Cleanup methods
  cleanupEmptyRooms(now = Date.now()) {
    const affectedPlayers = [];
    let cleanedCount = 0;

    this.rooms.forEach((game, roomId) => {
      const connectedPlayers = game.players.filter(player => player.connected);

      if (connectedPlayers.length === 0) {
        if (!game.emptySince) {
          const disconnectTimes = game.players
            .map(player => player.disconnectedAt)
            .filter(Boolean);
          game.emptySince = disconnectTimes.length > 0
            ? Math.max(...disconnectTimes)
            : game.lastActivityAt;
        }

        if (now - game.emptySince >= this.disconnectGraceMs) {
          if (this.deleteRoom(roomId, 'no_connected_players', affectedPlayers)) {
            cleanedCount++;
          }
          return;
        }
      } else {
        game.emptySince = null;

        // Expire individual disconnected players after the same grace period.
        // During a game, removePlayer eliminates them and can end the game.
        [...game.players].forEach(player => {
          if (player.connected || !player.disconnectedAt) return;
          if (now - player.disconnectedAt < this.disconnectGraceMs) return;

          game.removePlayer(player.id);
          this.playerRooms.delete(player.id);
          this.cleanupPlayerMappings(player.id);
          affectedPlayers.push(player.id);
          logger.info('disconnected_player_expired', {
            roomId,
            playerId: player.id,
            disconnectedForMs: now - player.disconnectedAt
          });
        });
      }

      if (
        game.gameState === 'finished' &&
        now - game.lastActivityAt >= this.finishedRoomTtlMs
      ) {
        if (this.deleteRoom(roomId, 'finished_room_expired', affectedPlayers)) {
          cleanedCount++;
        }
      }
    });

    return {
      cleanedCount,
      affectedPlayers: affectedPlayers
    };
  }

  deleteRoom(roomId, reason, affectedPlayers = []) {
    const game = this.rooms.get(roomId);
    if (!game) return false;

    if (game.nopeWindow?.timeout) {
      clearTimeout(game.nopeWindow.timeout);
    }

    game.players.forEach(player => {
      if (!affectedPlayers.includes(player.id)) {
        affectedPlayers.push(player.id);
      }
      this.playerRooms.delete(player.id);
      this.cleanupPlayerMappings(player.id);
    });

    this.rooms.delete(roomId);
    logger.info('room_removed', { roomId, reason });
    return true;
  }

  // Helper methods
  cleanupPlayerMappings(playerId) {
    const socketId = this.playerToSocket.get(playerId);
    if (socketId) {
      this.socketToPlayer.delete(socketId);
    }
    this.playerToSocket.delete(playerId);
  }

  handleSocketDisconnect(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    if (playerId) {
      const roomId = this.playerRooms.get(playerId);
      const game = roomId ? this.rooms.get(roomId) : null;
      const player = game?.getPlayer(playerId);

      if (player) {
        const disconnectedAt = Date.now();
        player.connected = false;
        player.disconnectedAt = disconnectedAt;
        game.lastActivityAt = disconnectedAt;

        if (!game.players.some(candidate => candidate.connected)) {
          game.emptySince = disconnectedAt;
        }

        logger.info('player_marked_disconnected', {
          roomId,
          playerId,
          disconnectedAt
        });
      }

      // Keep the room membership during the grace period, but remove the
      // stale socket mapping immediately.
      this.socketToPlayer.delete(socketId);
      this.playerToSocket.delete(playerId);
      
      return playerId;
    }
    return null;
  }

  getPlayerIdFromSocket(socketId) {
    return this.socketToPlayer.get(socketId);
  }

  getSocketFromPlayerId(playerId) {
    return this.playerToSocket.get(playerId);
  }

  resetGame(roomId, playerId) {
    const game = this.rooms.get(roomId);
    if (!game) {
      return { success: false, message: 'Room not found' };
    }

    // Handle both socket ID and player ID
    const actualPlayerId = this.socketToPlayer.get(playerId) || playerId;
    
    // Check if player is in this room
    const playerRoom = this.playerRooms.get(actualPlayerId);
    if (playerRoom !== roomId) {
      return { success: false, message: 'Player not in this room' };
    }

    // Check if player is in the game
    const player = game.getPlayer(actualPlayerId);
    if (!player) {
      return { success: false, message: 'Player not found in game' };
    }

    return game.resetGame();
  }

  getStats() {
    const games = Array.from(this.rooms.values());
    return {
      totalRooms: this.rooms.size,
      totalPlayers: games.reduce(
        (count, game) => count + game.players.filter(player => player.connected).length,
        0
      ),
      trackedPlayers: this.playerRooms.size,
      activeGames: games.filter(game => game.gameState === 'playing').length,
      waitingRooms: games.filter(game => game.gameState === 'waiting').length,
      finishedGames: games.filter(game => game.gameState === 'finished').length,
      connectedSockets: this.socketToPlayer.size
    };
  }
}

module.exports = RoomManager;
