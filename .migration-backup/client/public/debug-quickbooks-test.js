// Simple test to verify QuickBooks API endpoint works
console.log("Testing QuickBooks API endpoint directly...");

fetch('/api/quickbooks/auth')
  .then(response => {
    console.log('Response status:', response.status);
    return response.json();
  })
  .then(data => {
    console.log('Success! Auth URL:', data.authUrl);
    console.log('Redirecting now...');
    window.location.href = data.authUrl;
  })
  .catch(error => {
    console.error('Error:', error);
  });