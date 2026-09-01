const { createClient } = require('@supabase/supabase-js');

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

    // Secure Authentication Check — fail-fast if admin env vars are missing.
    // No defaults: a misconfigured deploy must NOT silently fall back to a known password.
    const adminUser = process.env.ADMIN_USERNAME;
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminUser || !adminPass) {
        console.error('Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in env.');
        return res.status(500).json({ error: 'Admin credentials are not configured on the server.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    if (username !== adminUser || password !== adminPass) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!supabase) {
        return res.status(500).json({ error: 'Supabase is not configured on the server.' });
    }

    try {
        const { data, error } = await supabase
            .from('usage_logs')
            .select('*')
            .order('last_active', { ascending: false })
            .limit(100);

        if (error) throw error;

        res.status(200).json({ stats: data });
    } catch (err) {
        console.error('Stats API Error:', err);
        res.status(500).json({ error: err.message });
    }
};
