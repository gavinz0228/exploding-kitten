const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DAY_MS = 24 * 60 * 60 * 1000;

class ActivityMetrics {
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? DAY_MS;
    this.now = options.now ?? Date.now;
    this.storagePath = options.storagePath ?? path.join(
      logger.logDirectory,
      'activity-metrics.json'
    );
    this.visitorLastSeen = new Map();
    this.socketVisitors = new Map();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.storagePath)) return;

      const stored = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      Object.entries(stored.visitors || {}).forEach(([visitorId, lastSeen]) => {
        if (typeof lastSeen === 'number') {
          this.visitorLastSeen.set(visitorId, lastSeen);
        }
      });
      this.prune(this.now(), false);
    } catch (error) {
      logger.warn('activity_metrics_load_failed', {
        storagePath: this.storagePath,
        error: error.message
      });
    }
  }

  identify(socketId, visitorId, now = this.now()) {
    if (!this.isValidVisitorId(visitorId)) return false;

    this.socketVisitors.set(socketId, visitorId);
    this.visitorLastSeen.set(visitorId, now);
    this.prune(now, false);
    this.persist();
    return true;
  }

  disconnect(socketId, now = this.now()) {
    const visitorId = this.socketVisitors.get(socketId);
    if (!visitorId) return false;

    this.socketVisitors.delete(socketId);
    this.visitorLastSeen.set(visitorId, now);
    this.persist();
    return true;
  }

  getSnapshot(now = this.now()) {
    this.prune(now);
    return {
      liveUsers: new Set(this.socketVisitors.values()).size,
      uniqueUsers24h: this.visitorLastSeen.size
    };
  }

  prune(now = this.now(), persist = true) {
    const cutoff = now - this.windowMs;
    const liveVisitors = new Set(this.socketVisitors.values());
    let changed = false;

    this.visitorLastSeen.forEach((lastSeen, visitorId) => {
      if (lastSeen < cutoff && !liveVisitors.has(visitorId)) {
        this.visitorLastSeen.delete(visitorId);
        changed = true;
      }
    });

    if (changed && persist) this.persist();
    return changed;
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      const temporaryPath = `${this.storagePath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify({
        visitors: Object.fromEntries(this.visitorLastSeen),
        updatedAt: this.now()
      }));
      fs.renameSync(temporaryPath, this.storagePath);
    } catch (error) {
      logger.warn('activity_metrics_persist_failed', {
        storagePath: this.storagePath,
        error: error.message
      });
    }
  }

  isValidVisitorId(visitorId) {
    return typeof visitorId === 'string' &&
      visitorId.length >= 8 &&
      visitorId.length <= 128 &&
      /^[a-zA-Z0-9_-]+$/.test(visitorId);
  }
}

module.exports = ActivityMetrics;
