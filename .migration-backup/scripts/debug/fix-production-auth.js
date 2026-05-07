// Fix production authentication for Randy
const bcrypt = require('bcrypt');

async function fixRandyPassword() {
  const password = 'password123';
  const hash = await bcrypt.hash(password, 10);
  console.log('Password hash for Randy:', hash);
  console.log('SQL to run:');
  console.log(`UPDATE users SET password = '${hash}', email_verified = true WHERE username = 'randymangel';`);
}

fixRandyPassword();