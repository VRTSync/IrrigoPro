// Multi-Factor Authentication (MFA) System for IrrigoPro
// Provides TOTP-based two-factor authentication for enhanced security

import crypto from 'crypto';
import { logger } from './logger';

export interface MFASecret {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface MFAVerification {
  isValid: boolean;
  usedBackupCode?: string;
}

class MFAManager {
  private readonly secretLength = 32;
  private readonly window = 1; // Allow 1 time step tolerance
  private readonly timeStep = 30; // 30 seconds

  // Generate base32 secret for TOTP
  private generateSecret(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secret = '';
    for (let i = 0; i < this.secretLength; i++) {
      secret += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return secret;
  }

  // Generate backup codes
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`);
    }
    return codes;
  }

  // Convert base32 to buffer
  private base32ToBuffer(base32: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    
    for (const char of base32.toUpperCase()) {
      const index = alphabet.indexOf(char);
      if (index === -1) continue;
      bits += index.toString(2).padStart(5, '0');
    }
    
    // Remove padding bits
    const bytes = [];
    for (let i = 0; i < bits.length - (bits.length % 8); i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    
    return Buffer.from(bytes);
  }

  // Generate HOTP value
  private generateHOTP(secret: string, counter: number): string {
    const key = this.base32ToBuffer(secret);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(counter, 4);
    
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(counterBuffer);
    const hash = hmac.digest();
    
    const offset = hash[hash.length - 1] & 0x0f;
    const truncated = hash.readUInt32BE(offset) & 0x7fffffff;
    const code = (truncated % 1000000).toString().padStart(6, '0');
    
    return code;
  }

  // Generate TOTP value
  private generateTOTP(secret: string, timestamp?: number): string {
    const time = timestamp || Math.floor(Date.now() / 1000);
    const counter = Math.floor(time / this.timeStep);
    return this.generateHOTP(secret, counter);
  }

  // Setup MFA for a user
  async setupMFA(userId: number, userEmail: string): Promise<MFASecret> {
    try {
      const secret = this.generateSecret();
      const backupCodes = this.generateBackupCodes();
      
      // Generate QR code URL for authenticator apps
      const issuer = 'IrrigoPro';
      const accountName = userEmail;
      const qrCodeUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
      
      logger.userAction(userId, 'MFA Setup Initiated', 'Multi-Factor Authentication', {
        email: userEmail,
        secretGenerated: true,
        backupCodesGenerated: backupCodes.length
      });
      
      return {
        secret,
        qrCodeUrl,
        backupCodes
      };
    } catch (error) {
      logger.error('Failed to setup MFA', error, 'Multi-Factor Authentication', { userId, userEmail });
      throw new Error('Failed to setup multi-factor authentication');
    }
  }

  // Verify TOTP code
  async verifyTOTP(secret: string, code: string, userId?: number): Promise<boolean> {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Check current time and ±window for clock drift tolerance
      for (let i = -this.window; i <= this.window; i++) {
        const timeSlot = currentTime + (i * this.timeStep);
        const expectedCode = this.generateTOTP(secret, timeSlot);
        
        if (expectedCode === code) {
          if (userId) {
            logger.userAction(userId, 'MFA Verification Successful', 'Multi-Factor Authentication', {
              timeSlot: i,
              timestamp: currentTime
            });
          }
          return true;
        }
      }
      
      if (userId) {
        logger.warn('MFA Verification Failed', 'Multi-Factor Authentication', {
          userId,
          providedCode: code.replace(/./g, '*'), // Mask the code in logs
          timestamp: currentTime
        });
      }
      
      return false;
    } catch (error) {
      logger.error('MFA verification error', error, 'Multi-Factor Authentication', { userId });
      return false;
    }
  }

  // Verify backup code
  async verifyBackupCode(backupCodes: string[], providedCode: string, userId?: number): Promise<MFAVerification> {
    try {
      const normalizedCode = providedCode.toUpperCase().replace(/\s/g, '');
      const codeIndex = backupCodes.findIndex(code => code === normalizedCode);
      
      if (codeIndex !== -1) {
        if (userId) {
          logger.userAction(userId, 'MFA Backup Code Used', 'Multi-Factor Authentication', {
            codeIndex,
            remainingCodes: backupCodes.length - 1
          });
        }
        
        return {
          isValid: true,
          usedBackupCode: backupCodes[codeIndex]
        };
      }
      
      if (userId) {
        logger.warn('Invalid MFA backup code attempted', 'Multi-Factor Authentication', {
          userId,
          timestamp: new Date().toISOString()
        });
      }
      
      return { isValid: false };
    } catch (error) {
      logger.error('Backup code verification error', error, 'Multi-Factor Authentication', { userId });
      return { isValid: false };
    }
  }

  // Verify either TOTP or backup code
  async verifyMFA(secret: string, backupCodes: string[], code: string, userId?: number): Promise<MFAVerification> {
    // First try TOTP verification
    const totpValid = await this.verifyTOTP(secret, code, userId);
    if (totpValid) {
      return { isValid: true };
    }
    
    // If TOTP fails, try backup code
    return await this.verifyBackupCode(backupCodes, code, userId);
  }

  // Generate new backup codes (when user requests new ones)
  async regenerateBackupCodes(userId: number): Promise<string[]> {
    try {
      const newCodes = this.generateBackupCodes();
      
      logger.userAction(userId, 'MFA Backup Codes Regenerated', 'Multi-Factor Authentication', {
        newCodeCount: newCodes.length,
        timestamp: new Date().toISOString()
      });
      
      return newCodes;
    } catch (error) {
      logger.error('Failed to regenerate backup codes', error, 'Multi-Factor Authentication', { userId });
      throw new Error('Failed to regenerate backup codes');
    }
  }

  // Disable MFA for a user (admin function)
  async disableMFA(userId: number, adminUserId?: number): Promise<void> {
    try {
      logger.userAction(userId, 'MFA Disabled', 'Multi-Factor Authentication', {
        disabledBy: adminUserId || 'self',
        timestamp: new Date().toISOString()
      });
      
      if (adminUserId) {
        logger.userAction(adminUserId, 'Disabled MFA for user', 'Multi-Factor Authentication', {
          targetUserId: userId,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to disable MFA', error, 'Multi-Factor Authentication', { userId, adminUserId });
      throw new Error('Failed to disable multi-factor authentication');
    }
  }

  // Security assessment for MFA
  assessMFASecurity(totalUsers: number, mfaEnabledUsers: number): {
    mfaAdoptionRate: number;
    securityScore: number;
    recommendations: string[];
  } {
    const adoptionRate = totalUsers > 0 ? (mfaEnabledUsers / totalUsers) * 100 : 0;
    let securityScore = 50; // Base score
    
    // Increase score based on adoption rate
    securityScore += Math.min(adoptionRate, 50); // Max 50 points for 100% adoption
    
    const recommendations: string[] = [];
    
    if (adoptionRate < 25) {
      recommendations.push('Critical: MFA adoption rate is very low. Consider mandatory MFA for admin users.');
    } else if (adoptionRate < 50) {
      recommendations.push('MFA adoption could be improved. Consider user education and incentives.');
    } else if (adoptionRate < 75) {
      recommendations.push('Good MFA adoption. Consider making MFA mandatory for sensitive roles.');
    } else {
      recommendations.push('Excellent MFA adoption rate. Continue current security practices.');
    }
    
    recommendations.push('Regularly audit MFA settings and backup code usage.');
    recommendations.push('Consider implementing risk-based authentication for additional security.');
    
    return {
      mfaAdoptionRate: Math.round(adoptionRate * 100) / 100,
      securityScore: Math.round(securityScore),
      recommendations
    };
  }
}

export const mfaManager = new MFAManager();