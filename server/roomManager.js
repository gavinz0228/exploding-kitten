const Game = require('./gameLogic');
const { v4: uuidv4 } = require('uuid');

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRooms = new Map(); // Track which room each player is in (by persistent player ID)
    this.socketToPlayer = new Map(); // Map socket IDs to persistent player IDs
    this.playerToSocket = new Map(); // Map persistent player IDs to current socket IDs
  }

  createRoom(hostPlayerId, hostPlayerName, socketId) {
    const roomId = this.generateRoomId();
    const game = new Game(roomId);
    
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

    return {
      success: true,
      roomId,
      game: game.getPlayerGameState(hostPlayerId)
    };
  }

  joinRoom(roomId, playerId, playerName, socketId) {
    const game = this.rooms.get(roomId);
    if (!game) {
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

    game.removePlayer(playerId);
    this.playerRooms.delete(playerId);
    this.cleanupPlayerMappings(playerId);

    // If room is empty, remove the room regardless of game state
    if (game.players.length === 0) {
      this.rooms.delete(roomId);
      console.log(`Room ${roomId} removed - no players remaining`);
    }

    return { success: true, roomRemoved: game.players.length === 0 };
  }

  getPlayerRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) {
      return null;
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

    return game.startGame();
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

    return game.playCard(actualPlayerId, cardId, targetPlayerId, additionalData);
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

    return game.playMultipleCards(actualPlayerId, cardIds, primaryCardId, targetPlayerId, additionalData);
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

    return game.drawCard(actualPlayerId);
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

    return game.respondToPendingAction(actualPlayerId, response);
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

  getRoomList() {
    const roomList = [];
    this.rooms.forEach((game, roomId) => {
      roomList.push({
        roomId,
        playerCount: game.players.length,
        maxPlayers: game.maxPlayers,
        gameState: game.gameState,
        canJoin: game.gameState === 'waiting' && game.players.length < game.maxPlayers
      });
    });
    return roomList;
  }

  // Cleanup methods
  cleanupEmptyRooms() {
    const roomsToDelete = [];
    const affectedPlayers = [];
    
    this.rooms.forEach((game, roomId) => {
      const alivePlayers = game.players.filter(p => p.isAlive);
      
      // Remove rooms with no alive players or finished games older than 1 hour
      if (alivePlayers.length === 0 || 
          (game.gameState === 'finished' && Date.now() - game.gameLog[game.gameLog.length - 1]?.timestamp > 3600000)) {
        roomsToDelete.push(roomId);
      }
    });

    roomsToDelete.forEach(roomId => {
      const game = this.rooms.get(roomId);
      if (game) {
        // Add players to affected list
        game.players.forEach(player => {
          affectedPlayers.push(player.id);
          this.playerRooms.delete(player.id);
        });
      }
      this.rooms.delete(roomId);
    });

    return {
      cleanedCount: roomsToDelete.length,
      affectedPlayers: affectedPlayers
    };
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
      // Don't remove from room immediately - allow for reconnection
      // Just clean up the socket mapping
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
    return {
      totalRooms: this.rooms.size,
      totalPlayers: this.playerRooms.size,
      activeGames: Array.from(this.rooms.values()).filter(game => game.gameState === 'playing').length,
      waitingRooms: Array.from(this.rooms.values()).filter(game => game.gameState === 'waiting').length,
      finishedGames: Array.from(this.rooms.values()).filter(game => game.gameState === 'finished').length,
      connectedSockets: this.socketToPlayer.size
    };
  }
}

module.exports = RoomManager;
