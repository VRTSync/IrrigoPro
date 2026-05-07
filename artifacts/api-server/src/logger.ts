// Enhanced logging system for IrrigoPro
// Provides comprehensive error tracking and troubleshooting capabilities

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  context?: string;
  userId?: number;
  requestId?: string;
  intuitTid?: string;
  stack?: string;
  metadata?: Record<string, any>;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 10000; // Keep last 10k log entries in memory

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private addLog(entry: LogEntry): void {
    this.logs.push(entry);
    
    // Keep only the most recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Also log to console for immediate visibility
    const logMessage = `[${entry.level.toUpperCase()}] ${entry.timestamp} - ${entry.message}`;
    const contextInfo = entry.context ? ` (${entry.context})` : '';
    const userInfo = entry.userId ? ` [User: ${entry.userId}]` : '';
    const tidInfo = entry.intuitTid ? ` [TID: ${entry.intuitTid}]` : '';
    
    const fullMessage = `${logMessage}${contextInfo}${userInfo}${tidInfo}`;
    
    switch (entry.level) {
      case 'error':
        console.error(fullMessage);
        if (entry.stack) console.error('Stack:', entry.stack);
        break;
      case 'warn':
        console.warn(fullMessage);
        break;
      case 'debug':
        console.debug(fullMessage);
        break;
      default:
        console.log(fullMessage);
    }
  }

  info(message: string, context?: string, metadata?: Record<string, any>): void {
    this.addLog({
      timestamp: this.formatTimestamp(),
      level: 'info',
      message,
      context,
      metadata
    });
  }

  warn(message: string, context?: string, metadata?: Record<string, any>): void {
    this.addLog({
      timestamp: this.formatTimestamp(),
      level: 'warn',
      message,
      context,
      metadata
    });
  }

  error(message: string, error?: Error | any, context?: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level: 'error',
      message,
      context,
      metadata
    };

    if (error) {
      if (error instanceof Error) {
        entry.stack = error.stack;
        entry.message += `: ${error.message}`;
      } else if (typeof error === 'string') {
        entry.message += `: ${error}`;
      } else {
        entry.metadata = { ...entry.metadata, error };
      }
    }

    this.addLog(entry);
  }

  debug(message: string, context?: string, metadata?: Record<string, any>): void {
    if (process.env.NODE_ENV === 'development') {
      this.addLog({
        timestamp: this.formatTimestamp(),
        level: 'debug',
        message,
        context,
        metadata
      });
    }
  }

  // QuickBooks specific logging with intuit_tid
  quickbooks(message: string, intuitTid?: string, context?: string, metadata?: Record<string, any>): void {
    this.addLog({
      timestamp: this.formatTimestamp(),
      level: 'info',
      message,
      context: context || 'QuickBooks API',
      intuitTid,
      metadata
    });
  }

  quickbooksError(message: string, error?: Error | any, intuitTid?: string, context?: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level: 'error',
      message,
      context: context || 'QuickBooks API',
      intuitTid,
      metadata
    };

    if (error) {
      if (error instanceof Error) {
        entry.stack = error.stack;
        entry.message += `: ${error.message}`;
      } else if (typeof error === 'string') {
        entry.message += `: ${error}`;
      } else {
        entry.metadata = { ...entry.metadata, error };
      }
    }

    this.addLog(entry);
  }

  // User context logging for audit trails
  userAction(userId: number, action: string, context?: string, metadata?: Record<string, any>): void {
    this.addLog({
      timestamp: this.formatTimestamp(),
      level: 'info',
      message: `User action: ${action}`,
      context: context || 'User Activity',
      userId,
      metadata
    });
  }

  // Get logs for troubleshooting (filtered by level, context, or time range)
  getLogs(filters?: {
    level?: LogEntry['level'];
    context?: string;
    userId?: number;
    since?: Date;
    limit?: number;
  }): LogEntry[] {
    let filteredLogs = [...this.logs];

    if (filters?.level) {
      filteredLogs = filteredLogs.filter(log => log.level === filters.level);
    }

    if (filters?.context) {
      filteredLogs = filteredLogs.filter(log => 
        log.context?.toLowerCase().includes(filters.context!.toLowerCase())
      );
    }

    if (filters?.userId) {
      filteredLogs = filteredLogs.filter(log => log.userId === filters.userId);
    }

    if (filters?.since) {
      filteredLogs = filteredLogs.filter(log => 
        new Date(log.timestamp) >= filters.since!
      );
    }

    if (filters?.limit) {
      filteredLogs = filteredLogs.slice(-filters.limit);
    }

    return filteredLogs;
  }

  // Get error summary for support
  getErrorSummary(since?: Date): {
    totalErrors: number;
    quickbooksErrors: number;
    recentErrors: LogEntry[];
    errorsByContext: Record<string, number>;
  } {
    const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
    const errors = this.getLogs({ level: 'error', since: sinceDate });

    const errorsByContext: Record<string, number> = {};
    let quickbooksErrors = 0;

    errors.forEach(error => {
      const context = error.context || 'Unknown';
      errorsByContext[context] = (errorsByContext[context] || 0) + 1;
      
      if (context.toLowerCase().includes('quickbooks')) {
        quickbooksErrors++;
      }
    });

    return {
      totalErrors: errors.length,
      quickbooksErrors,
      recentErrors: errors.slice(-10), // Last 10 errors
      errorsByContext
    };
  }

  // Export logs for support team
  exportLogs(filters?: Parameters<typeof this.getLogs>[0]): string {
    const logs = this.getLogs(filters);
    const exportData = {
      exportedAt: this.formatTimestamp(),
      filters,
      totalLogs: logs.length,
      logs: logs.map(log => ({
        ...log,
        // Include stack trace for errors
        ...(log.level === 'error' && log.stack ? { stack: log.stack } : {})
      }))
    };

    return JSON.stringify(exportData, null, 2);
  }
}

// Global logger instance
export const logger = new Logger();

// Middleware to add request context to logs
export function createRequestLogger(req: any, res: any, next: any): void {
  const requestId = Math.random().toString(36).substring(2, 15);
  const userId = req.user?.id;
  
  // Add request context to all subsequent logs
  req.logger = {
    info: (message: string, context?: string, metadata?: Record<string, any>) => 
      logger.info(message, context, { ...metadata, requestId, userId }),
    warn: (message: string, context?: string, metadata?: Record<string, any>) => 
      logger.warn(message, context, { ...metadata, requestId, userId }),
    error: (message: string, error?: Error | any, context?: string, metadata?: Record<string, any>) => 
      logger.error(message, error, context, { ...metadata, requestId, userId }),
    debug: (message: string, context?: string, metadata?: Record<string, any>) => 
      logger.debug(message, context, { ...metadata, requestId, userId }),
    userAction: (action: string, context?: string, metadata?: Record<string, any>) => 
      logger.userAction(userId, action, context, { ...metadata, requestId })
  };

  next();
}

export default logger;