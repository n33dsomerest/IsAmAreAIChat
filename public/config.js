/**
 * Configuration File for OpenRouter
 * WARNING: Do not commit your API Key to public repositories.
 */
const CONFIG = {
    // ตั้งค่า Model เริ่มต้น (ตามที่ผู้ใช้ร้องขอ)
    DEFAULT_MODEL: 'minimax/minimax-m3:free',

    // รายการโมเดลที่สามารถเลือกใช้ได้
    AVAILABLE_MODELS: [
        { id: 'minimax/minimax-m3:free', label: 'MiniMax M3', tag: 'On' },
        { id: 'openrouter/free', label: 'Auto Model', tag: 'On' },
        { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'NVIDIA Nemotron 3 Super', tag: 'On' }
    ],

    // ตั้งค่า URL ของ OpenRouter API
    API_URL: 'https://openrouter.ai/api/v1/chat/completions'
};
