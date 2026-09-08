const { createClient } = require('@supabase/supabase-js');

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { model, messages, stream, userName, provider } = req.body;
    
    // Extract IP address again
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    
    // We now use userName for tracking instead of IP
    const trackingUser = userName || 'Anonymous';

    try {
        let apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        let apiKey = process.env.OPENROUTER_API_KEY;
        let extraHeaders = {
            'HTTP-Referer': 'https://isamare-ai.vercel.app',
            'X-Title': 'IsAmAre AI Chat',
        };
        let bodyPayload = { model, messages, stream, include_usage: true };

        if (provider === 'okmd') {
            apiUrl = 'https://gen.ai.kku.ac.th/okmd/api/v1/chat/completions';
            apiKey = process.env.PLAYGROUND_API_KEY;
            extraHeaders = {};
            bodyPayload = { model, messages, stream }; // Don't send OpenRouter specific flags
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                ...extraHeaders
            },
            body: JSON.stringify(bodyPayload)
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: errText });
        }

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Native fetch stream handling in Node
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let totalTokens = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    res.end();
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                res.write(chunk);

                // Attempt to parse token usage from stream
                if (chunk.includes('"usage":')) {
                    const match = chunk.match(/"total_tokens"\s*:\s*(\d+)/);
                    if (match && match[1]) {
                        totalTokens = parseInt(match[1], 10);
                    }
                }
            }

            // Save usage to DB asynchronously after stream finishes
            saveUsage(trackingUser, clientIp, totalTokens || 0);

        } else {
            const data = await response.json();
            const totalTokens = data.usage?.total_tokens || 0;
            saveUsage(trackingUser, clientIp, totalTokens);
            res.status(200).json(data);
        }

    } catch (err) {
        console.error('Chat API Error:', err);
        res.status(500).json({ error: err.message });
    }
};

async function saveUsage(username, ip, tokens) {
    if (!supabase || !username) return;
    try {
        // Fetch existing record
        const { data, error } = await supabase
            .from('usage_logs')
            .select('id, tokens_used, requests_count')
            .eq('username', username)
            .single();

        if (data) {
            await supabase.from('usage_logs').update({
                ip_address: ip, // Update to their latest IP
                tokens_used: data.tokens_used + tokens,
                requests_count: data.requests_count + 1,
                last_active: new Date().toISOString()
            }).eq('id', data.id);
        } else {
            await supabase.from('usage_logs').insert([{
                username: username,
                ip_address: ip,
                tokens_used: tokens,
                requests_count: 1,
                last_active: new Date().toISOString()
            }]);
        }
    } catch (e) {
        console.error('Supabase Save Error:', e);
    }
}
