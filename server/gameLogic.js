const CardDeck = require('./cardDeck');

class Game {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = [];
    this.deck = new CardDeck();
    this.currentPlayerIndex = 0;
    this.gameState = 'waiting'; // waiting, playing, finished
    this.turnsRemaining = 1; // For attack cards
    this.pendingAction = null; // For cards that require responses
    this.gameLog = [];
    this.winner = null;
    this.maxPlayers = 5;
    this.minPlayers = 2;
  }

  addPlayer(playerId, playerName) {
    if (this.players.length >= this.maxPlayers) {
      return { success: false, message: 'Game is full' };
    }

    if (this.gameState !== 'waiting') {
      return { success: false, message: 'Game already in progress' };
    }

    if (this.players.find(p => p.id === playerId)) {
      return { success: false, message: 'Player already in game' };
    }

    const player = {
      id: playerId,
      name: playerName,
      hand: [],
      isAlive: true,
      isReady: false
    };

    this.players.push(player);
    this.addToLog(`${playerName} joined the game`);

    return { success: true, player };
  }

  removePlayer(playerId) {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return false;

    const player = this.players[playerIndex];
    this.addToLog(`${player.name} left the game`);

    // If game is in progress, mark player as eliminated
    if (this.gameState === 'playing') {
      player.isAlive = false;
      this.checkGameEnd();
    } else {
      // Remove player if game hasn't started
      this.players.splice(playerIndex, 1);
    }

    return true;
  }

  startGame() {
    if (this.players.length < this.minPlayers) {
      return { success: false, message: `Need at least ${this.minPlayers} players` };
    }

    if (this.gameState !== 'waiting') {
      return { success: false, message: 'Game already started' };
    }

    // Setup deck for this number of players
    this.deck.setupForPlayers(this.players.length);

    // Deal initial hands
    const hands = this.deck.dealInitialHands(this.players.length);
    this.players.forEach((player, index) => {
      player.hand = hands[index];
      player.isAlive = true;
    });

    // Randomize turn order
    this.shufflePlayers();
    this.currentPlayerIndex = 0;
    this.turnsRemaining = 1;
    this.gameState = 'playing';

    this.addToLog('Game started!');
    this.addToLog(`${this.getCurrentPlayer().name}'s turn`);

    return { success: true };
  }

  shufflePlayers() {
    for (let i = this.players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
    }
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId);
  }

  playCard(playerId, cardId, targetPlayerId = null, additionalData = null) {
    if (this.gameState !== 'playing') {
      return { success: false, message: 'Game not in progress' };
    }

    const player = this.getPlayer(playerId);
    if (!player || !player.isAlive) {
      return { success: false, message: 'Player not found or eliminated' };
    }

    if (this.getCurrentPlayer().id !== playerId) {
      return { success: false, message: 'Not your turn' };
    }

    const cardIndex = player.hand.findIndex(card => card.id === cardId);
    if (cardIndex === -1) {
      return { success: false, message: 'Card not found in hand' };
    }

    const card = player.hand[cardIndex];
    
    // Handle different card types
    const result = this.executeCardAction(player, card, targetPlayerId, additionalData);
    
    if (result.success) {
      // Remove card from hand and add to discard pile
      player.hand.splice(cardIndex, 1);
      this.deck.discard(card);
      
      this.addToLog(`${player.name} played ${card.type}`);
    }

    return result;
  }

  executeCardAction(player, card, targetPlayerId, additionalData) {
    switch (card.type) {
      case 'skip':
        this.endTurn();
        return { success: true, message: 'Turn skipped' };

      case 'attack':
        this.turnsRemaining = 2;
        this.endTurn();
        return { success: true, message: 'Next player takes 2 turns' };

      case 'see_future':
        const topCards = this.deck.peekTop(3);
        return { 
          success: true, 
          message: 'Saw the future',
          data: { topCards }
        };

      case 'shuffle':
        this.deck.shuffle();
        return { success: true, message: 'Deck shuffled' };

      case 'favor':
        if (!targetPlayerId) {
          return { success: false, message: 'Must select a target player' };
        }
        const targetPlayer = this.getPlayer(targetPlayerId);
        if (!targetPlayer || !targetPlayer.isAlive || targetPlayer.id === player.id) {
          return { success: false, message: 'Invalid target player' };
        }
        if (targetPlayer.hand.length === 0) {
          return { success: false, message: 'Target player has no cards' };
        }
        
        // Set pending action for target to choose a card
        this.pendingAction = {
          type: 'favor',
          fromPlayer: player.id,
          toPlayer: targetPlayerId,
          message: `${player.name} is asking for a card`
        };
        
        return { 
          success: true, 
          message: `Asking ${targetPlayer.name} for a card`,
          requiresResponse: true
        };

      case 'nope':
        // Nope cards are handled differently - they interrupt other actions
        return { success: false, message: 'Nope can only be played in response to other cards' };

      default:
        // Cat cards - check for pairs
        if (card.isCat) {
          return this.handleCatCard(player, card, targetPlayerId);
        }
        
        return { success: false, message: 'Unknown card type' };
    }
  }

  handleCatCard(player, card, targetPlayerId) {
    // Count matching cat cards in hand
    const matchingCards = player.hand.filter(c => c.type === card.type);
    
    if (matchingCards.length < 1) { // Need at least 2 total (including the one being played)
      return { success: false, message: 'Need a pair of cat cards to steal' };
    }

    if (!targetPlayerId) {
      return { success: false, message: 'Must select a target player to steal from' };
    }

    const targetPlayer = this.getPlayer(targetPlayerId);
    if (!targetPlayer || !targetPlayer.isAlive || targetPlayer.id === player.id) {
      return { success: false, message: 'Invalid target player' };
    }

    if (targetPlayer.hand.length === 0) {
      return { success: false, message: 'Target player has no cards' };
    }

    // Remove the matching card from hand
    const matchingCardIndex = player.hand.findIndex(c => c.type === card.type && c.id !== card.id);
    if (matchingCardIndex !== -1) {
      const matchingCard = player.hand.splice(matchingCardIndex, 1)[0];
      this.deck.discard(matchingCard);
    }

    // Steal a random card
    const randomIndex = Math.floor(Math.random() * targetPlayer.hand.length);
    const stolenCard = targetPlayer.hand.splice(randomIndex, 1)[0];
    player.hand.push(stolenCard);

    this.addToLog(`${player.name} stole a card from ${targetPlayer.name}`);
    
    return { 
      success: true, 
      message: `Stole a card from ${targetPlayer.name}`,
      data: { stolenCard }
    };
  }

  drawCard(playerId) {
    if (this.gameState !== 'playing') {
      return { success: false, message: 'Game not in progress' };
    }

    const player = this.getPlayer(playerId);
    if (!player || !player.isAlive) {
      return { success: false, message: 'Player not found or eliminated' };
    }

    if (this.getCurrentPlayer().id !== playerId) {
      return { success: false, message: 'Not your turn' };
    }

    const drawnCard = this.deck.drawCard();
    if (!drawnCard) {
      return { success: false, message: 'No cards left in deck' };
    }

    // Check if it's an exploding kitten
    if (drawnCard.type === 'exploding_kitten') {
      // Check if player has defuse card
      const defuseIndex = player.hand.findIndex(card => card.type === 'defuse');
      
      if (defuseIndex !== -1) {
        // Player can defuse
        const defuseCard = player.hand.splice(defuseIndex, 1)[0];
        this.deck.discard(defuseCard);
        
        // Player must put exploding kitten back in deck
        this.pendingAction = {
          type: 'place_exploding_kitten',
          player: playerId,
          card: drawnCard,
          message: 'Choose where to place the Exploding Kitten in the deck'
        };
        
        this.addToLog(`${player.name} defused an Exploding Kitten!`);
        
        return {
          success: true,
          message: 'Exploding Kitten defused! Choose where to place it back in the deck.',
          data: { explodingKitten: drawnCard, defused: true },
          requiresResponse: true
        };
      } else {
        // Player explodes
        player.isAlive = false;
        this.addToLog(`${player.name} exploded!`);
        
        const gameEnded = this.checkGameEnd();
        
        return {
          success: true,
          message: 'You exploded!',
          data: { exploded: true, gameEnded }
        };
      }
    } else {
      // Normal card
      player.hand.push(drawnCard);
      this.endTurn();
      
      return {
        success: true,
        message: 'Card drawn',
        data: { drawnCard }
      };
    }
  }

  respondToPendingAction(playerId, response) {
    if (!this.pendingAction) {
      return { success: false, message: 'No pending action' };
    }

    const action = this.pendingAction;
    this.pendingAction = null;

    switch (action.type) {
      case 'favor':
        if (playerId !== action.toPlayer) {
          return { success: false, message: 'Not your action to respond to' };
        }
        
        const player = this.getPlayer(playerId);
        const requestingPlayer = this.getPlayer(action.fromPlayer);
        
        if (!response.cardId) {
          return { success: false, message: 'Must specify card to give' };
        }
        
        const cardIndex = player.hand.findIndex(card => card.id === response.cardId);
        if (cardIndex === -1) {
          return { success: false, message: 'Card not found' };
        }
        
        const card = player.hand.splice(cardIndex, 1)[0];
        requestingPlayer.hand.push(card);
        
        this.addToLog(`${player.name} gave a card to ${requestingPlayer.name}`);
        
        return { success: true, message: 'Card given' };

      case 'place_exploding_kitten':
        if (playerId !== action.player) {
          return { success: false, message: 'Not your action' };
        }
        
        const position = response.position || 0;
        this.deck.insertCard(action.card, position);
        
        this.endTurn();
        
        return { success: true, message: 'Exploding Kitten placed back in deck' };

      default:
        return { success: false, message: 'Unknown action type' };
    }
  }

  endTurn() {
    this.turnsRemaining--;
    
    if (this.turnsRemaining <= 0) {
      // Move to next alive player
      do {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      } while (!this.getCurrentPlayer().isAlive);
      
      this.turnsRemaining = 1;
      this.addToLog(`${this.getCurrentPlayer().name}'s turn`);
    }
  }

  checkGameEnd() {
    const alivePlayers = this.players.filter(p => p.isAlive);
    
    if (alivePlayers.length <= 1) {
      this.gameState = 'finished';
      this.winner = alivePlayers[0] || null;
      
      if (this.winner) {
        this.addToLog(`${this.winner.name} wins!`);
      } else {
        this.addToLog('Game ended with no winner');
      }
      
      return true;
    }
    
    return false;
  }

  resetGame() {
    if (this.gameState !== 'finished') {
      return { success: false, message: 'Can only reset finished games' };
    }

    // Reset game state
    this.gameState = 'waiting';
    this.currentPlayerIndex = 0;
    this.turnsRemaining = 1;
    this.pendingAction = null;
    this.winner = null;
    
    // Reset all players
    this.players.forEach(player => {
      player.hand = [];
      player.isAlive = true;
      player.isReady = false;
    });

    // Reset deck
    this.deck = new CardDeck();
    
    // Clear game log but keep a reset message
    this.gameLog = [];
    this.addToLog('Game has been reset - waiting for players to start a new game');

    return { success: true, message: 'Game reset successfully' };
  }

  addToLog(message) {
    this.gameLog.push({
      timestamp: Date.now(),
      message
    });
    
    // Keep only last 50 log entries
    if (this.gameLog.length > 50) {
      this.gameLog = this.gameLog.slice(-50);
    }
  }

  getGameState() {
    return {
      roomId: this.roomId,
      gameState: this.gameState,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        handSize: p.hand.length,
        isAlive: p.isAlive,
        isCurrentPlayer: p.id === this.getCurrentPlayer()?.id
      })),
      currentPlayer: this.getCurrentPlayer()?.name,
      turnsRemaining: this.turnsRemaining,
      deckSize: this.deck.getRemainingCount(),
      topDiscardCard: this.deck.getTopDiscardCard(),
      pendingAction: this.pendingAction,
      gameLog: this.gameLog.slice(-10), // Last 10 log entries
      winner: this.winner?.name
    };
  }

  getPlayerGameState(playerId) {
    const player = this.getPlayer(playerId);
    const gameState = this.getGameState();
    
    if (player) {
      gameState.playerHand = player.hand;
      gameState.isMyTurn = this.getCurrentPlayer()?.id === playerId;
    }
    
    return gameState;
  }
}

module.exports = Game;
