// Run this in browser console to test QuickBooks functionality
console.log("🔵 Starting QuickBooks debug test...");

// Test 1: Check if fetch works
fetch('/api/quickbooks/auth')
  .then(response => {
    console.log("🟢 Fetch response status:", response.status);
    return response.json();
  })
  .then(data => {
    console.log("🟢 Fetch data:", data);
  })
  .catch(error => {
    console.error("🔴 Fetch error:", error);
  });

// Test 2: Test React Query functionality
if (window.React) {
  console.log("🟢 React is available");
} else {
  console.log("🔴 React is not available");
}

// Test 3: Check if toast is working
console.log("🔵 QuickBooks debug test completed");