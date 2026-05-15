import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'SYS:standard'
    }
  }
});

// Baileys child logger — silent unless LOG_LEVEL=debug
export const baileysLogger = logger.child({ module: 'baileys' }, {
  level: config.logLevel === 'debug' ? 'debug' : 'silent'
});

export default logger;
