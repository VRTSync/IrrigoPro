// Test fetch without any options to eliminate HTTP token error
console.log("Testing simple fetch...");

fetch("/api/quickbooks/auth")
  .then(response => {
    console.log("Success! Status:", response.status);
    return response.json();
  })
  .then(data => {
    console.log("Data:", data);
  })
  .catch(error => {
    console.error("Error:", error);
  });