const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ActivityMetrics = require('../server/activityMetrics');

function createMetrics(windowMs = 1000) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-metrics-'));
  return {
    directory,
    metrics: new ActivityMetrics({
      windowMs,
      storagePath: path.join(directory, 'metrics.json')
    })
  };
}

test('counts a visitor once across multiple live sockets', () => {
  const { directory, metrics } = createMetrics();

  metrics.identify('socket-1', 'visitor-one', 1000);
  metrics.identify('socket-2', 'visitor-one', 1000);
  metrics.identify('socket-3', 'visitor-two', 1000);

  assert.deepEqual(metrics.getSnapshot(1000), {
    liveUsers: 2,
    uniqueUsers24h: 2
  });

  metrics.disconnect('socket-1', 1100);
  assert.equal(metrics.getSnapshot(1100).liveUsers, 2);
  metrics.disconnect('socket-2', 1100);
  assert.equal(metrics.getSnapshot(1100).liveUsers, 1);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('prunes expired visitors and restores recent activity from disk', () => {
  const { directory, metrics } = createMetrics();
  const storagePath = metrics.storagePath;

  metrics.identify('socket-old', 'visitor-old', 1000);
  metrics.disconnect('socket-old', 1000);
  metrics.identify('socket-new', 'visitor-new', 1800);
  metrics.disconnect('socket-new', 1800);

  assert.deepEqual(metrics.getSnapshot(2001), {
    liveUsers: 0,
    uniqueUsers24h: 1
  });

  const restored = new ActivityMetrics({
    windowMs: 1000,
    storagePath,
    now: () => 2001
  });
  assert.equal(restored.visitorLastSeen.get('visitor-new'), 1800);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('keeps a continuously connected visitor in the rolling window', () => {
  const { directory, metrics } = createMetrics();

  metrics.identify('socket-live', 'visitor-live', 1000);

  assert.deepEqual(metrics.getSnapshot(5000), {
    liveUsers: 1,
    uniqueUsers24h: 1
  });

  fs.rmSync(directory, { recursive: true, force: true });
});
