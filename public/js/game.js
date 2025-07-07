// Game functionality for Exploding Kittens

class GameManager {
    constructor() {
        this.socket = null;
        this.gameState = null;
        this.playerId = '';
        this.playerName = '';
        this.roomId = '';
        this.selectedCards = [];
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

        // Play cards button
        document.getElementById('play-cards-btn').addEventListener('click', () => {
            this.playSelectedCards();
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
        const playBtn = document.getElementById('play-cards-btn');

        if (this.gameState.gameState === 'waiting') {
            startBtn.classList.remove('hidden');
            drawBtn.disabled = true;
            playBtn.disabled = true;
            playBtn.textContent = 'Play Selected Cards';
        } else if (this.gameState.gameState === 'playing') {
            startBtn.classList.add('hidden');
            drawBtn.disabled = !this.gameState.isMyTurn || !!this.gameState.pendingAction;
            
            // Always update play button based on current state
            if (!this.gameState.isMyTurn) {
                playBtn.disabled = true;
                playBtn.textContent = 'Not your turn';
            } else if (!!this.gameState.pendingAction) {
                playBtn.disabled = true;
                playBtn.textContent = 'Waiting for action...';
            } else {
                // Update play button based on current selection
                this.updatePlayButton();
            }
        } else {
            startBtn.classList.add('hidden');
            drawBtn.disabled = true;
            playBtn.disabled = true;
            playBtn.textContent = 'Play Selected Cards';
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
        // Allow selection regardless of playability - validation happens when playing
        
        // Function cards (shuffle, attack, skip, favor, see future) can be played individually OR in pairs for stealing
        const isFunctionCard = ['shuffle', 'attack', 'skip', 'favor', 'see_future'].includes(card.type);
        
        if (isFunctionCard) {
            // Function cards can be selected individually or in multiples
            this.handleFunctionCardSelection(cardElement, card);
            return;
        }
        
        // Cat cards always require multi-selection for stealing
        if (CardRenderer.isCatCard(card.type)) {
            this.handleMatchingCardSelection(cardElement, card);
            return;
        }

        // For cards that can't be used for stealing (exploding kitten, defuse, nope), handle single selection only
        const isAlreadySelected = cardElement.classList.contains('selected');
        
        if (isAlreadySelected) {
            // Deselect the card
            cardElement.classList.remove('selected');
            this.selectedCards = this.selectedCards.filter(c => c.id !== card.id);
        } else {
            // Clear previous selections and select this card
            this.clearCardSelections();
            cardElement.classList.add('selected');
            this.selectedCards = [card];
        }

        // Update the play button state
        this.updatePlayButton();
    }

    handleFunctionCardSelection(cardElement, card) {
        const isAlreadySelected = cardElement.classList.contains('selected');
        
        if (isAlreadySelected) {
            // Deselect the card
            cardElement.classList.remove('selected');
            this.selectedCards = this.selectedCards.filter(c => c.id !== card.id);
        } else {
            // Check if we can select this card type
            const selectedCardTypes = [...new Set(this.selectedCards.map(c => c.type))];
            
            if (selectedCardTypes.length > 0 && !selectedCardTypes.includes(card.type)) {
                this.showStatus('All selected cards must be of the same type', 'error');
                return;
            }
            
            // Select the card
            cardElement.classList.add('selected');
            this.selectedCards.push(card);
        }

        // Update UI based on selection - function cards can be played individually or in pairs
        this.updatePlayButton();
    }

    handleMatchingCardSelection(cardElement, card) {
        const isAlreadySelected = cardElement.classList.contains('selected');
        
        if (isAlreadySelected) {
            // Deselect the card
            cardElement.classList.remove('selected');
            this.selectedCards = this.selectedCards.filter(c => c.id !== card.id);
        } else {
            // Check if we can select this card type
            const selectedCardTypes = [...new Set(this.selectedCards.map(c => c.type))];
            
            if (selectedCardTypes.length > 0 && !selectedCardTypes.includes(card.type)) {
                this.showStatus('All selected cards must be of the same type', 'error');
                return;
            }
            
            // Select the card
            cardElement.classList.add('selected');
            this.selectedCards.push(card);
        }

        // Update UI based on selection
        this.updateMatchingCardSelectionUI();
    }

    handleCatCardSelection(cardElement, card) {
        const isAlreadySelected = cardElement.classList.contains('selected');
        
        if (isAlreadySelected) {
            // Deselect the card
            cardElement.classList.remove('selected');
            this.selectedCards = this.selectedCards.filter(c => c.id !== card.id);
        } else {
            // Check if we can select this card type
            const selectedCardTypes = [...new Set(this.selectedCards.map(c => c.type))];
            
            if (selectedCardTypes.length > 0 && !selectedCardTypes.includes(card.type)) {
                this.showStatus('All selected cards must be of the same type', 'error');
                return;
            }
            
            // Select the card
            cardElement.classList.add('selected');
            this.selectedCards.push(card);
        }

        // Update UI based on selection
        this.updateCatCardSelectionUI();
    }

    updateMatchingCardSelectionUI() {
        const selectedCount = this.selectedCards.length;
        
        if (selectedCount === 0) {
            this.hideCatCardActions();
            this.updatePlayButton();
            return;
        }

        // Check if all selected cards are the same type
        const cardTypes = [...new Set(this.selectedCards.map(c => c.type))];
        if (cardTypes.length > 1) {
            this.showStatus('All selected cards must be of the same type', 'error');
            this.updatePlayButton();
            return;
        }

        const cardType = cardTypes[0];
        const availableMatching = this.gameState.playerHand.filter(c => c.type === cardType).length;

        if (selectedCount === 1) {
            if (availableMatching < 2) {
                this.showStatus('Need at least 2 matching cards to steal', 'error');
                this.clearCardSelections();
            } else {
                this.showStatus(`Select ${2 - selectedCount} more matching card(s) to steal`, 'info');
            }
        } else if (selectedCount === 2) {
            // For cat cards, show special actions; for other cards, just update button
            if (CardRenderer.isCatCard(cardType)) {
                this.showCatCardActions('random');
            }
        } else if (selectedCount === 3) {
            // Only cat cards can do named steal with 3 cards
            if (CardRenderer.isCatCard(cardType)) {
                this.showCatCardActions('named');
            } else {
                this.showStatus('Only cat cards can use 3 matching cards for named steal', 'error');
                // Remove the last selected card
                const lastCard = this.selectedCards.pop();
                const lastCardElement = document.querySelector(`[data-card-id="${lastCard.id}"]`);
                if (lastCardElement) {
                    lastCardElement.classList.remove('selected');
                }
            }
        } else if (selectedCount > 3) {
            this.showStatus('Cannot select more than 3 cards', 'error');
            // Remove the last selected card
            const lastCard = this.selectedCards.pop();
            const lastCardElement = document.querySelector(`[data-card-id="${lastCard.id}"]`);
            if (lastCardElement) {
                lastCardElement.classList.remove('selected');
            }
        }

        this.updatePlayButton();
    }

    updateCatCardSelectionUI() {
        const selectedCount = this.selectedCards.length;
        
        if (selectedCount === 0) {
            this.hideCatCardActions();
            return;
        }

        // Check if all selected cards are the same type
        const cardTypes = [...new Set(this.selectedCards.map(c => c.type))];
        if (cardTypes.length > 1) {
            this.showStatus('All selected cards must be of the same type', 'error');
            return;
        }

        const cardType = cardTypes[0];
        const availableMatching = this.gameState.playerHand.filter(c => c.type === cardType).length;

        if (selectedCount === 2) {
            this.showCatCardActions('random');
        } else if (selectedCount === 3) {
            this.showCatCardActions('named');
        } else if (selectedCount > 3) {
            this.showStatus('Cannot select more than 3 cards', 'error');
            // Remove the last selected card
            const lastCard = this.selectedCards.pop();
            const lastCardElement = document.querySelector(`[data-card-id="${lastCard.id}"]`);
            if (lastCardElement) {
                lastCardElement.classList.remove('selected');
            }
        } else {
            // selectedCount === 1
            if (availableMatching < 2) {
                this.showStatus('Need at least 2 matching cards to steal', 'error');
                this.clearCardSelections();
            } else {
                this.showStatus(`Select ${2 - selectedCount} more matching card(s) to steal`, 'info');
            }
        }
    }

    clearCardSelections() {
        document.querySelectorAll('.card.selected').forEach(el => {
            el.classList.remove('selected');
        });
        this.selectedCards = [];
        this.hideCatCardActions();
        this.updatePlayButton();
    }

    updatePlayButton() {
        const playBtn = document.getElementById('play-cards-btn');
        const selectedCount = this.selectedCards.length;
        
        if (selectedCount === 0) {
            playBtn.disabled = true;
            playBtn.textContent = 'Play Selected Cards';
        } else if (selectedCount === 1) {
            const card = this.selectedCards[0];
            playBtn.disabled = false;
            
            // Check if player has more matching cards for potential stealing
            const matchingCards = this.gameState.playerHand.filter(c => c.type === card.type);
            
            if (matchingCards.length === 1) {
                // Only one card of this type - play for original effect
                playBtn.textContent = `Play ${CardRenderer.getCardName(card.type)}`;
            } else {
                // Multiple cards available - show options
                if (CardRenderer.isCatCard(card.type)) {
                    playBtn.textContent = `Play ${CardRenderer.getCardName(card.type)} (Select more for steal)`;
                } else {
                    playBtn.textContent = `Play ${CardRenderer.getCardName(card.type)} (or select more for steal)`;
                }
            }
        } else {
            // Multiple cards selected
            const cardTypes = [...new Set(this.selectedCards.map(c => c.type))];
            if (cardTypes.length > 1) {
                playBtn.disabled = true;
                playBtn.textContent = 'Cards must match';
            } else {
                playBtn.disabled = false;
                if (selectedCount === 2) {
                    playBtn.textContent = `Play ${selectedCount} ${CardRenderer.getCardName(cardTypes[0])}s (Random Steal)`;
                } else if (selectedCount === 3) {
                    playBtn.textContent = `Play ${selectedCount} ${CardRenderer.getCardName(cardTypes[0])}s (Choose Steal)`;
                } else {
                    playBtn.disabled = true;
                    playBtn.textContent = 'Too many cards selected';
                }
            }
        }
    }

    playSelectedCards() {
        if (this.selectedCards.length === 0) {
            this.showStatus('No cards selected', 'error');
            return;
        }

        const selectedCount = this.selectedCards.length;
        const firstCard = this.selectedCards[0];

        // Validate that the card can be played
        const canPlay = CardRenderer.canPlayCard(firstCard.type, this.gameState, this.playerId);
        if (!canPlay.canPlay) {
            this.showStatus(canPlay.reason, 'error');
            return;
        }

        // Handle single card play
        if (selectedCount === 1) {
            // For cat cards, check if player wants to play for original effect or has no other matching cards
            if (CardRenderer.isCatCard(firstCard.type)) {
                const matchingCards = this.gameState.playerHand.filter(c => c.type === firstCard.type);
                if (matchingCards.length === 1) {
                    // Only one cat card - can't steal, but cat cards don't have original effects
                    this.showStatus('Cat cards need at least 2 matching cards to steal', 'error');
                    return;
                } else {
                    // Multiple cat cards available - player chose to play just one (not allowed)
                    this.showStatus('Cat cards need at least 2 matching cards to steal', 'error');
                    return;
                }
            }

            // For non-cat cards, play for original effect
            // Check if card needs a target
            if (CardRenderer.needsTarget(firstCard.type)) {
                this.showTargetModal(firstCard);
            } else {
                // Play card immediately for its original effect
                this.playSelectedCard();
            }
            return;
        }

        // Handle multiple card play (cat cards)
        if (selectedCount === 2) {
            // 2 matching cat cards - random steal
            this.showTargetModalForCatCards('random');
        } else if (selectedCount === 3) {
            // 3 matching cat cards - choose steal type
            this.showCatCardStealTypeModal();
        } else {
            this.showStatus('Invalid number of cards selected', 'error');
        }
    }

    showCatCardStealTypeModal() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Choose Steal Type</h3>
                <p>You have 3 matching cat cards. Choose your steal type:</p>
                <div class="steal-type-buttons">
                    <button id="temp-random-steal" class="btn btn-primary">
                        🎲 Random Steal (Use 2 cards)
                        <small>Steal a random card from target player</small>
                    </button>
                    <button id="temp-named-steal" class="btn btn-secondary">
                        🎯 Named Steal (Use 3 cards)
                        <small>Name a specific card to steal</small>
                    </button>
                </div>
                <button id="temp-cancel-steal" class="btn btn-cancel">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('temp-random-steal').addEventListener('click', () => {
            document.body.removeChild(modal);
            this.showTargetModalForCatCards('random');
        });
        
        document.getElementById('temp-named-steal').addEventListener('click', () => {
            document.body.removeChild(modal);
            this.showNamedStealModalForCatCards();
        });
        
        document.getElementById('temp-cancel-steal').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
    }

    showCatCardActions(stealType) {
        // Create or show the cat card action buttons
        let actionContainer = document.getElementById('cat-card-actions');
        if (!actionContainer) {
            actionContainer = document.createElement('div');
            actionContainer.id = 'cat-card-actions';
            actionContainer.className = 'cat-card-actions';
            
            const playerHandArea = document.querySelector('.player-hand-area');
            playerHandArea.appendChild(actionContainer);
        }

        if (stealType === 'random') {
            actionContainer.innerHTML = `
                <div class="action-info">
                    <p>2 matching cards selected - Ready to steal a random card!</p>
                    <div class="action-buttons">
                        <button id="execute-random-steal" class="btn btn-primary">🎲 Steal Random Card</button>
                        <button id="cancel-cat-selection" class="btn btn-cancel">Cancel</button>
                    </div>
                </div>
            `;
            
            document.getElementById('execute-random-steal').addEventListener('click', () => {
                this.showTargetModalForCatCards('random');
            });
        } else if (stealType === 'named') {
            actionContainer.innerHTML = `
                <div class="action-info">
                    <p>3 matching cards selected - Choose your steal type:</p>
                    <div class="action-buttons">
                        <button id="execute-random-steal-3" class="btn btn-primary">🎲 Steal Random Card (2 cards)</button>
                        <button id="execute-named-steal" class="btn btn-secondary">🎯 Steal Named Card (3 cards)</button>
                        <button id="cancel-cat-selection" class="btn btn-cancel">Cancel</button>
                    </div>
                </div>
            `;
            
            document.getElementById('execute-random-steal-3').addEventListener('click', () => {
                this.showTargetModalForCatCards('random');
            });
            
            document.getElementById('execute-named-steal').addEventListener('click', () => {
                this.showNamedStealModalForCatCards();
            });
        }

        document.getElementById('cancel-cat-selection').addEventListener('click', () => {
            this.clearCardSelections();
        });

        actionContainer.classList.remove('hidden');
    }

    hideCatCardActions() {
        const actionContainer = document.getElementById('cat-card-actions');
        if (actionContainer) {
            actionContainer.classList.add('hidden');
        }
    }

    showTargetModalForCatCards(stealType) {
        const modal = document.getElementById('target-modal');
        const targetPlayers = document.getElementById('target-players');
        
        targetPlayers.innerHTML = '';

        const validTargets = this.gameState.players.filter(player => 
            player.id !== this.playerId && 
            player.isAlive && 
            player.handSize > 0
        );
        
        if (validTargets.length === 0) {
            this.showStatus('No valid targets available', 'error');
            return;
        }

        validTargets.forEach(player => {
            const targetElement = document.createElement('div');
            targetElement.className = 'target-player';
            targetElement.textContent = `${player.name} (${player.handSize} cards)`;
            
            targetElement.addEventListener('click', () => {
                this.playCatCards(player.id, stealType === 'named' ? { namedSteal: true, cardName: this.pendingNamedStealCard } : null);
            });

            targetPlayers.appendChild(targetElement);
        });

        modal.classList.remove('hidden');
    }

    showNamedStealModalForCatCards() {
        const modal = document.getElementById('named-steal-modal');
        if (!modal) {
            this.createNamedStealModal();
        }
        
        const cardTypes = ['tacocat', 'rainbow_cat', 'potato_cat', 'beard_cat', 'cattermelon', 
                          'attack', 'skip', 'favor', 'shuffle', 'see_future', 'nope', 'defuse'];
        
        const cardList = document.getElementById('named-steal-cards');
        cardList.innerHTML = '';
        
        cardTypes.forEach(cardType => {
            const cardElement = document.createElement('div');
            cardElement.className = 'named-steal-card';
            cardElement.innerHTML = `
                <div class="card-icon">${CardRenderer.getCardIcon(cardType)}</div>
                <div class="card-name">${CardRenderer.getCardName(cardType)}</div>
            `;
            
            cardElement.addEventListener('click', () => {
                this.hideNamedStealModal();
                this.pendingNamedStealCard = cardType;
                this.showTargetModalForCatCards('named');
            });
            
            cardList.appendChild(cardElement);
        });
        
        modal.classList.remove('hidden');
    }

    playCatCards(targetPlayerId, additionalData = null) {
        if (this.selectedCards.length < 2) {
            this.showStatus('Need at least 2 cards selected', 'error');
            return;
        }

        // Use the first selected card as the primary card
        const primaryCard = this.selectedCards[0];
        
        this.socket.emit('play-multiple-cards', {
            cardIds: this.selectedCards.map(c => c.id),
            primaryCardId: primaryCard.id,
            targetPlayerId: targetPlayerId,
            additionalData: additionalData
        });

        // Animate card play for all selected cards
        this.selectedCards.forEach(card => {
            const cardElement = document.querySelector(`[data-card-id="${card.id}"]`);
            if (cardElement) {
                CardRenderer.animateCardPlay(cardElement);
            }
        });

        this.clearCardSelections();
        this.hideTargetModal();
        this.hideNamedStealModal();
    }

    playSelectedCard(targetPlayerId = null, additionalData = null) {
        if (this.selectedCards.length === 0) {
            this.showStatus('No card selected', 'error');
            return;
        }

        // For single card play (non-cat cards)
        if (this.selectedCards.length === 1) {
            const card = this.selectedCards[0];
            this.socket.emit('play-card', {
                cardId: card.id,
                targetPlayerId: targetPlayerId,
                additionalData: additionalData
            });

            // Animate card play
            const selectedElement = document.querySelector('.card.selected');
            if (selectedElement) {
                CardRenderer.animateCardPlay(selectedElement);
            }
        } else {
            // For multiple card play (cat cards)
            this.playCatCards(targetPlayerId, additionalData);
            return;
        }

        this.clearCardSelections();
        this.hideTargetModal();
        this.hideStealTypeModal();
        this.hideNamedStealModal();
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
            this.clearCardSelections();
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
        this.clearCardSelections();
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

    showStealTypeModal(card) {
        const modal = document.getElementById('steal-type-modal');
        if (!modal) {
            // Create the modal if it doesn't exist
            this.createStealTypeModal();
        }
        
        const randomStealBtn = document.getElementById('random-steal-btn');
        const namedStealBtn = document.getElementById('named-steal-btn');
        
        randomStealBtn.onclick = () => {
            this.hideStealTypeModal();
            this.showTargetModal(card);
        };
        
        namedStealBtn.onclick = () => {
            this.hideStealTypeModal();
            this.showNamedStealModal(card);
        };
        
        document.getElementById('steal-type-modal').classList.remove('hidden');
    }

    hideStealTypeModal() {
        const modal = document.getElementById('steal-type-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    showNamedStealModal(card) {
        const modal = document.getElementById('named-steal-modal');
        if (!modal) {
            this.createNamedStealModal();
        }
        
        const cardTypes = ['tacocat', 'rainbow_cat', 'potato_cat', 'beard_cat', 'cattermelon', 
                          'attack', 'skip', 'favor', 'shuffle', 'see_future', 'nope', 'defuse'];
        
        const cardList = document.getElementById('named-steal-cards');
        cardList.innerHTML = '';
        
        cardTypes.forEach(cardType => {
            const cardElement = document.createElement('div');
            cardElement.className = 'named-steal-card';
            cardElement.innerHTML = `
                <div class="card-icon">${CardRenderer.getCardIcon(cardType)}</div>
                <div class="card-name">${CardRenderer.getCardName(cardType)}</div>
            `;
            
            cardElement.addEventListener('click', () => {
                this.hideNamedStealModal();
                this.showTargetModalForNamedSteal(card, cardType);
            });
            
            cardList.appendChild(cardElement);
        });
        
        document.getElementById('named-steal-modal').classList.remove('hidden');
    }

    hideNamedStealModal() {
        const modal = document.getElementById('named-steal-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    showTargetModalForNamedSteal(card, cardName) {
        const modal = document.getElementById('target-modal');
        const targetPlayers = document.getElementById('target-players');
        
        targetPlayers.innerHTML = '';

        const validTargets = CardRenderer.getValidTargets(card.type, this.gameState, this.playerId);
        
        if (validTargets.length === 0) {
            this.showStatus('No valid targets available', 'error');
            this.clearCardSelections();
            return;
        }

        validTargets.forEach(player => {
            const targetElement = document.createElement('div');
            targetElement.className = 'target-player';
            targetElement.textContent = `${player.name} (${player.handSize} cards)`;
            
            targetElement.addEventListener('click', () => {
                this.playSelectedCard(player.id, { 
                    namedSteal: true, 
                    cardName: cardName 
                });
            });

            targetPlayers.appendChild(targetElement);
        });

        modal.classList.remove('hidden');
    }

    createStealTypeModal() {
        const modal = document.createElement('div');
        modal.id = 'steal-type-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Choose Steal Type</h3>
                <p>You have 3+ matching cat cards. Choose your steal type:</p>
                <div class="steal-type-buttons">
                    <button id="random-steal-btn" class="btn btn-primary">
                        🎲 Random Steal (2 cards)
                        <small>Steal a random card from target player</small>
                    </button>
                    <button id="named-steal-btn" class="btn btn-secondary">
                        🎯 Named Steal (3 cards)
                        <small>Name a specific card to steal</small>
                    </button>
                </div>
                <button id="cancel-steal-type" class="btn btn-cancel">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('cancel-steal-type').addEventListener('click', () => {
            this.hideStealTypeModal();
            this.clearCardSelections();
        });
    }

    createNamedStealModal() {
        const modal = document.createElement('div');
        modal.id = 'named-steal-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Choose Card to Steal</h3>
                <p>Select the type of card you want to steal:</p>
                <div id="named-steal-cards" class="named-steal-cards"></div>
                <button id="cancel-named-steal" class="btn btn-cancel">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('cancel-named-steal').addEventListener('click', () => {
            this.hideNamedStealModal();
            this.clearCardSelections();
        });
    }

    hideAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.add('hidden');
        });
        
        this.clearCardSelections();
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
