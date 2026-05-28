/**
 * ============================================
 * Logger Utility - Winston-based with i18n
 * أداة السجلات - مبنية على Winston مع دعم الترجمة
 * ============================================
 */

import winston from 'winston';
import { i18n } from '../i18n';

const { combine, timestamp, printf, colorize } = winston.format;

// Custom format that supports RTL Arabic output
const customFormat = printf(({ level, message, timestamp: ts }) => {
  const dir = i18n.getLocale() === 'ar' ? '\u200F' : ''; // RTL mark for Arabic
  return `${dir}${ts} [${level}] ${message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    customFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), customFormat),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
    }),
  ],
});

// Performance timer for measuring audit speeds
export function perfTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => {
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000; // Return milliseconds
  };
}
