import * as jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { storage } from './storage';

// JWT token configuration
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        name: string;
        email: string;
        role: string;
        companyId: number;
        emailVerified: boolean;
        mfaEnabled: boolean;
      };
    }
  }
}

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  companyId: number;
  iat?: number;
  exp?: number;
}

// Generate JWT token for authenticated user
export function generateToken(user: any): string {
  const payload: JwtPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    companyId: user.companyId
  };

  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: JWT_EXPIRY,
    issuer: 'irrigopro',
    audience: 'irrigopro-users'
  } as jwt.SignOptions);
}

// Verify and decode JWT token
export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'irrigopro',
      audience: 'irrigopro-users'
    }) as JwtPayload;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

// Authentication middleware for production
export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from Authorization header or cookie
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : req.cookies?.auth_token;

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    // Verify and decode token
    const decoded = verifyToken(token);
    
    // Get full user data from database
    const user = await storage.getUser(decoded.userId);
    
    if (!user || !user.isActive || user.isDeleted) {
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    // Check email verification for sensitive operations
    if (!user.emailVerified) {
      return res.status(403).json({ message: 'Email verification required' });
    }

    // Attach user to request
    req.user = {
      id: user.id || 0,
      username: user.username || '',
      name: user.name || '',
      email: user.email || '',
      role: user.role || '',
      companyId: user.companyId || 0,
      emailVerified: user.emailVerified || false,
      mfaEnabled: user.mfaEnabled || false
    };

    next();
  } catch (error: any) {
    console.error('Authentication error:', error.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Role-based authorization middleware
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Access denied. Required roles: ${allowedRoles.join(', ')}` 
      });
    }

    next();
  };
};

// Company access authorization
export const requireCompanyAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const requestedCompanyId = parseInt(req.params.companyId || req.body.companyId || '0');
  
  // Super admins can access any company
  if (req.user.role === 'super_admin') {
    return next();
  }

  // Other users can only access their own company
  if (req.user.companyId !== requestedCompanyId && requestedCompanyId !== 0) {
    return res.status(403).json({ 
      message: 'Access denied. Can only access your own company data.' 
    });
  }

  next();
};

// Admin access authorization
export const requireAdminAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const allowedRoles = ['super_admin', 'company_admin'];
  
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ 
      message: 'Access denied. Admin privileges required.' 
    });
  }

  next();
};

// Company admin access authorization
export const requireCompanyAdminAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  // Check if user is company admin for the requested company
  const requestedCompanyId = parseInt(req.params.companyId || req.body.companyId || '0');
  
  if (req.user.role === 'super_admin') {
    return next(); // Super admins can access any company
  }

  if (req.user.role !== 'company_admin' || req.user.companyId !== requestedCompanyId) {
    return res.status(403).json({ 
      message: 'Access denied. Company admin privileges required.' 
    });
  }

  next();
};

// Work order and billing access authorization
export const requireWorkOrderBillingAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const allowedRoles = ['super_admin', 'company_admin', 'billing_manager'];
  
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ 
      message: 'Access denied. Work order/billing management privileges required.' 
    });
  }

  next();
};

// Development session fallback middleware (for backward compatibility)
export const developmentAuthFallback = async (req: Request, res: Response, next: NextFunction) => {
  // Only use in development environment
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  // If already authenticated via JWT, skip fallback
  if (req.user) {
    return next();
  }

  try {
    // Fallback to header-based auth for development
    const userRole = req.headers['x-user-role'] as string;
    const userCompanyId = req.headers['x-user-company-id'] as string;
    
    if (userRole && userCompanyId) {
      // Get user from session/storage for development
      const users = await storage.getUsers();
      const sessionUser = users.find(u => 
        u.role === userRole && u.companyId === parseInt(userCompanyId)
      );

      if (sessionUser) {
        req.user = {
          id: sessionUser.id,
          username: sessionUser.username,
          name: sessionUser.name,
          email: sessionUser.email,
          role: sessionUser.role,
          companyId: sessionUser.companyId,
          emailVerified: sessionUser.emailVerified,
          mfaEnabled: sessionUser.mfaEnabled
        };
      }
    }
  } catch (error) {
    console.error('Development auth fallback error:', error);
  }

  next();
};