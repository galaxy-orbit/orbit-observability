export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  correlationId?: string;
  requestId?: string;
  userId?: string;
  service?: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  service?: string;
  pretty?: boolean;
  output?: (entry: LogEntry) => void;
}

export interface LogContext {
  correlationId?: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const DEFAULT_OPTIONS: Required<LoggerOptions> = {
  level: 'info',
  service: 'app',
  pretty: false,
  output: defaultOutput,
};

function defaultOutput(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

function prettyOutput(entry: LogEntry): void {
  const levelColors: Record<LogLevel, string> = {
    trace: '\x1b[90m',
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    fatal: '\x1b[35m',
  };
  
  const reset = '\x1b[0m';
  const color = levelColors[entry.level];
  const level = entry.level.toUpperCase().padEnd(5);
  
  let msg = `${color}[${entry.timestamp}] ${level}${reset} ${entry.message}`;
  
  const extra: Record<string, unknown> = { ...entry };
  delete extra.level;
  delete extra.message;
  delete extra.timestamp;
  delete extra.service;
  
  if (Object.keys(extra).length > 0) {
    msg += ` ${JSON.stringify(extra)}`;
  }
  
  console.log(msg);
}

export class Logger {
  private options: Required<LoggerOptions>;
  private context: LogContext = {};

  constructor(options: LoggerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    if (this.options.pretty) {
      this.options.output = prettyOutput;
    }
  }

  child(context: LogContext): Logger {
    const child = new Logger(this.options);
    child.context = { ...this.context, ...context };
    return child;
  }

  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.options.level];
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: this.options.service,
      ...this.context,
      ...data,
    };

    this.options.output(entry);
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.log('trace', message, data);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  fatal(message: string, data?: Record<string, unknown>): void {
    this.log('fatal', message, data);
  }
}

const correlationStore = new Map<number, string>();
let asyncIdCounter = 0;

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function setCorrelationId(id: string): number {
  const asyncId = ++asyncIdCounter;
  correlationStore.set(asyncId, id);
  return asyncId;
}

export function getCorrelationId(asyncId?: number): string | undefined {
  if (asyncId !== undefined) {
    return correlationStore.get(asyncId);
  }
  return undefined;
}

export function clearCorrelationId(asyncId: number): void {
  correlationStore.delete(asyncId);
}

export function createRequestLogger(baseLogger: Logger) {
  return async (request: Request, next: () => Promise<Response>): Promise<Response> => {
    const correlationId = request.headers.get('x-correlation-id') || generateCorrelationId();
    const requestId = generateCorrelationId();
    const url = new URL(request.url);
    
    const logger = baseLogger.child({
      correlationId,
      requestId,
      method: request.method,
      path: url.pathname,
    });

    const startTime = performance.now();
    
    logger.info('Request started');

    try {
      const response = await next();
      
      const duration = performance.now() - startTime;
      
      logger.info('Request completed', {
        status: response.status,
        duration: `${duration.toFixed(2)}ms`,
      });

      const newResponse = new Response(response.body, response);
      newResponse.headers.set('x-correlation-id', correlationId);
      newResponse.headers.set('x-request-id', requestId);
      
      return newResponse;
    } catch (error: any) {
      const duration = performance.now() - startTime;
      
      logger.error('Request failed', {
        error: error.message,
        stack: error.stack,
        duration: `${duration.toFixed(2)}ms`,
      });
      
      throw error;
    }
  };
}

let globalLogger: Logger | null = null;

export function initLogger(options?: LoggerOptions): Logger {
  globalLogger = new Logger(options);
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  getLogger()[level](message, data);
}
