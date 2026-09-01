/**
 * Configuration File for OpenRouter
 * WARNING: Do not commit your API Key to public repositories.
 */
const CONFIG = {
    // ตั้งค่า Model เริ่มต้น (ตามที่ผู้ใช้ร้องขอ)
    DEFAULT_MODEL: 'minimax/minimax-m3:free',

    // รายการโมเดลที่สามารถเลือกใช้ได้
    AVAILABLE_MODELS: [
        { id: 'minimax/minimax-m3:free',                    label: 'MiniMax M3',         tag: 'On' },
        { id: 'google/gemini-2.5-flash:free',               label: 'Gemini 2.5 Flash',   tag: 'On' },
        { id: 'meta-llama/llama-3.1-8b-instruct:free',      label: 'Llama 3.1 (8B)',     tag: 'On' },
        { id: 'mistralai/mistral-7b-instruct:free',         label: 'Mistral 7B',         tag: 'On' },
        { id: 'qwen/qwen-2-72b-instruct:free',              label: 'Qwen 2 (72B)',       tag: 'On' },
        { id: 'microsoft/phi-3-mini-128k-instruct:free',    label: 'Phi-3 Mini',         tag: 'On' }
    ],

    // ตั้งค่า URL ของ OpenRouter API
    API_URL: 'https://openrouter.ai/api/v1/chat/completions'
};
