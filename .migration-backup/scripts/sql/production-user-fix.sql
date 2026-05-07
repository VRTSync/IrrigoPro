-- Production User Fix Script
-- This script ensures Randy and superadmin exist with correct passwords

-- Insert or update superadmin user
INSERT INTO users (
    id, username, password, name, email, role, 
    company_id, is_active, email_verified, 
    email_verification_token, email_verification_expires,
    password_reset_token, password_reset_expires,
    created_at, updated_at
) VALUES (
    12, 'superadmin', '$2b$10$gItsHGzhRtNWA8mGIAUoQOIwbMI49HFdsSfE9095QUSlVcYgXh9xu',
    'Super Administrator', 'superadmin@irrigopro.com', 'super_admin',
    NULL, true, true,
    NULL, NULL,
    NULL, NULL,
    NOW(), NOW()
) ON CONFLICT (username) DO UPDATE SET
    password = '$2b$10$gItsHGzhRtNWA8mGIAUoQOIwbMI49HFdsSfE9095QUSlVcYgXh9xu',
    updated_at = NOW();

-- Insert or update Randy user  
INSERT INTO users (
    id, username, password, name, email, role,
    company_id, is_active, email_verified,
    email_verification_token, email_verification_expires, 
    password_reset_token, password_reset_expires,
    created_at, updated_at
) VALUES (
    13, 'randy@highplainsprop.com', '$2b$10$P/oY4rl1JOeicvhdfBKrmePuF92WotyU24pF2PwO6pzHD0Ag7Leyy',
    'Randy Mangel', 'randy@highplainsprop.com', 'company_admin',
    NULL, true, true,
    NULL, NULL,
    NULL, NULL, 
    NOW(), NOW()
) ON CONFLICT (username) DO UPDATE SET
    password = '$2b$10$P/oY4rl1JOeicvhdfBKrmePuF92WotyU24pF2PwO6pzHD0Ag7Leyy',
    updated_at = NOW();

-- Verify the users exist
SELECT id, username, name, role, is_active, email_verified 
FROM users 
WHERE username IN ('superadmin', 'randy@highplainsprop.com')
ORDER BY id;