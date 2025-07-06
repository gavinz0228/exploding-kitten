// Card display and interaction utilities

class CardRenderer {
    static getCardIcon(cardType) {
        const icons = {
            'attack': '⚔️',
            'skip': '⏭️',
            'favor': '🤝',
            'shuffle': '🔀',
            'see_future': '🔮',
            'nope': '🚫',
            'defuse': '🛡️',
            'exploding_kitten': '💥',
            'tacocat': '🌮',
            'rainbow_cat': '🌈',
            'potato_cat': '🥔',
            'beard_cat': '🧔',
            'cattermelon': '🍉'
        };
        return icons[cardType] || '🃏';
    }

    static getCardName(cardType) {
        const names = {
            'attack': 'Attack',
            'skip': 'Skip',
            'favor': 'Favor',
            'shuffle': 'Shuffle',
            'see_future': 'See Future',
            'nope': 'Nope',
            'defuse': 'Defuse',
            'exploding_kitten': 'Exploding Kitten',
            'tacocat': 'Taco Cat',
            'rainbow_cat': 'Rainbow Cat',
            'potato_cat': 'Potato Cat',
            'beard_cat': 'Beard Cat',
            'cattermelon': 'Cattermelon'
        };
        return names[cardType] || cardType;
    }

    static createCardElement(card, clickable = true) {
        const cardElement = document.createElement('div');
        cardElement.className = `card ${card.type}`;
        cardElement.dataset.cardId = card.id;
        cardElement.dataset.cardType = card.type;
        
        if (!clickable) {
            cardElement.style.cursor = 'default';
        }

        const icon = document.createElement('div');
        icon.className = 'card-icon';
        icon.textContent = this.getCardIcon(card.type);

        const name = document.createElement('div');
        name.className = 'card-name';
        name.textContent = this.getCardName(card.type);

        cardElement.appendChild(icon);
        cardElement.appendChild(name);

        // Add tooltip with description
        cardElement.title = card.description || this.getCardDescription(card.type);

        return cardElement;
    }

    static getCardDescription(cardType) {
        const descriptions = {
            'attack': 'End your turn without drawing. Next player takes 2 turns.',
            'skip': 'End your turn without drawing a card.',
            'favor': 'Force another player to give you a card.',
            'shuffle': 'Shuffle the deck.',
            'see_future': 'See the top 3 cards of the deck.',
            'nope': 'Stop any action except Exploding Kitten or Defuse.',
            'defuse': 'Use to defuse an Exploding Kitten.',
            'exploding_kitten': 'You explode! Game over unless you defuse.',
            'tacocat': 'Cat card - collect pairs to steal cards.',
            'rainbow_cat': 'Cat card - collect pairs to steal cards.',
            'potato_cat': 'Cat card - collect pairs to steal cards.',
            'beard_cat': 'Cat card - collect pairs to steal cards.',
            'cattermelon': 'Cat card - collect pairs to steal cards.'
        };
        return descriptions[cardType] || 'Unknown card';
    }

    static createCardBack() {
        const cardElement = document.createElement('div');
        cardElement.className = 'card card-back';
        cardElement.style.background = 'linear-gradient(135deg, #4a5568, #2d3748)';
        cardElement.style.color = 'white';
        cardElement.style.cursor = 'default';

        const icon = document.createElement('div');
        icon.className = 'card-icon';
        icon.textContent = '🃏';

        const name = document.createElement('div');
        name.className = 'card-name';
        name.textContent = 'Card';

        cardElement.appendChild(icon);
        cardElement.appendChild(name);

        return cardElement;
    }

    static needsTarget(cardType) {
        return ['favor'].includes(cardType) || this.isCatCard(cardType);
    }

    static isCatCard(cardType) {
        return ['tacocat', 'rainbow_cat', 'potato_cat', 'beard_cat', 'cattermelon'].includes(cardType);
    }

    static canPlayCard(cardType, gameState, playerId) {
        // Check if it's the player's turn
        if (!gameState.isMyTurn) {
            return { canPlay: false, reason: "Not your turn" };
        }

        // Check for pending actions
        if (gameState.pendingAction) {
            return { canPlay: false, reason: "Waiting for response to previous action" };
        }

        // Special rules for specific cards
        switch (cardType) {
            case 'nope':
                return { canPlay: false, reason: "Nope can only be played in response to other cards" };
            
            case 'defuse':
                return { canPlay: false, reason: "Defuse can only be used when drawing an Exploding Kitten" };
            
            default:
                return { canPlay: true };
        }
    }

    static getValidTargets(cardType, gameState, playerId) {
        if (!this.needsTarget(cardType)) {
            return [];
        }

        return gameState.players.filter(player => 
            player.id !== playerId && 
            player.isAlive && 
            player.handSize > 0
        );
    }

    static animateCardPlay(cardElement) {
        cardElement.style.transform = 'scale(1.2) rotate(10deg)';
        cardElement.style.opacity = '0.7';
        
        setTimeout(() => {
            cardElement.style.transform = '';
            cardElement.style.opacity = '';
        }, 300);
    }

    static animateCardDraw(targetElement) {
        const tempCard = this.createCardBack();
        tempCard.style.position = 'absolute';
        tempCard.style.top = '50%';
        tempCard.style.left = '50%';
        tempCard.style.transform = 'translate(-50%, -50%) scale(0)';
        tempCard.style.zIndex = '1000';
        tempCard.style.transition = 'all 0.5s ease';

        document.body.appendChild(tempCard);

        // Animate to target
        setTimeout(() => {
            const targetRect = targetElement.getBoundingClientRect();
            tempCard.style.top = targetRect.top + 'px';
            tempCard.style.left = targetRect.left + 'px';
            tempCard.style.transform = 'scale(1)';
        }, 50);

        // Remove after animation
        setTimeout(() => {
            document.body.removeChild(tempCard);
        }, 600);
    }

    static highlightPlayableCards(hand, gameState, playerId) {
        hand.querySelectorAll('.card').forEach(cardElement => {
            const cardType = cardElement.dataset.cardType;
            const canPlay = this.canPlayCard(cardType, gameState, playerId);
            
            if (canPlay.canPlay) {
                cardElement.classList.add('playable');
                cardElement.style.opacity = '1';
            } else {
                cardElement.classList.remove('playable');
                cardElement.style.opacity = '0.6';
                cardElement.title = canPlay.reason;
            }
        });
    }

    static createPlayerCard(player, isCurrentPlayer = false) {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';
        playerCard.dataset.playerId = player.id;

        if (isCurrentPlayer) {
            playerCard.classList.add('current-player');
        }

        if (!player.isAlive) {
            playerCard.classList.add('eliminated');
        }

        const playerName = document.createElement('div');
        playerName.className = 'player-name';
        playerName.textContent = player.name;

        const playerStats = document.createElement('div');
        playerStats.className = 'player-stats';

        const handSize = document.createElement('span');
        handSize.textContent = `${player.handSize} cards`;

        const status = document.createElement('span');
        if (!player.isAlive) {
            status.textContent = '💀 Eliminated';
            status.style.color = '#f56565';
        } else if (isCurrentPlayer) {
            status.textContent = '👑 Current Turn';
            status.style.color = '#48bb78';
        } else {
            status.textContent = '✓ Alive';
            status.style.color = '#48bb78';
        }

        playerStats.appendChild(handSize);
        playerStats.appendChild(status);

        playerCard.appendChild(playerName);
        playerCard.appendChild(playerStats);

        return playerCard;
    }

    static updateDiscardPile(topCard) {
        const discardPile = document.getElementById('discard-pile');
        if (!discardPile) return;

        if (topCard) {
            discardPile.innerHTML = '';
            const cardElement = this.createCardElement(topCard, false);
            cardElement.style.width = '100%';
            cardElement.style.height = '100%';
            cardElement.style.fontSize = '0.7rem';
            discardPile.appendChild(cardElement);
        } else {
            discardPile.innerHTML = '<div class="card-back">Discard</div>';
        }
    }

    static createLogMessage(message, timestamp) {
        const logMessage = document.createElement('div');
        logMessage.className = 'log-message';
        
        const time = new Date(timestamp).toLocaleTimeString();
        logMessage.innerHTML = `<small>${time}</small> ${message}`;
        
        return logMessage;
    }

    static showCardTooltip(cardElement, event) {
        // Remove existing tooltips
        document.querySelectorAll('.card-tooltip').forEach(tooltip => {
            tooltip.remove();
        });

        const tooltip = document.createElement('div');
        tooltip.className = 'card-tooltip';
        tooltip.style.position = 'absolute';
        tooltip.style.background = 'rgba(0,0,0,0.9)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '8px 12px';
        tooltip.style.borderRadius = '6px';
        tooltip.style.fontSize = '0.8rem';
        tooltip.style.zIndex = '1001';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.maxWidth = '200px';
        tooltip.textContent = cardElement.title;

        document.body.appendChild(tooltip);

        const rect = cardElement.getBoundingClientRect();
        tooltip.style.left = (rect.left + rect.width / 2 - tooltip.offsetWidth / 2) + 'px';
        tooltip.style.top = (rect.top - tooltip.offsetHeight - 5) + 'px';

        // Remove tooltip after delay
        setTimeout(() => {
            if (tooltip.parentNode) {
                tooltip.remove();
            }
        }, 3000);
    }

    static hideCardTooltip() {
        document.querySelectorAll('.card-tooltip').forEach(tooltip => {
            tooltip.remove();
        });
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CardRenderer;
}
