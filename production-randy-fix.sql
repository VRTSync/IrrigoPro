-- Fix Randy's authentication in production database
-- Using fresh bcrypt hash for password123

UPDATE users 
SET password = '$2b$10$nqmlnOIytOVxt/1eJiS9pOY1O76cBCeNA4REpbDabZQVQLMNHRsx.',
    email_verified = true,
    updated_at = NOW()
WHERE username = 'randymangel';

-- Also update username to match expected format
UPDATE users 
SET username = 'randy@highplainsprop.com',
    email = 'randy@highplainsprop.com'
WHERE username = 'randymangel';

-- Verify the update
SELECT id, username, name, email, role, email_verified 
FROM users 
WHERE email = 'randy@highplainsprop.com' OR username LIKE '%randy%';