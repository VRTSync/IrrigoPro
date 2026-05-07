-- Create fresh Randy login for production
-- Delete any existing Randy users first
DELETE FROM users WHERE username LIKE '%randy%' OR email LIKE '%randy%';

-- Insert fresh Randy user with known working credentials
INSERT INTO users (
    username, password, name, email, role, 
    company_id, is_active, email_verified,
    created_at, updated_at
) VALUES (
    'randy@highplainsprop.com',
    '$2b$10$nqmlnOIytOVxt/1eJiS9pOY1O76cBCeNA4REpbDabZQVQLMNHRsx.',
    'Randy Mangel',
    'randy@highplainsprop.com', 
    'company_admin',
    NULL,
    true,
    true,
    NOW(),
    NOW()
);

-- Verify the new user
SELECT username, name, role, email_verified FROM users WHERE username = 'randy@highplainsprop.com';