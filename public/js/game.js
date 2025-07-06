// Game functionality for Exploding Kittens

class GameManager {
    constructor() {
        this.socket = null;
        this.gameState = null;
        this.playerId = '';
        this.playerName = '';
        this.roomId = '';
        this.selectedCard = null;
        this.connectionTimeout = null;
        this.joinTimeout = null;
        this.init();
    }

    init() {
        this.loadPlayerInfo();
        this.setupSocketConnection();
        this.setupEventListeners();
        this.showLoading('Connecting to game...');
    }

    loadPlayerInfo() {
        this.playerName = sessionStorage.getItem('playerName');
        this.playerId = sessionStorage.getItem('playerId');
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        this.roomId = pathSegments.length > 1 ? pathSegments[1] : sessionStorage.getItem('roomId');

        console.log(`Loading player info: ${this.playerName} (${this.playerId}) for room ${this.roomId}`);

        if (!this.playerName || !this.playerId || !this.roomId) {
            console.log('Missing player info, redirecting to lobby');
            // Redirect to lobby if missing info
            window.location.href = '/';
            return;
        }

        // Update room ID display
        document.getElementById('room-id').textContent = this.roomId;
    }

    setupSocketConnection() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            // Clear any existing timeouts
            this.clearTimeouts();
            
            // Set timeout for lobby join
            this.connectionTimeout = setTimeout(() => {
                this.showStatus('Connection timeout - redirecting to lobby', 'error');
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            }, 10000);
            
            // Join the lobby first with persistent player ID, then the room
            this.socket.emit('join-lobby', { 
                playerName: this.playerName,
                playerId: this.playerId
            });
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.showStatus('Disconnected from server', 'error');
        });

        this.socket.on('lobby-joined', (data) => {
            if (data.success) {
                console.log(`Lobby joined successfully, now joining room: ${this.roomId}`);
                
                // Update player ID if server provided a new one
                if (data.playerId && data.playerId !== this.playerId) {
                    this.playerId = data.playerId;
                    sessionStorage.setItem('playerId', this.playerId);
                }
                
                // Now join the specific room
                this.socket.emit('join-room', { roomId: this.roomId });
            } else {
                console.log('Failed to join lobby');
                this.showStatus('Failed to join lobby', 'error');
                this.hideLoading();
                setTimeout(() => {
                    window.location.href = '/';
                }, 3000);
            }
        });

        this.socket.on('room-joined-success', (data) => {
            // Clear timeouts since we got a response
            this.clearTimeouts();
            
            if (data.success) {
                console.log(`Successfully joined room: ${data.roomId}${data.reconnected ? ' (reconnected)' : ''}`);
                this.hideLoading();
                
                const message = data.reconnected ? 
                    'Successfully reconnected to the room!' : 
                    'Successfully joined the room!';
                this.showStatus(message, 'success');
                
                // Update game state if provided
                if (data.gameState) {
                    this.updateGameState(data.gameState);
                }
            } else {
                console.log(`Failed to join room: ${data.message}`);
                this.showStatus(data.message || 'Failed to join room', 'error');
                this.hideLoading();
                setTimeout(() => {
                    window.location.href = '/';
                }, 3000);
            }
        });

        this.socket.on('game-started', (data) => {
            this.updateGameState(data.gameState);
            this.showStatus('Game started!', 'success');
        });

        this.socket.on('game-updated', (data) => {
            this.updateGameState(data.gameState);
            
            if (data.action) {
                this.handleGameAction(data.action);
            }
        });

        this.socket.on('player-joined', (data) => {
            this.showStatus(`${data.playerName} joined the game`, 'success');
            if (data.gameState) {
                this.updateGameState(data.gameState);
            }
        });

        this.socket.on('player-left', (data) => {
            this.showStatus(`${data.playerName} left the game`, 'warning');
        });

        this.socket.on('see-future', (data) => {
            this.showFutureCards(data.topCards);
        });

        this.socket.on('player-exploded', (data) => {
            this.showStatus(data.message, 'error');
            if (data.gameEnded) {
                this.showGameOver();
            }
        });

        this.socket.on('error', (data) => {
            console.log(`Socket error: ${data.message}`);
            this.showStatus(data.message, 'error');
            this.hideLoading();
            
            // If it's a room not found error, redirect to lobby after a delay
            if (data.message.includes('Room not found')) {
                setTimeout(() => {
                    window.location.href = '/';
                }, 3000);
            }
        });

        this.socket.on('room-closed', (data) => {
            this.showStatus(data.message, 'warning');
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
        });

        this.socket.on('connect_error', () => {
            console.log('Connection error');
            this.showStatus('Failed to connect to server', 'error');
            this.hideLoading();
        });

        // Handle player disconnection/reconnection events
        this.socket.on('player-disconnected', (data) => {
            this.showStatus(`${data.playerName} disconnected`, 'warning');
        });

        this.socket.on('player-reconnected', (data) => {
            this.showStatus(`${data.playerName} reconnected`, 'success');
        });

        // Handle game reset
        this.socket.on('game-reset', (data) => {
            if (data.success) {
                this.showStatus(data.message, 'success');
                this.updateGameState(data.gameState);
                this.hideAllModals();
            }
        });
    }

    setupEventListeners() {
        // Start game button
        document.getElementById('start-game-btn').addEventListener('click', () => {
            this.startGame();
        });

        // Draw card button
        document.getElementById('draw-card-btn').addEventListener('click', () => {
            this.drawCard();
        });

        // Modal close buttons
        document.getElementById('close-future').addEventListener('click', () => {
            this.hideFutureModal();
        });

        document.getElementById('cancel-target').addEventListener('click', () => {
            this.hideTargetModal();
        });

        // Placement modal buttons
        document.querySelectorAll('.placement-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const position = parseInt(e.target.dataset.position);
                this.respondToPlacement(position);
            });
        });

        // Game over modal buttons
        document.getElementById('reset-game-btn').addEventListener('click', () => {
            this.resetGame();
        });

        document.getElementById('new-game-btn').addEventListener('click', () => {
            window.location.reload();
        });

        document.getElementById('back-to-lobby-btn').addEventListener('click', () => {
            window.location.href = '/';
        });

        // Status message close
        document.getElementById('close-status').addEventListener('click', () => {
            this.hideStatus();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideAllModals();
            }
        });
    }

    updateGameState(gameState) {
        this.gameState = gameState;
        
        // Update UI elements
        this.updateGameStatus();
        this.updatePlayers();
        this.updatePlayerHand();
        this.updateDeckInfo();
        this.updateGameLog();
        this.updateActionButtons();
        this.handlePendingActions();
    }

    updateGameStatus() {
        const statusElement = document.getElementById('game-state');
        const currentPlayerElement = document.getElementById('current-player');
        const turnsElement = document.getElementById('turns-remaining');
        const turnsCountElement = document.getElementById('turns-count');

        switch (this.gameState.gameState) {
            case 'waiting':
                statusElement.textContent = 'Waiting for players...';
                currentPlayerElement.textContent = 'Waiting...';
                break;
            case 'playing':
                statusElement.textContent = 'Game in progress';
                currentPlayerElement.textContent = `${this.gameState.currentPlayer}'s turn`;
                
                if (this.gameState.turnsRemaining > 1) {
                    turnsElement.classList.remove('hidden');
                    turnsCountElement.textContent = this.gameState.turnsRemaining;
                } else {
                    turnsElement.classList.add('hidden');
                }
                break;
            case 'finished':
                statusElement.textContent = 'Game finished';
                currentPlayerElement.textContent = `Winner: ${this.gameState.winner}`;
                this.showGameOver();
                break;
        }
    }

    updatePlayers() {
        const playersGrid = document.getElementById('players-list');
        playersGrid.innerHTML = '';

        this.gameState.players.forEach(player => {
            const playerCard = CardRenderer.createPlayerCard(player, player.isCurrentPlayer);
            playersGrid.appendChild(playerCard);
        });
    }

    updatePlayerHand() {
        const playerHand = document.getElementById('player-hand');
        playerHand.innerHTML = '';

        if (this.gameState.playerHand) {
            this.gameState.playerHand.forEach(card => {
                const cardElement = CardRenderer.createCardElement(card);
                
                // Add click handler
                cardElement.addEventListener('click', () => {
                    this.selectCard(cardElement, card);
                });

                // Add hover tooltip
                cardElement.addEventListener('mouseenter', (e) => {
                    CardRenderer.showCardTooltip(cardElement, e);
                });

                cardElement.addEventListener('mouseleave', () => {
                    CardRenderer.hideCardTooltip();
                });

                playerHand.appendChild(cardElement);
            });

            // Highlight playable cards
            CardRenderer.highlightPlayableCards(playerHand, this.gameState, this.playerId);
        }
    }

    updateDeckInfo() {
        document.getElementById('deck-size').textContent = this.gameState.deckSize;
        CardRenderer.updateDiscardPile(this.gameState.topDiscardCard);
    }

    updateGameLog() {
        const logMessages = document.getElementById('log-messages');
        
        // Clear existing messages
        logMessages.innerHTML = '';

        // Add new messages
        this.gameState.gameLog.forEach(logEntry => {
            const messageElement = CardRenderer.createLogMessage(logEntry.message, logEntry.timestamp);
            logMessages.appendChild(messageElement);
        });

        // Scroll to bottom
        logMessages.scrollTop = logMessages.scrollHeight;
    }

    updateActionButtons() {
        const startBtn = document.getElementById('start-game-btn');
        const drawBtn = document.getElementById('draw-card-btn');

        if (this.gameState.gameState === 'waiting') {
            startBtn.classList.remove('hidden');
            drawBtn.disabled = true;
        } else if (this.gameState.gameState === 'playing') {
            startBtn.classList.add('hidden');
            drawBtn.disabled = !this.gameState.isMyTurn || !!this.gameState.pendingAction;
        } else {
            startBtn.classList.add('hidden');
            drawBtn.disabled = true;
        }
    }

    handlePendingActions() {
        if (!this.gameState.pendingAction) {
            this.hideAllModals();
            return;
        }

        const action = this.gameState.pendingAction;

        switch (action.type) {
            case 'favor':
                if (action.toPlayer === this.playerId) {
                    this.showFavorModal(action.message);
                }
                break;
            case 'place_exploding_kitten':
                if (action.player === this.playerId) {
                    this.showPlacementModal();
                }
                break;
        }
    }

    selectCard(cardElement, card) {
        // Remove previous selection
        document.querySelectorAll('.card.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // Check if card can be played
        const canPlay = CardRenderer.canPlayCard(card.type, this.gameState, this.playerId);
        if (!canPlay.canPlay) {
            this.showStatus(canPlay.reason, 'error');
            return;
        }

        // Select the card
        cardElement.classList.add('selected');
        this.selectedCard = card;

        // Check if card needs a target
        if (CardRenderer.needsTarget(card.type)) {
            this.showTargetModal(card);
        } else {
            // Play card immediately
            this.playSelectedCard();
        }
    }

    playSelectedCard(targetPlayerId = null) {
        if (!this.selectedCard) {
            this.showStatus('No card selected', 'error');
            return;
        }

        this.socket.emit('play-card', {
            cardId: this.selectedCard.id,
            targetPlayerId: targetPlayerId
        });

        // Animate card play
        const selectedElement = document.querySelector('.card.selected');
        if (selectedElement) {
            CardRenderer.animateCardPlay(selectedElement);
        }

        this.selectedCard = null;
        this.hideTargetModal();
    }

    drawCard() {
        if (!this.gameState.isMyTurn) {
            this.showStatus('Not your turn', 'error');
            return;
        }

        this.socket.emit('draw-card');
        
        // Animate card draw
        const playerHand = document.getElementById('player-hand');
        CardRenderer.animateCardDraw(playerHand);
    }

    startGame() {
        this.socket.emit('start-game');
    }

    resetGame() {
        if (this.gameState && this.gameState.gameState !== 'finished') {
            this.showStatus('Can only reset finished games', 'error');
            return;
        }

        this.socket.emit('reset-game');
        this.showStatus('Resetting game...', 'success');
    }

    showTargetModal(card) {
        const modal = document.getElementById('target-modal');
        const targetPlayers = document.getElementById('target-players');
        
        targetPlayers.innerHTML = '';

        const validTargets = CardRenderer.getValidTargets(card.type, this.gameState, this.playerId);
        
        if (validTargets.length === 0) {
            this.showStatus('No valid targets available', 'error');
            this.selectedCard = null;
            return;
        }

        validTargets.forEach(player => {
            const targetElement = document.createElement('div');
            targetElement.className = 'target-player';
            targetElement.textContent = `${player.name} (${player.handSize} cards)`;
            
            targetElement.addEventListener('click', () => {
                this.playSelectedCard(player.id);
            });

            targetPlayers.appendChild(targetElement);
        });

        modal.classList.remove('hidden');
    }

    hideTargetModal() {
        document.getElementById('target-modal').classList.add('hidden');
        this.selectedCard = null;
        
        // Remove card selection
        document.querySelectorAll('.card.selected').forEach(el => {
            el.classList.remove('selected');
        });
    }

    showFutureCards(cards) {
        const modal = document.getElementById('future-modal');
        const futureCards = document.getElementById('future-cards');
        
        futureCards.innerHTML = '';

        cards.forEach((card, index) => {
            const cardElement = CardRenderer.createCardElement(card, false);
            cardElement.style.position = 'relative';
            
            // Add position indicator
            const positionLabel = document.createElement('div');
            positionLabel.style.position = 'absolute';
            positionLabel.style.top = '-10px';
            positionLabel.style.left = '50%';
            positionLabel.style.transform = 'translateX(-50%)';
            positionLabel.style.background = 'rgba(0,0,0,0.8)';
            positionLabel.style.color = 'white';
            positionLabel.style.padding = '2px 6px';
            positionLabel.style.borderRadius = '4px';
            positionLabel.style.fontSize = '0.7rem';
            positionLabel.textContent = `#${index + 1}`;
            
            cardElement.appendChild(positionLabel);
            futureCards.appendChild(cardElement);
        });

        modal.classList.remove('hidden');
    }

    hideFutureModal() {
        document.getElementById('future-modal').classList.add('hidden');
    }

    showFavorModal(message) {
        const modal = document.getElementById('favor-modal');
        const messageElement = document.getElementById('favor-message');
        const favorCards = document.getElementById('favor-cards');
        
        messageElement.textContent = message;
        favorCards.innerHTML = '';

        if (this.gameState.playerHand) {
            this.gameState.playerHand.forEach(card => {
                const cardElement = CardRenderer.createCardElement(card);
                
                cardElement.addEventListener('click', () => {
                    this.respondToFavor(card.id);
                });

                favorCards.appendChild(cardElement);
            });
        }

        modal.classList.remove('hidden');
    }

    hideFavorModal() {
        document.getElementById('favor-modal').classList.add('hidden');
    }

    showPlacementModal() {
        document.getElementById('placement-modal').classList.remove('hidden');
    }

    hidePlacementModal() {
        document.getElementById('placement-modal').classList.add('hidden');
    }

    showGameOver() {
        const modal = document.getElementById('game-over-modal');
        const title = document.getElementById('game-over-title');
        const message = document.getElementById('game-over-message');

        if (this.gameState.winner) {
            if (this.gameState.winner === this.playerName) {
                title.textContent = '🎉 You Won!';
                message.textContent = 'Congratulations! You survived the exploding kittens!';
            } else {
                title.textContent = '💥 Game Over';
                message.textContent = `${this.gameState.winner} won the game!`;
            }
        } else {
            title.textContent = 'Game Ended';
            message.textContent = 'The game has ended.';
        }

        modal.classList.remove('hidden');
    }

    respondToFavor(cardId) {
        this.socket.emit('respond-to-action', { cardId });
        this.hideFavorModal();
    }

    respondToPlacement(position) {
        this.socket.emit('respond-to-action', { position });
        this.hidePlacementModal();
    }

    handleGameAction(action) {
        let message = action.message;
        
        if (action.player !== this.playerName) {
            message = `${action.player}: ${message}`;
        }

        this.showStatus(message, 'success');
    }

    hideAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.add('hidden');
        });
        
        this.selectedCard = null;
        document.querySelectorAll('.card.selected').forEach(el => {
            el.classList.remove('selected');
        });
    }

    showLoading(message = 'Loading...') {
        const overlay = document.getElementById('loading-overlay');
        const text = document.getElementById('loading-text');
        text.textContent = message;
        overlay.classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading-overlay').classList.add('hidden');
    }

    showStatus(message, type = 'success') {
        const statusElement = document.getElementById('status-message');
        const statusText = document.getElementById('status-text');
        
        statusText.textContent = message;
        statusElement.className = `status-message ${type}`;
        statusElement.classList.remove('hidden');

        // Auto-hide after 4 seconds
        setTimeout(() => {
            this.hideStatus();
        }, 4000);
    }

    hideStatus() {
        document.getElementById('status-message').classList.add('hidden');
    }

    clearTimeouts() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        if (this.joinTimeout) {
            clearTimeout(this.joinTimeout);
            this.joinTimeout = null;
        }
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    new GameManager();
});
