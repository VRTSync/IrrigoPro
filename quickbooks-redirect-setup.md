# QuickBooks App Redirect URI Setup

## Current Issue
Intuit is refusing the connection because the redirect URI in your QuickBooks app doesn't match the current Replit domain.

## Current Replit Domain
```
https://ae7894b1-12cd-48fe-acc6-f6506c6cf73b-00-3b44ujv51cwut.janeway.replit.dev
```

## Required Redirect URI
```
https://ae7894b1-12cd-48fe-acc6-f6506c6cf73b-00-3b44ujv51cwut.janeway.replit.dev/api/quickbooks/callback
```

## Steps to Fix

1. **Go to QuickBooks Developer Dashboard**
   - Visit: https://developer.intuit.com/
   - Sign in with your Intuit account
   - Navigate to "My Apps"

2. **Edit Your App Settings**
   - Find your IrrigoPro app (Client ID: ABYzg2dYpmUlNblvzAAgHjWIcgfxHeGyHJxdrrCkKRYIkGgKPS)
   - Click "Settings" or "Keys & OAuth"

3. **Update Redirect URIs**
   - Add or update the redirect URI to:
   ```
   https://ae7894b1-12cd-48fe-acc6-f6506c6cf73b-00-3b44ujv51cwut.janeway.replit.dev/api/quickbooks/callback
   ```

4. **Save Changes**
   - Click "Save" in the QuickBooks developer console
   - Changes may take a few minutes to propagate

## Alternative: Use ngrok for Testing
If you prefer not to update the redirect URI frequently, you can use ngrok:
```bash
ngrok http 5000
```
Then update the redirect URI to the ngrok URL.

## Test After Update
Once updated, try the "Connect to QuickBooks" button again.