process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const RoomManager = require('../server/roomManager');

function createIo() {
  return {
    sockets: {
      sockets: new Map()
    }
  };
}

function createManager(options = {}) {
  return new RoomManager(createIo(), {
    disconnectGraceMs: 1000,
    finishedRoomTtlMs: 60 * 60 * 1000,
    ...options
  });
}

test('deletes a room after every player has been disconnected past the grace period', () => {
  const manager = createManager();
  const created = manager.createRoom('player-1', 'Player One', 'socket-1');

  manager.handleSocketDisconnect('socket-1');
  const disconnectedAt = manager.getRoom(created.roomId).emptySince;

  assert.equal(manager.cleanupEmptyRooms(disconnectedAt + 999).cleanedCount, 0);
  assert.ok(manager.getRoom(created.roomId));

  const result = manager.cleanupEmptyRooms(disconnectedAt + 1000);
  assert.equal(result.cleanedCount, 1);
  assert.equal(manager.getRoom(created.roomId), undefined);
  assert.equal(manager.playerRooms.has('player-1'), false);
});

test('preserves a room when its player reconnects during the grace period', () => {
  const manager = createManager();
  const created = manager.createRoom('player-1', 'Player One', 'socket-1');

  manager.handleSocketDisconnect('socket-1');
  const disconnectedAt = manager.getRoom(created.roomId).emptySince;
  const rejoined = manager.joinRoom(
    created.roomId,
    'player-1',
    'Player One',
    'socket-2'
  );

  assert.equal(rejoined.success, true);
  assert.equal(rejoined.reconnected, true);
  assert.equal(manager.getRoom(created.roomId).getPlayer('player-1').connected, true);
  assert.equal(manager.cleanupEmptyRooms(disconnectedAt + 5000).cleanedCount, 0);
  assert.ok(manager.getRoom(created.roomId));
});

test('expires a disconnected player while preserving an active connected player', () => {
  const manager = createManager();
  const created = manager.createRoom('player-1', 'Player One', 'socket-1');
  manager.joinRoom(created.roomId, 'player-2', 'Player Two', 'socket-2');
  manager.startGame(created.roomId, 'player-1');

  manager.handleSocketDisconnect('socket-2');
  const playerTwo = manager.getRoom(created.roomId).getPlayer('player-2');
  const result = manager.cleanupEmptyRooms(playerTwo.disconnectedAt + 1000);

  assert.equal(result.cleanedCount, 0);
  assert.ok(manager.getRoom(created.roomId));
  assert.equal(playerTwo.connected, false);
  assert.equal(playerTwo.isAlive, false);
  assert.equal(manager.playerRooms.has('player-2'), false);
  assert.equal(manager.getRoom(created.roomId).winner.id, 'player-1');
  assert.equal(
    manager.getRoomList('player-2').some(room => room.roomId === created.roomId),
    false
  );
});

test('advances the turn when the current player expires', () => {
  const manager = createManager();
  const created = manager.createRoom('player-1', 'One', 'socket-1');
  manager.joinRoom(created.roomId, 'player-2', 'Two', 'socket-2');
  manager.joinRoom(created.roomId, 'player-3', 'Three', 'socket-3');
  manager.startGame(created.roomId, 'player-1');

  const game = manager.getRoom(created.roomId);
  const expiredPlayer = game.getCurrentPlayer();
  const expiredSocket = manager.getSocketFromPlayerId(expiredPlayer.id);
  manager.handleSocketDisconnect(expiredSocket);
  manager.cleanupEmptyRooms(expiredPlayer.disconnectedAt + 1000);

  assert.equal(expiredPlayer.isAlive, false);
  assert.notEqual(game.getCurrentPlayer().id, expiredPlayer.id);
  assert.equal(game.getCurrentPlayer().isAlive, true);
  assert.equal(game.gameState, 'playing');
});

test('deletes the old room when its last members explicitly leave', () => {
  const manager = createManager();
  const oldRoom = manager.createRoom('player-1', 'One', 'socket-1');
  manager.joinRoom(oldRoom.roomId, 'player-2', 'Two', 'socket-2');
  manager.startGame(oldRoom.roomId, 'player-1');

  manager.leaveRoom('player-1');
  assert.ok(manager.getRoom(oldRoom.roomId));

  const result = manager.leaveRoom('player-2');
  assert.equal(result.roomRemoved, true);
  assert.equal(manager.getRoom(oldRoom.roomId), undefined);
});

test('lists available waiting rooms and only the requesting player own active room', () => {
  const manager = createManager();
  const waitingRoom = manager.createRoom('waiting-host', 'Waiting', 'socket-w');
  const activeRoom = manager.createRoom('active-host', 'Active', 'socket-a1');
  manager.joinRoom(activeRoom.roomId, 'active-guest', 'Guest', 'socket-a2');
  manager.startGame(activeRoom.roomId, 'active-host');

  const publicRooms = manager.getRoomList('outsider');
  assert.deepEqual(publicRooms.map(room => room.roomId), [waitingRoom.roomId]);

  const memberRooms = manager.getRoomList('active-host');
  const ownRoom = memberRooms.find(room => room.roomId === activeRoom.roomId);
  assert.ok(ownRoom);
  assert.equal(ownRoom.isRejoin, true);
  assert.equal(ownRoom.canJoin, true);
  assert.equal(ownRoom.gameState, 'playing');
});
