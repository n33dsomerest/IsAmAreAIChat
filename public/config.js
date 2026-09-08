/**
 * Configuration File for OpenRouter & OKMD
 * WARNING: Do not commit your API Key to public repositories.
 */
const CONFIG = {
    // ตั้งค่า Model เริ่มต้น (ตามที่ผู้ใช้ร้องขอ)
    DEFAULT_MODEL: 'openrouter/free',

    // รายการโมเดลที่สามารถเลือกใช้ได้
    AVAILABLE_MODELS: [
        { id: 'openrouter/free', label: 'Auto Router', tag: 'On', provider: 'openrouter', icon: 'lobehub' },
        { id: 'nvidia/nemotron-3.5-lightning:free', label: 'NVIDIA Nemotron 3.5 lightning', tag: 'On', provider: 'openrouter', icon: 'nvidia' },

        // OKMD Models
        { id: 'claude-sonnet-5', label: 'Claude 5 Sonnet', tag: 'OKMD', provider: 'okmd', icon: 'claude' },
        { id: 'claude-sonnet-4.6', label: 'Claude 4.6 Sonnet', tag: 'OKMD', provider: 'okmd', icon: 'claude' },
        { id: 'deepseek-v4-pro', label: 'Deepseek v4 Pro', tag: 'OKMD', provider: 'okmd', icon: 'deepseek' },
        { id: 'deepseek-v4-flash', label: 'Deepseek v4 Flash', tag: 'OKMD', provider: 'okmd', icon: 'deepseek' },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', tag: 'OKMD', provider: 'okmd', icon: 'gemini' },
        { id: 'llama-4-maverick', label: 'Meta Llama 4 Maverick', tag: 'OKMD', provider: 'okmd', icon: 'meta' },
        { id: 'llama-4-scout', label: 'Meta Llama 4 Scout', tag: 'OKMD', provider: 'okmd', icon: 'meta' },
        { id: 'mistral-medium-3.1', label: 'Mistral Medium 3.1', tag: 'OKMD', provider: 'okmd', icon: 'mistral' },
        { id: 'nova-2-lite-v1', label: 'Nova 2 Lite v1', tag: 'OKMD', provider: 'okmd', icon: 'aws' },
        { id: 'nova-pro-v1', label: 'Nova Pro v1', tag: 'OKMD', provider: 'okmd', icon: 'aws' },
        { id: 'gpt-5.6-terra', label: 'OpenAI GPT-5.6 Terra', tag: 'OKMD', provider: 'okmd', icon: 'openai' },
        { id: 'gpt-5.6-luna', label: 'OpenAI GPT-5.6 Luna', tag: 'OKMD', provider: 'okmd', icon: 'openai' },
        { id: 'gpt-5.4', label: 'OpenAI GPT-5.4', tag: 'OKMD', provider: 'okmd', icon: 'openai' },
        { id: 'gpt-5.4-mini', label: 'OpenAI GPT-5.4 Mini', tag: 'OKMD', provider: 'okmd', icon: 'openai' },
        { id: 'gpt-5.4-nano', label: 'OpenAI GPT-5.4 Nano', tag: 'OKMD', provider: 'okmd', icon: 'openai' },
        { id: 'qwen3.7-plus', label: 'Qwen 3.7 Plus', tag: 'OKMD', provider: 'okmd', icon: 'qwen' },
        { id: 'qwen3.7-max', label: 'Qwen 3.7 Max', tag: 'OKMD', provider: 'okmd', icon: 'qwen' },
        { id: 'qwen3.6-flash', label: 'Qwen 3.6 Flash', tag: 'OKMD', provider: 'okmd', icon: 'qwen' },
        { id: 'grok-4.3', label: 'xAI Grok 4.3', tag: 'OKMD', provider: 'okmd', icon: 'grok' }
    ],

    // ตั้งค่า URL ของ OpenRouter API (ใช้เป็นค่าปริยายหรือสำหรับการอ้างอิง)
    API_URL: 'https://openrouter.ai/api/v1/chat/completions'
};
