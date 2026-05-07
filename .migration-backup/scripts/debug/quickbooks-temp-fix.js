// Temporary QuickBooks Connection Test
// This script helps test QuickBooks integration by using a generic redirect URI

console.log("=== QuickBooks Connection Debug ===");
console.log("Current Domain:", window.location.host);
console.log("Current URL:", window.location.href);

// Test 1: Check if we can reach the auth endpoint
async function testAuthEndpoint() {
    console.log("\n1. Testing auth endpoint...");
    try {
        const response = await fetch('/api/quickbooks/auth');
        const data = await response.json();
        console.log("✅ Auth endpoint working");
        console.log("Generated URL:", data.authUrl);
        return data.authUrl;
    } catch (error) {
        console.log("❌ Auth endpoint failed:", error);
        return null;
    }
}

// Test 2: Extract components from auth URL
function analyzeAuthUrl(authUrl) {
    console.log("\n2. Analyzing auth URL components...");
    const url = new URL(authUrl);
    const params = new URLSearchParams(url.search);
    
    console.log("Client ID:", params.get('client_id'));
    console.log("Redirect URI:", decodeURIComponent(params.get('redirect_uri')));
    console.log("Scope:", params.get('scope'));
    console.log("State:", params.get('state'));
}

// Test 3: Try connection with different redirect URI
function testWithGenericRedirect() {
    console.log("\n3. Testing with localhost redirect (for development)...");
    const clientId = "ABYzg2dYpmUlNblvzAAgHjWIcgfxHeGyHJxdrrCkKRYIkGgKPS";
    const localhostRedirect = "http://localhost:3000/callback";  // Common development URI
    
    const testUrl = `https://appcenter.intuit.com/connect/oauth2?` +
        `client_id=${clientId}&` +
        `scope=com.intuit.quickbooks.accounting&` +
        `redirect_uri=${encodeURIComponent(localhostRedirect)}&` +
        `response_type=code&` +
        `access_type=offline&` +
        `state=test123`;
    
    console.log("Test URL with localhost:", testUrl);
    return testUrl;
}

// Main diagnostic function
async function runDiagnostics() {
    const authUrl = await testAuthEndpoint();
    if (authUrl) {
        analyzeAuthUrl(authUrl);
        const testUrl = testWithGenericRedirect();
        
        console.log("\n=== DIAGNOSIS ===");
        console.log("PROBLEM: The redirect URI in your QuickBooks app doesn't include:");
        console.log(`  ${window.location.protocol}//${window.location.host}/api/quickbooks/callback`);
        
        console.log("\nSOLUTION OPTIONS:");
        console.log("1. Add the redirect URI above to your QuickBooks app");
        console.log("2. Or test with a development URI that's already configured");
        
        console.log("\nTo test option 2, run:");
        console.log(`window.location.href = "${testUrl}"`);
    }
}

// Run diagnostics automatically
runDiagnostics();