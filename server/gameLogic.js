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
    this.nopeWindow = null; // For nope card responses
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
      // For cat cards, the card removal is handled inside handleCatCard
      // For other cards, remove the card here
      if (!card.isCat) {
        player.hand.splice(cardIndex, 1);
        this.deck.discard(card);
      }
      
      this.addToLog(`${player.name} played ${card.type}`);
    }

    return result;
  }

  playMultipleCards(playerId, cardIds, primaryCardId, targetPlayerId = null, additionalData = null) {
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

    // Validate that all cards exist in player's hand
    const cards = [];
    for (const cardId of cardIds) {
      const card = player.hand.find(c => c.id === cardId);
      if (!card) {
        return { success: false, message: `Card ${cardId} not found in hand` };
      }
      cards.push(card);
    }

    // Validate that all cards are the same type and are cat cards
    const cardTypes = [...new Set(cards.map(c => c.type))];
    if (cardTypes.length > 1) {
      return { success: false, message: 'All cards must be of the same type' };
    }

    const cardType = cardTypes[0];
    const primaryCard = cards.find(c => c.id === primaryCardId);
    if (!primaryCard) {
      return { success: false, message: 'Primary card not found in selection' };
    }

    if (!primaryCard.isCat) {
      return { success: false, message: 'Multiple card play only allowed for cat cards' };
    }

    // Validate card count requirements
    if (cards.length < 2) {
      return { success: false, message: 'Need at least 2 matching cards to steal' };
    }

    if (cards.length > 3) {
      return { success: false, message: 'Cannot play more than 3 cards at once' };
    }

    // Execute the cat card action with multiple cards
    const result = this.executeMultipleCatCardAction(player, cards, primaryCard, targetPlayerId, additionalData);
    
    if (result.success) {
      this.addToLog(`${player.name} played ${cards.length} ${cardType} cards`);
    }

    return result;
  }

  executeMultipleCatCardAction(player, cards, primaryCard, targetPlayerId, additionalData) {
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

    // Remove all selected cards from hand and discard them
    cards.forEach(card => {
      const cardIndex = player.hand.findIndex(c => c.id === card.id);
      if (cardIndex !== -1) {
        player.hand.splice(cardIndex, 1);
        this.deck.discard(card);
      }
    });

    // Determine steal type based on number of cards
    if (cards.length === 3 && additionalData && additionalData.namedSteal) {
      // Named steal with 3 cards
      return this.executeNamedSteal(player, targetPlayer, additionalData.cardName);
    } else {
      // Random steal with 2 or 3 cards (if 3 cards but not named steal, treat as random)
      return this.executeRandomSteal(player, targetPlayer);
    }
  }

  executeRandomSteal(player, targetPlayer) {
    // Steal a random card
    const randomIndex = Math.floor(Math.random() * targetPlayer.hand.length);
    const stolenCard = targetPlayer.hand.splice(randomIndex, 1)[0];
    player.hand.push(stolenCard);

    this.addToLog(`${player.name} stole a random card from ${targetPlayer.name}`);
    
    return { 
      success: true, 
      message: `Stole a random card from ${targetPlayer.name}`,
      data: { stolenCard }
    };
  }

  executeNamedSteal(player, targetPlayer, cardName) {
    // Look for the named card in target player's hand
    const targetCardIndex = targetPlayer.hand.findIndex(c => c.type === cardName);
    
    if (targetCardIndex === -1) {
      this.addToLog(`${player.name} tried to steal ${cardName} from ${targetPlayer.name} but they don't have it`);
      return { 
        success: true, 
        message: `${targetPlayer.name} doesn't have a ${cardName}`,
        data: { namedStealFailed: true }
      };
    }

    // Steal the named card
    const stolenCard = targetPlayer.hand.splice(targetCardIndex, 1)[0];
    player.hand.push(stolenCard);

    this.addToLog(`${player.name} stole ${stolenCard.type} from ${targetPlayer.name}`);
    
    return { 
      success: true, 
      message: `Stole ${stolenCard.type} from ${targetPlayer.name}`,
      data: { stolenCard, namedSteal: true }
    };
  }

  executeCardAction(player, card, targetPlayerId, additionalData) {
    switch (card.type) {
      case 'skip':
        this.endTurn();
        return { success: true, message: 'Turn skipped' };

      case 'attack':
        // End current turn and set next player to have 2 turns
        this.endTurn();
        this.turnsRemaining = 2;
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
        if (!this.nopeWindow) {
          return { success: false, message: 'Nope can only be played in response to other cards' };
        }
        return this.playNopeCard(player);

      default:
        // Any card can be used for stealing if you have pairs
        return this.handleMatchingCards(player, card, targetPlayerId, additionalData);
    }
  }

  handleCatCard(player, card, targetPlayerId, additionalData = null) {
    // Count matching cat cards in hand (including the one being played)
    const matchingCards = player.hand.filter(c => c.type === card.type);
    const totalMatchingCards = matchingCards.length; // The card being played is in the hand
    
    if (totalMatchingCards < 2) {
      return { success: false, message: 'Need at least 2 matching cat cards to steal' };
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

    // Check if using 3 matching cards for named steal
    if (totalMatchingCards >= 3 && additionalData && additionalData.namedSteal) {
      return this.handleNamedSteal(player, card, targetPlayer, additionalData.cardName);
    }

    // Regular steal with 2 matching cards
    // Remove the card being played
    const playedCardIndex = player.hand.findIndex(c => c.id === card.id);
    if (playedCardIndex !== -1) {
      player.hand.splice(playedCardIndex, 1);
      this.deck.discard(card);
    }

    // Remove one matching card from hand (for 2-card steal)
    const matchingCardIndex = player.hand.findIndex(c => c.type === card.type && c.id !== card.id);
    if (matchingCardIndex !== -1) {
      const matchingCard = player.hand.splice(matchingCardIndex, 1)[0];
      this.deck.discard(matchingCard);
    } else {
      // This should not happen with the checks above, but as a safeguard
      return { success: false, message: 'Internal error: matching card not found for steal action.' };
    }

    // Steal a random card
    const randomIndex = Math.floor(Math.random() * targetPlayer.hand.length);
    const stolenCard = targetPlayer.hand.splice(randomIndex, 1)[0];
    player.hand.push(stolenCard);

    this.addToLog(`${player.name} stole a random card from ${targetPlayer.name}`);
    
    return { 
      success: true, 
      message: `Stole a random card from ${targetPlayer.name}`,
      data: { stolenCard }
    };
  }

  handleMatchingCards(player, card, targetPlayerId, additionalData = null) {
    // Count matching cards in hand (including the one being played)
    const matchingCards = player.hand.filter(c => c.type === card.type);
    const totalMatchingCards = matchingCards.length; // The card being played is in the hand
    
    // If only one card, play it for its original effect
    if (totalMatchingCards === 1) {
      // Single card - play for original effect
      return this.executeSingleCardEffect(player, card, targetPlayerId, additionalData);
    }

    // Two or more matching cards - can be used for stealing
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

    // Check if using 3 matching cards for named steal (only for cat cards)
    if (totalMatchingCards >= 3 && card.isCat && additionalData && additionalData.namedSteal) {
      return this.handleNamedSteal(player, card, targetPlayer, additionalData.cardName);
    }

    // Regular steal with 2 matching cards (any card type)
    // Remove the card being played
    const playedCardIndex = player.hand.findIndex(c => c.id === card.id);
    if (playedCardIndex !== -1) {
      player.hand.splice(playedCardIndex, 1);
      this.deck.discard(card);
    }

    // Remove one matching card from hand (for 2-card steal)
    const matchingCardIndex = player.hand.findIndex(c => c.type === card.type && c.id !== card.id);
    if (matchingCardIndex !== -1) {
      const matchingCard = player.hand.splice(matchingCardIndex, 1)[0];
      this.deck.discard(matchingCard);
    } else {
      // This should not happen with the checks above, but as a safeguard
      return { success: false, message: 'Internal error: matching card not found for steal action.' };
    }

    // Steal a random card
    const randomIndex = Math.floor(Math.random() * targetPlayer.hand.length);
    const stolenCard = targetPlayer.hand.splice(randomIndex, 1)[0];
    player.hand.push(stolenCard);

    this.addToLog(`${player.name} used 2 ${card.type} cards to steal a random card from ${targetPlayer.name}`);
    
    return { 
      success: true, 
      message: `Stole a random card from ${targetPlayer.name}`,
      data: { stolenCard }
    };
  }

  executeSingleCardEffect(player, card, targetPlayerId, additionalData) {
    // Handle single card effects for their original purpose
    switch (card.type) {
      case 'skip':
        this.endTurn();
        return { success: true, message: 'Turn skipped' };

      case 'attack':
        // End current turn and set next player to have 2 turns
        this.endTurn();
        this.turnsRemaining = 2;
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

      default:
        // Cat cards played alone
        if (card.isCat) {
          return { success: false, message: 'Cat cards need at least 2 matching cards to steal' };
        }
        return { success: false, message: 'Unknown card type' };
    }
  }

  handleNamedSteal(player, card, targetPlayer, cardName) {
    // Remove the card being played
    const playedCardIndex = player.hand.findIndex(c => c.id === card.id);
    if (playedCardIndex !== -1) {
      player.hand.splice(playedCardIndex, 1);
      this.deck.discard(card);
    }

    // Remove two matching cards from hand (for 3-card named steal)
    let removedCount = 0;
    for (let i = player.hand.length - 1; i >= 0 && removedCount < 2; i--) {
      if (player.hand[i].type === card.type && player.hand[i].id !== card.id) {
        const matchingCard = player.hand.splice(i, 1)[0];
        this.deck.discard(matchingCard);
        removedCount++;
      }
    }

    if (removedCount < 2) {
      // This should not happen with the checks above, but as a safeguard
      return { success: false, message: 'Internal error: not enough matching cards for named steal.' };
    }

    // Look for the named card in target player's hand
    const targetCardIndex = targetPlayer.hand.findIndex(c => c.type === cardName);
    
    if (targetCardIndex === -1) {
      this.addToLog(`${player.name} tried to steal ${cardName} from ${targetPlayer.name} but they don't have it`);
      return { 
        success: true, 
        message: `${targetPlayer.name} doesn't have a ${cardName}`,
        data: { namedStealFailed: true }
      };
    }

    // Steal the named card
    const stolenCard = targetPlayer.hand.splice(targetCardIndex, 1)[0];
    player.hand.push(stolenCard);

    this.addToLog(`${player.name} stole ${stolenCard.type} from ${targetPlayer.name}`);
    
    return { 
      success: true, 
      message: `Stole ${stolenCard.type} from ${targetPlayer.name}`,
      data: { stolenCard, namedSteal: true }
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

  playNopeCard(player) {
    if (!this.nopeWindow) {
      return { success: false, message: 'No action to nope' };
    }

    // Remove nope card from player's hand
    const nopeIndex = player.hand.findIndex(card => card.type === 'nope');
    if (nopeIndex === -1) {
      return { success: false, message: 'Nope card not found in hand' };
    }

    const nopeCard = player.hand.splice(nopeIndex, 1)[0];
    this.deck.discard(nopeCard);

    // Cancel the action
    const cancelledAction = this.nopeWindow.action;
    this.nopeWindow = null;

    this.addToLog(`${player.name} played Nope! ${cancelledAction} was cancelled.`);

    return {
      success: true,
      message: `Noped! ${cancelledAction} was cancelled.`,
      data: { noped: true, cancelledAction }
    };
  }

  createNopeWindow(action, excludePlayerId = null) {
    // Create a window for players to play nope cards
    this.nopeWindow = {
      action: action,
      excludePlayerId: excludePlayerId,
      timeout: setTimeout(() => {
        // If no one nopes within 5 seconds, the action proceeds
        this.nopeWindow = null;
      }, 5000)
    };

    return this.nopeWindow;
  }

  canPlayNope(playerId) {
    if (!this.nopeWindow) return false;
    if (this.nopeWindow.excludePlayerId === playerId) return false;
    
    const player = this.getPlayer(playerId);
    if (!player || !player.isAlive) return false;
    
    return player.hand.some(card => card.type === 'nope');
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
