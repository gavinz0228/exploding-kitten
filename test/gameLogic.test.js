process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../server/gameLogic');

function makeCard(id, type, isCat = false) {
  return {
    id,
    type,
    description: type,
    isCat
  };
}

function makePlayer(id, name, hand) {
  return {
    id,
    name,
    hand,
    isAlive: true,
    isReady: false,
    connected: true,
    disconnectedAt: null
  };
}

function createPlayingGame() {
  const game = new Game('TEST01');
  game.players = [
    makePlayer('player-1', 'One', [
      makeCard('skip-1', 'skip'),
      makeCard('attack-1', 'attack')
    ]),
    makePlayer('player-2', 'Two', [
      makeCard('nope-1', 'nope'),
      makeCard('favor-1', 'favor')
    ])
  ];
  game.gameState = 'playing';
  game.currentPlayerIndex = 0;
  return game;
}

function captureTimers(run) {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const timers = [];

  global.setTimeout = callback => {
    const timer = { callback, cleared: false };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = timer => {
    if (timer) timer.cleared = true;
  };

  try {
    return run(timers);
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
}

test('blocks draw and other actions until Skip resolves, then broadcasts the new turn', () => {
  captureTimers(timers => {
    const game = createPlayingGame();
    const broadcasts = [];
    game.setBroadcastCallback(() => {
      broadcasts.push(game.getPlayerGameState('player-2'));
    });

    assert.equal(game.playCard('player-1', 'skip-1').success, true);
    assert.ok(game.nopeWindow);
    assert.equal(
      game.drawCard('player-1').message,
      'Waiting for the current action to resolve'
    );
    assert.equal(
      game.playCard('player-1', 'attack-1').message,
      'Waiting for the current action to resolve'
    );

    timers[0].callback();

    assert.equal(game.nopeWindow, null);
    assert.equal(game.getCurrentPlayer().id, 'player-2');
    assert.equal(broadcasts.at(-1).isMyTurn, true);
    assert.equal(broadcasts.at(-1).nopeWindow, null);
  });
});

test('a Nope cancels Skip, closes the response window, and removes only the Nope card', () => {
  captureTimers(timers => {
    const game = createPlayingGame();
    const broadcasts = [];
    game.setBroadcastCallback(() => {
      broadcasts.push(game.getPlayerGameState('player-2'));
    });

    game.playCard('player-1', 'skip-1');
    const nopeResult = game.playCard('player-2', 'nope-1');

    assert.equal(nopeResult.success, true);
    assert.deepEqual(
      game.getPlayer('player-2').hand.map(card => card.id),
      ['favor-1']
    );

    timers[1].callback();

    assert.equal(game.nopeWindow, null);
    assert.equal(game.getCurrentPlayer().id, 'player-1');
    assert.equal(broadcasts.at(-1).nopeWindow, null);
  });
});

test('requires enough players to start and deals five cards with a guaranteed Defuse', () => {
  const game = new Game('START1');
  game.addPlayer('player-1', 'One');

  assert.equal(game.startGame().message, 'Need at least 2 players');

  game.addPlayer('player-2', 'Two');
  const result = game.startGame();

  assert.equal(result.success, true);
  assert.equal(game.gameState, 'playing');
  assert.equal(game.players.length, 2);
  game.players.forEach(player => {
    assert.equal(player.hand.length, 5);
    assert.equal(player.hand.some(card => card.type === 'defuse'), true);
    assert.equal(player.hand.some(card => card.type === 'exploding_kitten'), false);
  });
  assert.equal(game.deck.getRemainingCount(), 41);
});

test('enforces player capacity, duplicate membership, and joining rules', () => {
  const game = new Game('JOIN01');

  assert.equal(game.addPlayer('player-1', 'One').success, true);
  assert.equal(game.addPlayer('player-1', 'Duplicate').message, 'Player already in game');
  for (let index = 2; index <= 5; index++) {
    assert.equal(game.addPlayer(`player-${index}`, `Player ${index}`).success, true);
  }
  assert.equal(game.addPlayer('player-6', 'Six').message, 'Game is full');

  game.gameState = 'playing';
  game.players.pop();
  assert.equal(game.addPlayer('player-6', 'Six').message, 'Game already in progress');
});

test('drawing a normal card adds it to the hand and advances the turn', () => {
  const game = createPlayingGame();
  const drawnCard = makeCard('drawn-1', 'shuffle');
  game.deck.cards = [drawnCard];

  const result = game.drawCard('player-1');

  assert.equal(result.success, true);
  assert.equal(result.data.drawnCard, drawnCard);
  assert.equal(game.getPlayer('player-1').hand.at(-1), drawnCard);
  assert.equal(game.getCurrentPlayer().id, 'player-2');
  assert.equal(game.deck.getRemainingCount(), 0);
});

test('rejects draws and card plays from the wrong player without mutating state', () => {
  const game = createPlayingGame();
  const originalHand = [...game.getPlayer('player-2').hand];
  game.deck.cards = [makeCard('drawn-1', 'shuffle')];

  assert.equal(game.drawCard('player-2').message, 'Not your turn');
  assert.equal(game.playCard('player-2', 'favor-1', 'player-1').message, 'Not your turn');
  assert.deepEqual(game.getPlayer('player-2').hand, originalHand);
  assert.equal(game.deck.getRemainingCount(), 1);
  assert.equal(game.getCurrentPlayer().id, 'player-1');
});

test('an Attack gives the next player two draws before advancing', () => {
  captureTimers(timers => {
    const game = createPlayingGame();
    game.deck.cards = [
      makeCard('drawn-2', 'shuffle'),
      makeCard('drawn-1', 'favor')
    ];

    assert.equal(game.playCard('player-1', 'attack-1').success, true);
    timers[0].callback();

    assert.equal(game.getCurrentPlayer().id, 'player-2');
    assert.equal(game.turnsRemaining, 2);

    game.drawCard('player-2');
    assert.equal(game.getCurrentPlayer().id, 'player-2');
    assert.equal(game.turnsRemaining, 1);

    game.drawCard('player-2');
    assert.equal(game.getCurrentPlayer().id, 'player-1');
    assert.equal(game.turnsRemaining, 1);
  });
});

test('Favor waits for the target and transfers exactly the selected card', () => {
  captureTimers(timers => {
    const game = createPlayingGame();
    const target = game.getPlayer('player-2');
    const offeredCard = makeCard('offered-1', 'shuffle');
    target.hand.push(offeredCard);

    assert.equal(game.playCard('player-1', 'skip-1').success, true);
    timers[0].callback();
    game.currentPlayerIndex = 0;
    game.getPlayer('player-1').hand.push(makeCard('favor-own', 'favor'));

    assert.equal(game.playCard('player-1', 'favor-own', 'player-2').success, true);
    timers[1].callback();
    assert.equal(game.pendingAction.type, 'favor');

    assert.equal(
      game.respondToPendingAction('player-1', { cardId: offeredCard.id }).message,
      'Not your action to respond to'
    );
    assert.equal(game.pendingAction.type, 'favor');
    assert.equal(
      game.respondToPendingAction('player-2', { cardId: 'missing' }).message,
      'Card not found'
    );
    assert.equal(game.pendingAction.type, 'favor');

    const result = game.respondToPendingAction('player-2', { cardId: offeredCard.id });
    assert.equal(result.success, true);
    assert.equal(game.pendingAction, null);
    assert.equal(target.hand.includes(offeredCard), false);
    assert.equal(game.getPlayer('player-1').hand.includes(offeredCard), true);
  });
});

test('drawing an Exploding Kitten consumes a Defuse and requires reinsertion', () => {
  const game = createPlayingGame();
  const player = game.getPlayer('player-1');
  const defuse = makeCard('defuse-1', 'defuse');
  const kitten = makeCard('kitten-1', 'exploding_kitten');
  player.hand.push(defuse);
  game.deck.cards = [kitten];

  const result = game.drawCard('player-1');

  assert.equal(result.success, true);
  assert.equal(result.data.defused, true);
  assert.equal(player.isAlive, true);
  assert.equal(player.hand.includes(defuse), false);
  assert.equal(game.deck.discardPile.includes(defuse), true);
  assert.equal(game.pendingAction.type, 'place_exploding_kitten');
  assert.equal(game.getCurrentPlayer().id, 'player-1');

  assert.equal(
    game.respondToPendingAction('player-2', { position: 0 }).message,
    'Not your action'
  );
  assert.ok(game.pendingAction);

  assert.equal(
    game.respondToPendingAction('player-1', { position: 0 }).success,
    true
  );
  assert.equal(game.pendingAction, null);
  assert.equal(game.deck.cards[0], kitten);
  assert.equal(game.getCurrentPlayer().id, 'player-2');
});

test('an undefused explosion ends a two-player game and declares the survivor', () => {
  const game = createPlayingGame();
  const kitten = makeCard('kitten-1', 'exploding_kitten');
  game.deck.cards = [kitten];

  const result = game.drawCard('player-1');

  assert.equal(result.success, true);
  assert.equal(result.data.exploded, true);
  assert.equal(result.data.gameEnded, true);
  assert.equal(game.getPlayer('player-1').isAlive, false);
  assert.equal(game.gameState, 'finished');
  assert.equal(game.winner.id, 'player-2');
});

test('a matching cat pair performs a random steal only after its Nope window resolves', () => {
  captureTimers(timers => {
    const game = createPlayingGame();
    const player = game.getPlayer('player-1');
    const target = game.getPlayer('player-2');
    const firstCat = makeCard('cat-1', 'tacocat', true);
    const secondCat = makeCard('cat-2', 'tacocat', true);
    const stolenCard = makeCard('stolen-1', 'shuffle');
    player.hand = [firstCat, secondCat];
    target.hand = [stolenCard];

    const result = game.playMultipleCards(
      'player-1',
      [firstCat.id, secondCat.id],
      firstCat.id,
      'player-2'
    );

    assert.equal(result.success, true);
    assert.equal(player.hand.length, 0);
    assert.equal(game.deck.discardPile.length, 2);
    assert.equal(target.hand.length, 1);

    timers[0].callback();

    assert.deepEqual(player.hand, [stolenCard]);
    assert.equal(target.hand.length, 0);
    assert.equal(game.nopeWindow, null);
  });
});

test('multiple-card play validates matching cat cards and targets before discarding', () => {
  const game = createPlayingGame();
  const player = game.getPlayer('player-1');
  const firstCat = makeCard('cat-1', 'tacocat', true);
  const secondCat = makeCard('cat-2', 'rainbow_cat', true);
  player.hand = [firstCat, secondCat];

  assert.equal(
    game.playMultipleCards(
      'player-1',
      [firstCat.id, secondCat.id],
      firstCat.id,
      'player-2'
    ).message,
    'All cards must be of the same type'
  );
  assert.equal(
    game.playMultipleCards(
      'player-1',
      [firstCat.id],
      firstCat.id,
      'player-2'
    ).message,
    'Need at least 2 matching cards to steal'
  );
  assert.deepEqual(player.hand, [firstCat, secondCat]);
  assert.equal(game.deck.discardPile.length, 0);
});

test('removing the current player during play advances to the next survivor', () => {
  const game = createPlayingGame();
  game.players.push(makePlayer('player-3', 'Three', [
    makeCard('shuffle-3', 'shuffle')
  ]));

  assert.equal(game.removePlayer('player-1'), true);
  assert.equal(game.getPlayer('player-1').isAlive, false);
  assert.equal(game.getCurrentPlayer().id, 'player-2');
  assert.equal(game.gameState, 'playing');
  assert.equal(game.winner, null);
});

test('player-specific game state exposes only that player hand', () => {
  const game = createPlayingGame();
  const state = game.getPlayerGameState('player-1');

  assert.equal(state.isMyTurn, true);
  assert.equal(state.playerHand, game.getPlayer('player-1').hand);
  assert.equal(state.players[1].hand, undefined);
  assert.equal(state.players[1].handSize, 2);
});

test('resetting a finished game clears hands, actions, and winner', () => {
  const game = createPlayingGame();
  game.getPlayer('player-1').isAlive = false;
  game.checkGameEnd();
  game.pendingAction = { type: 'favor' };

  const result = game.resetGame();

  assert.equal(result.success, true);
  assert.equal(game.gameState, 'waiting');
  assert.equal(game.winner, null);
  assert.equal(game.pendingAction, null);
  assert.equal(game.turnsRemaining, 1);
  game.players.forEach(player => {
    assert.equal(player.isAlive, true);
    assert.deepEqual(player.hand, []);
  });
  assert.match(game.gameLog[0].message, /Game has been reset/);
});
