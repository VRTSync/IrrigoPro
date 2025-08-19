// WebSocket Server for Real-time Communication in IrrigoPro
// Provides real-time updates for notifications, work order status, and user activity

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { logger } from './logger';
import { storage } from './storage';

export interface WebSocketMessage {
  type: 'notification' | 'work_order_update' | 'user_activity' | 'system_alert' | 'ping' | 'pong';
  data?: any;
  userId?: number;
  timestamp: string;
}

export interface AuthenticatedWebSocket extends WebSocket {
  userId?: number;
  userRole?: string;
  companyId?: number;
  lastActivity?: Date;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<number, AuthenticatedWebSocket[]> = new Map(); // userId -> WebSocket[]
  private companyClients: Map<number, AuthenticatedWebSocket[]> = new Map(); // companyId -> WebSocket[]

  initialize(server: any): void {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      verifyClient: (info) => {
        // Basic verification - could add more sophisticated auth here
        return true;
      }
    });

    this.wss.on('connection', (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Cleanup inactive connections every 5 minutes
    setInterval(() => {
      this.cleanupInactiveConnections();
    }, 5 * 60 * 1000);

    logger.info('WebSocket server initialized', 'WebSocket Server', {
      path: '/ws',
      cleanupInterval: '5 minutes'
    });
  }

  private async handleConnection(ws: AuthenticatedWebSocket, req: IncomingMessage): Promise<void> {
    try {
      ws.lastActivity = new Date();
      
      // Send welcome message
      this.sendMessage(ws, {
        type: 'system_alert',
        data: { message: 'Connected to IrrigoPro real-time updates' },
        timestamp: new Date().toISOString()
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (error) {
          logger.error('WebSocket message parsing error', error, 'WebSocket Server', {
            userId: ws.userId,
            message: data.toString().substring(0, 100)
          });
        }
      });

      ws.on('close', () => {
        this.handleDisconnection(ws);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket connection error', error, 'WebSocket Server', {
          userId: ws.userId,
          userRole: ws.userRole
        });
        this.handleDisconnection(ws);
      });

      // Set up ping/pong for connection health
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this.sendMessage(ws, {
            type: 'ping',
            timestamp: new Date().toISOString()
          });
        } else {
          clearInterval(pingInterval);
        }
      }, 30000); // Ping every 30 seconds

    } catch (error) {
      logger.error('WebSocket connection setup error', error, 'WebSocket Server');
      ws.close();
    }
  }

  private async handleMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage): Promise<void> {
    ws.lastActivity = new Date();

    switch (message.type) {
      case 'ping':
        this.sendMessage(ws, {
          type: 'pong',
          timestamp: new Date().toISOString()
        });
        break;

      case 'user_activity':
        // Authenticate user if not already done
        if (!ws.userId && message.data?.userId) {
          await this.authenticateConnection(ws, message.data.userId);
        }
        break;

      default:
        logger.warn('Unknown WebSocket message type', 'WebSocket Server', {
          type: message.type,
          userId: ws.userId
        });
    }
  }

  private async authenticateConnection(ws: AuthenticatedWebSocket, userId: number): Promise<void> {
    try {
      const user = await storage.getUser(userId);
      if (user && user.isActive) {
        ws.userId = userId;
        ws.userRole = user.role;
        ws.companyId = user.companyId || undefined;

        // Add to user clients map
        const userClients = this.clients.get(userId) || [];
        userClients.push(ws);
        this.clients.set(userId, userClients);

        // Add to company clients map if user belongs to a company
        if (user.companyId) {
          const companyClients = this.companyClients.get(user.companyId) || [];
          companyClients.push(ws);
          this.companyClients.set(user.companyId, companyClients);
        }

        logger.userActivity(userId, 'WebSocket authenticated', 'WebSocket Server', {
          userRole: user.role,
          companyId: user.companyId
        });

        // Send authentication success
        this.sendMessage(ws, {
          type: 'system_alert',
          data: { 
            message: 'Authentication successful',
            userId: userId,
            role: user.role
          },
          timestamp: new Date().toISOString()
        });
      } else {
        logger.warn('WebSocket authentication failed - invalid user', 'WebSocket Server', {
          userId,
          userExists: !!user,
          userActive: user?.isActive
        });
        ws.close(1008, 'Authentication failed');
      }
    } catch (error) {
      logger.error('WebSocket authentication error', error, 'WebSocket Server', { userId });
      ws.close(1011, 'Authentication error');
    }
  }

  private handleDisconnection(ws: AuthenticatedWebSocket): void {
    if (ws.userId) {
      // Remove from user clients
      const userClients = this.clients.get(ws.userId) || [];
      const updatedUserClients = userClients.filter(client => client !== ws);
      if (updatedUserClients.length === 0) {
        this.clients.delete(ws.userId);
      } else {
        this.clients.set(ws.userId, updatedUserClients);
      }

      // Remove from company clients
      if (ws.companyId) {
        const companyClients = this.companyClients.get(ws.companyId) || [];
        const updatedCompanyClients = companyClients.filter(client => client !== ws);
        if (updatedCompanyClients.length === 0) {
          this.companyClients.delete(ws.companyId);
        } else {
          this.companyClients.set(ws.companyId, updatedCompanyClients);
        }
      }

      logger.userActivity(ws.userId, 'WebSocket disconnected', 'WebSocket Server', {
        userRole: ws.userRole,
        companyId: ws.companyId
      });
    }
  }

  private sendMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error('WebSocket send error', error, 'WebSocket Server', {
          userId: ws.userId,
          messageType: message.type
        });
      }
    }
  }

  private cleanupInactiveConnections(): void {
    const cutoffTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    let cleanedCount = 0;

    // Check all user connections
    for (const [userId, connections] of this.clients.entries()) {
      const activeConnections = connections.filter(ws => {
        if (ws.readyState !== WebSocket.OPEN || (ws.lastActivity && ws.lastActivity < cutoffTime)) {
          ws.close();
          cleanedCount++;
          return false;
        }
        return true;
      });

      if (activeConnections.length === 0) {
        this.clients.delete(userId);
      } else {
        this.clients.set(userId, activeConnections);
      }
    }

    // Update company clients map
    for (const [companyId, connections] of this.companyClients.entries()) {
      const activeConnections = connections.filter(ws => ws.readyState === WebSocket.OPEN);
      if (activeConnections.length === 0) {
        this.companyClients.delete(companyId);
      } else {
        this.companyClients.set(companyId, activeConnections);
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up inactive WebSocket connections', 'WebSocket Server', {
        cleanedConnections: cleanedCount,
        activeUsers: this.clients.size,
        activeCompanies: this.companyClients.size
      });
    }
  }

  // Public methods for sending real-time updates

  // Send notification to specific user
  sendNotificationToUser(userId: number, notification: any): void {
    const userClients = this.clients.get(userId) || [];
    const message: WebSocketMessage = {
      type: 'notification',
      data: notification,
      userId,
      timestamp: new Date().toISOString()
    };

    userClients.forEach(ws => this.sendMessage(ws, message));

    if (userClients.length > 0) {
      logger.userActivity(userId, 'Real-time notification sent', 'WebSocket Server', {
        notificationType: notification.type,
        connections: userClients.length
      });
    }
  }

  // Send work order update to company members
  sendWorkOrderUpdateToCompany(companyId: number, workOrderUpdate: any): void {
    const companyClients = this.companyClients.get(companyId) || [];
    const message: WebSocketMessage = {
      type: 'work_order_update',
      data: workOrderUpdate,
      timestamp: new Date().toISOString()
    };

    companyClients.forEach(ws => this.sendMessage(ws, message));

    if (companyClients.length > 0) {
      logger.info('Work order update sent to company', 'WebSocket Server', {
        companyId,
        workOrderId: workOrderUpdate.id,
        connections: companyClients.length
      });
    }
  }

  // Send system alert to all connected users
  sendSystemAlert(alert: any): void {
    const message: WebSocketMessage = {
      type: 'system_alert',
      data: alert,
      timestamp: new Date().toISOString()
    };

    let totalSent = 0;
    for (const connections of this.clients.values()) {
      connections.forEach(ws => {
        this.sendMessage(ws, message);
        totalSent++;
      });
    }

    logger.info('System alert sent', 'WebSocket Server', {
      alertType: alert.type,
      connectionsSent: totalSent
    });
  }

  // Get connection statistics
  getStats(): {
    totalConnections: number;
    connectedUsers: number;
    connectedCompanies: number;
    userConnections: { [userId: number]: number };
  } {
    const userConnections: { [userId: number]: number } = {};
    for (const [userId, connections] of this.clients.entries()) {
      userConnections[userId] = connections.length;
    }

    return {
      totalConnections: Array.from(this.clients.values()).reduce((total, connections) => total + connections.length, 0),
      connectedUsers: this.clients.size,
      connectedCompanies: this.companyClients.size,
      userConnections
    };
  }
}

export const websocketManager = new WebSocketManager();