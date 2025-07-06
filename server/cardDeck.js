class CardDeck {
  constructor() {
    this.cards = [];
    this.discardPile = [];
    this.initializeDeck();
  }

  initializeDeck() {
    // Basic card types and quantities for standard Exploding Kittens
    const cardTypes = [
      { type: 'attack', count: 4, description: 'End your turn without drawing. Next player takes 2 turns.' },
      { type: 'skip', count: 4, description: 'End your turn without drawing a card.' },
      { type: 'favor', count: 4, description: 'Force another player to give you a card.' },
      { type: 'shuffle', count: 4, description: 'Shuffle the deck.' },
      { type: 'see_future', count: 5, description: 'See the top 3 cards of the deck.' },
      { type: 'nope', count: 5, description: 'Stop any action except Exploding Kitten or Defuse.' },
      { type: 'tacocat', count: 4, description: 'Cat card - collect pairs to steal cards.' },
      { type: 'rainbow_cat', count: 4, description: 'Cat card - collect pairs to steal cards.' },
      { type: 'potato_cat', count: 4, description: 'Cat card - collect pairs to steal cards.' },
      { type: 'beard_cat', count: 4, description: 'Cat card - collect pairs to steal cards.' },
      { type: 'cattermelon', count: 4, description: 'Cat card - collect pairs to steal cards.' }
    ];

    // Add cards to deck
    cardTypes.forEach(cardType => {
      for (let i = 0; i < cardType.count; i++) {
        this.cards.push({
          id: this.generateCardId(),
          type: cardType.type,
          description: cardType.description,
          isCat: this.isCatCard(cardType.type)
        });
      }
    });

    this.shuffle();
  }

  generateCardId() {
    return Math.random().toString(36).substr(2, 9);
  }

  isCatCard(type) {
    const catCards = ['tacocat', 'rainbow_cat', 'potato_cat', 'beard_cat', 'cattermelon'];
    return catCards.includes(type);
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  drawCard() {
    if (this.cards.length === 0) {
      // Reshuffle discard pile if deck is empty
      this.cards = [...this.discardPile];
      this.discardPile = [];
      this.shuffle();
    }
    return this.cards.pop();
  }

  drawCards(count) {
    const drawnCards = [];
    for (let i = 0; i < count; i++) {
      const card = this.drawCard();
      if (card) drawnCards.push(card);
    }
    return drawnCards;
  }

  addCard(card) {
    this.cards.push(card);
  }

  addCards(cards) {
    this.cards.push(...cards);
  }

  insertCard(card, position = null) {
    if (position === null || position >= this.cards.length) {
      this.cards.push(card);
    } else {
      this.cards.splice(position, 0, card);
    }
  }

  peekTop(count = 1) {
    return this.cards.slice(-count).reverse();
  }

  discard(card) {
    this.discardPile.push(card);
  }

  discardCards(cards) {
    this.discardPile.push(...cards);
  }

  getTopDiscardCard() {
    return this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null;
  }

  getRemainingCount() {
    return this.cards.length;
  }

  // Setup methods for game initialization
  setupForPlayers(playerCount) {
    // Remove exploding kittens and defuse cards for setup
    this.cards = this.cards.filter(card => 
      card.type !== 'exploding_kitten' && card.type !== 'defuse'
    );

    // Add defuse cards (one per player + extras)
    const defuseCount = playerCount + 2;
    for (let i = 0; i < defuseCount; i++) {
      this.cards.push({
        id: this.generateCardId(),
        type: 'defuse',
        description: 'Use to defuse an Exploding Kitten.',
        isCat: false
      });
    }

    // Add exploding kittens (one less than player count)
    const explodingKittenCount = playerCount - 1;
    for (let i = 0; i < explodingKittenCount; i++) {
      this.cards.push({
        id: this.generateCardId(),
        type: 'exploding_kitten',
        description: 'You explode! Game over unless you defuse.',
        isCat: false
      });
    }

    this.shuffle();
  }

  // Deal initial hands
  dealInitialHands(playerCount) {
    const hands = [];
    
    // Each player gets 4 cards + 1 defuse card
    for (let i = 0; i < playerCount; i++) {
      const hand = [];
      
      // Draw 4 regular cards (make sure no exploding kittens in initial deal)
      let cardsDrawn = 0;
      while (cardsDrawn < 4 && this.cards.length > 0) {
        const card = this.drawCard();
        if (card.type !== 'exploding_kitten') {
          hand.push(card);
          cardsDrawn++;
        } else {
          // Put exploding kitten back in deck
          this.insertCard(card, Math.floor(Math.random() * this.cards.length));
        }
      }
      
      // Add one defuse card
      const defuseCard = this.cards.find(card => card.type === 'defuse');
      if (defuseCard) {
        const defuseIndex = this.cards.indexOf(defuseCard);
        this.cards.splice(defuseIndex, 1);
        hand.push(defuseCard);
      }
      
      hands.push(hand);
    }

    // Shuffle remaining deck
    this.shuffle();
    
    return hands;
  }
}

module.exports = CardDeck;
