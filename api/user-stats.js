const { createClient } = require('@supabase/supabase-js');

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const userName = req.query.user;
    if (!userName) return res.status(400).json({ error: 'User is required' });

    if (!supabase) {
        return res.status(503).json({ error: 'Database not configured' });
    }

    try {
        const { data, error } = await supabase
            .from('usage_logs')
            .select('requests_count, tokens_used')
            .eq('username', userName)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No rows found
                return res.status(200).json({ requests_count: 0, tokens_used: 0 });
            }
            throw error;
        }

        return res.status(200).json({
            requests_count: data.requests_count || 0,
            tokens_used: data.tokens_used || 0
        });
    } catch (error) {
        console.error('Error fetching user stats:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
