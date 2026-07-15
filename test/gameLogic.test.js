process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../server/gameLogic');

function makeCard(id, type) {
  return {
    id,
    type,
    description: type,
    isCat: false
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
