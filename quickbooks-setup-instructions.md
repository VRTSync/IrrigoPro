# QuickBooks Integration Setup Instructions

## Current Issue
QuickBooks is refusing to connect because the redirect URI in your QuickBooks Developer Console doesn't match your current Replit domain.

## Your Current Replit Information
- **Domain**: `ae7894b1-12cd-48fe-acc6-f6506c6cf73b-00-3b44ujv51cwut.janeway.replit.dev`
- **Required Redirect URI**: `https://ae7894b1-12cd-48fe-acc6-f6506c6cf73b-00-3b44ujv51cwut.janeway.replit.dev/api/quickbooks/callback`

## Step-by-Step Fix

### 1. Access QuickBooks Developer Console
- Go to: https://developer.intuit.com/app/developer/myapps
- Log in with your QuickBooks developer account

### 2. Find Your IrrigoPro App
- Look for your existing QuickBooks app for IrrigoPro
- Click on the app to open its settings

### 3. Update Redirect URIs
- Navigate to the "Keys & OAuth" section
- Find the "Redirect URIs" field
- Add this exact URL: `https://ae7894b1-12cd-48fe-acc6-f6506c6cf73b-00-3b44ujv51cwut.janeway.replit.dev/api/quickbooks/callback`
- **Important**: Make sure to use `https://` not `http://`

### 4. Save Changes
- Click "Save" or "Update" in the QuickBooks console
- Wait a few minutes for changes to propagate

### 5. Test Connection
- Return to IrrigoPro billing page
- Try the "Connect to QuickBooks" button again

## Important Notes

1. **Domain Changes**: Your Replit domain changes each time the environment restarts. You'll need to update the redirect URI in QuickBooks whenever this happens.

2. **HTTPS Required**: QuickBooks requires HTTPS for redirect URIs in production.

3. **Multiple URIs**: You can add multiple redirect URIs to your QuickBooks app if needed for testing.

## Alternative Solution (If You Don't Have Developer Access)

If you don't have access to the QuickBooks Developer Console:

1. Contact the person who originally set up the QuickBooks app
2. Provide them with the redirect URI above
3. Ask them to add it to the app's configuration

## Verification

After updating the QuickBooks console:
1. The connection should work immediately
2. You should be redirected to QuickBooks for authorization
3. After approving, you'll be redirected back to IrrigoPro with a success message