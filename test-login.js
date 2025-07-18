// Simple test script to verify login functionality
async function testLogin() {
  console.log('Testing login functionality...');
  
  try {
    // Test admin login
    const response = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123'
      })
    });
    
    if (response.ok) {
      const user = await response.json();
      console.log('✓ Admin login successful:', user);
      
      // Test manager login
      const managerResponse = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'manager',
          password: 'manager123'
        })
      });
      
      if (managerResponse.ok) {
        const manager = await managerResponse.json();
        console.log('✓ Manager login successful:', manager);
        
        // Test tech login
        const techResponse = await fetch('http://localhost:5000/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: 'tech',
            password: 'tech123'
          })
        });
        
        if (techResponse.ok) {
          const tech = await techResponse.json();
          console.log('✓ Tech login successful:', tech);
          console.log('All login tests passed!');
        } else {
          console.error('✗ Tech login failed');
        }
      } else {
        console.error('✗ Manager login failed');
      }
    } else {
      console.error('✗ Admin login failed');
    }
  } catch (error) {
    console.error('Login test error:', error);
  }
}

testLogin();