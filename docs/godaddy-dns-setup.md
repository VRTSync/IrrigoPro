# GoDaddy DNS Setup for IrrigoPro.com

## Steps to Connect Your Domain

### 1. Deploy Your App First
- Make sure your Replit app is deployed 
- Go to Deployments tab → Settings
- Click "Link a domain"
- Enter: `irrigopro.com`

### 2. Get DNS Records from Replit
Replit will provide you with records like:
```
A Record: @ → [IP Address from Replit]
TXT Record: @ → [Verification code from Replit]
```

### 3. Update GoDaddy DNS Settings
1. Log into your GoDaddy account
2. Go to "My Products" → "DNS"
3. Find irrigopro.com and click "Manage"
4. Add/Update these records:

**A Record:**
- Host: @
- Points to: [IP from Replit]
- TTL: 1 hour

**TXT Record:**
- Host: @
- Value: [Verification code from Replit]
- TTL: 1 hour

### 4. Wait for Propagation
- DNS changes can take 1-48 hours
- Test with: `nslookup irrigopro.com`

## QuickBooks Integration
Once DNS is active, use this redirect URI:
```
https://irrigopro.com/api/quickbooks/callback
```

## Benefits
✓ Professional domain for customer-facing links
✓ Stable URL for QuickBooks OAuth
✓ Better brand recognition
✓ Automatic SSL certificate from Replit