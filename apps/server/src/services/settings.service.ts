import { dbGet, dbAll, dbRun, dbTransaction } from '../db';

export const SETTING_DEFAULTS: Record<string, string> = {
  default_voice: 'en-US-GuyNeural',
  default_tts_rate: '0',
  default_tts_pitch: '0',
  default_tts_volume: '0',
  default_tts_style: '',
  whisper_model: 'tiny',
  whisper_language: 'en',
  ffmpeg_path: 'ffmpeg',
  ffprobe_path: 'ffprobe',
  subtitle_font_path: '',
  subtitle_font_size: '52',
  jamendo_client_id: '',
  music_volume: '0.20',
  max_concurrent_jobs: '3',
  llm_provider: 'gemini',
  gemini_model: 'gemini-2.5-flash',
  groq_api_key: '',
  groq_model: 'llama-3.3-70b-versatile',
  anthropic_api_key: '',
  anthropic_model: 'claude-sonnet-4-6',
  huggingface_api_key: '',
  openrouter_api_key: '',
  openrouter_model: 'meta-llama/llama-3.3-70b-instruct:free',
  cerebras_api_key: '',
  cerebras_model: 'llama-3.3-70b',
  grok_api_key: '',
  grok_model: 'grok-3-mini',
  openai_api_key: '',
  openai_model: 'gpt-4o-mini',
  gemini_api_key: '',
  google_imagen_model: 'gemini-2.5-flash-image',
  pollinations_model: 'flux',
  image_provider: 'auto',
  groq_system_prompt: '',
  groq_description_prompt: 'You are a social media caption writer. Given the ORIGINAL DESCRIPTION of a video imported from social media, rewrite it as a fresh caption in a natural, engaging first-person tone for personal reposting. Keep it concise (1-3 sentences), preserve the core message, and you may keep relevant hashtags but make them feel authentic. Output ONLY the rewritten caption — no preamble, no quotes, no labels.',
  groq_description_prompt_vi: 'Bạn là người viết caption mạng xã hội. Dựa trên MÔ TẢ GỐC của video được nhập từ mạng xã hội, hãy viết lại thành caption mới theo giọng văn tự nhiên, gần gũi ở ngôi thứ nhất để đăng lại. Giữ nội dung ngắn gọn (1-3 câu), giữ nguyên thông điệp chính, có thể giữ lại các hashtag phù hợp nhưng hãy làm cho chúng tự nhiên. Chỉ xuất caption đã viết lại — không có phần mở đầu, không có dấu ngoặc kép, không có nhãn.',
  groq_description_credit_template: 'Created by {author}',
  intro_enabled: '0',
  intro_duration: '3',
  intro_creator_name: '',
  intro_tagline: '',
  intro_accent_color: '#7c6af5',
  intro_style: 'minimal',
  outro_enabled: '0',
  outro_duration: '3',
  outro_creator_name: '',
  outro_social_handle: '',
  outro_cta_text: 'Follow for more!',
  outro_accent_color: '#7c6af5',
  app_name: 'VideoCloudAI',
  app_logo_url: '',
  chrome_executable_path: '',
  yt_dlp_path: 'C:\\Users\\nguye\\AppData\\Roaming\\Python\\Python312\\Scripts\\yt-dlp.exe',
  youtube_client_id: '',
  youtube_client_secret: '',
  tiktok_client_key: '',
  tiktok_client_secret: '',
  instagram_app_id: '',
  instagram_app_secret: '',
};

const MASKED_KEYS = ['jamendo_client_id', 'groq_api_key', 'anthropic_api_key', 'huggingface_api_key', 'gemini_api_key', 'openrouter_api_key', 'cerebras_api_key', 'grok_api_key', 'openai_api_key'];

export class SettingsService {
  get(key: string): string {
    const row = dbGet<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? SETTING_DEFAULTS[key] ?? '';
  }

  getAll(): Record<string, string> {
    const rows = dbAll<{ key: string; value: string }>('SELECT key, value FROM settings');
    const result = { ...SETTING_DEFAULTS };
    for (const r of rows) result[r.key] = r.value;
    return result;
  }

  getAllMasked(): Record<string, string> {
    const all = this.getAll();
    for (const key of MASKED_KEYS) {
      if (all[key] && all[key].length > 8) {
        all[key] = all[key].slice(0, 4) + '••••••••' + all[key].slice(-4);
      } else if (all[key]) {
        all[key] = '••••••••';
      }
    }
    return all;
  }

  set(key: string, value: string): void {
    dbRun(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, new Date().toISOString()]
    );
  }

  setAll(incoming: Record<string, string>): void {
    dbTransaction(() => {
      for (const [key, value] of Object.entries(incoming)) {
        if (typeof value !== 'string') continue;
        // Skip masked placeholder values — means user didn't change that key
        if (MASKED_KEYS.includes(key) && value.includes('••••')) continue;
        this.set(key, value);
      }
    });
  }
}

let _instance: SettingsService | null = null;

export function getSettings(): SettingsService {
  if (!_instance) _instance = new SettingsService();
  return _instance;
}
