const fs = require('fs');
const path = require('path');
const winston = require('winston');

const logDirectory = path.resolve(
  process.env.LOG_DIR || path.join(__dirname, '../logs')
);

fs.mkdirSync(logDirectory, { recursive: true });

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    const details = Object.keys(metadata).length > 0
      ? ` ${JSON.stringify(metadata)}`
      : '';
    return `${timestamp} ${level}: ${message}${details}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: {
    service: 'exploding-kittens-backend',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    new winston.transports.File({
      filename: path.join(logDirectory, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(logDirectory, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'test') {
  logger.add(new winston.transports.Console({ format: consoleFormat }));
}

logger.logDirectory = logDirectory;

module.exports = logger;
