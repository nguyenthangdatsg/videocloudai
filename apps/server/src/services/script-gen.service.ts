import { getSettings } from './settings.service';
import { llmComplete } from './llm.service';

const DEFAULT_SYSTEM_PROMPT = `You are a scriptwriter for short-form cinematic social media videos.
Write a narration script for a {duration}-second video about: {topic}

Rules:
- Write in short, powerful sentences (each sentence will become one scene)
- Use vivid, visual language that can be shown cinematically
- Each sentence should be 10-20 words maximum
- Aim for {scenes} sentences total based on the duration
- Style: cinematic, emotional, storytelling
- No brackets, no stage directions, no scene numbers, no formatting
- Output ONLY the script text, nothing else — no intro, no explanation`;

const DEFAULT_SYSTEM_PROMPT_VI = `Bạn là người viết kịch bản cho các video mạng xã hội dạng ngắn phong cách điện ảnh.
Viết kịch bản thuyết minh cho video {duration} giây về chủ đề: {topic}

Quy tắc:
- Viết bằng các câu ngắn gọn, mạnh mẽ (mỗi câu sẽ trở thành một cảnh)
- Dùng ngôn ngữ hình ảnh, sống động, có thể thể hiện bằng hình ảnh điện ảnh
- Mỗi câu tối đa 15-25 từ
- Nhắm tới {scenes} câu dựa trên thời lượng
- Phong cách: điện ảnh, cảm xúc, kể chuyện
- Không có dấu ngoặc, không có hướng dẫn sân khấu, không số cảnh, không định dạng
- Chỉ xuất văn bản kịch bản, không có gì khác — không mở đầu, không giải thích`;

export function getDefaultSystemPrompt(lang?: string): string {
  return lang === 'vi' ? DEFAULT_SYSTEM_PROMPT_VI : DEFAULT_SYSTEM_PROMPT;
}

export async function generateScript(
  topic: string,
  duration: number,
  systemPromptOverride?: string
): Promise<string> {
  const s = getSettings();
  const targetScenes = Math.max(3, Math.round(duration / 5));
  const systemPrompt = (systemPromptOverride || s.get('groq_system_prompt') || DEFAULT_SYSTEM_PROMPT)
    .replace('{duration}', String(duration))
    .replace('{topic}', topic)
    .replace('{scenes}', String(targetScenes));

  return llmComplete({
    systemPrompt,
    userMessage: `Topic: ${topic}\nDuration: ${duration} seconds`,
    temperature: 0.8,
    maxTokens: 800,
  });
}

export async function generateHooks(script: string, count: number = 5): Promise<string[]> {
  const systemPrompt = `You are a viral short-form video hook writer. Given a video script, generate ${count} alternative opening hooks (first 1-2 sentences only) that grab attention. Return a JSON array of strings: ["hook1", "hook2", ...]. No preamble.`;

  const raw = await llmComplete({
    systemPrompt,
    userMessage: script,
    temperature: 0.9,
    maxTokens: 600,
  });

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse hooks from LLM response');
  const hooks = JSON.parse(match[0]) as string[];
  if (!Array.isArray(hooks)) throw new Error('Expected array of hooks');
  return hooks;
}

// Rewrite a social-media description into the user's voice.
// Picks groq_description_prompt_vi when whisper_language is 'vi', otherwise groq_description_prompt.
export async function rewriteDescription(originalDescription: string, sourceUrl?: string): Promise<string> {
  const s = getSettings();
  const lang = s.get('whisper_language') ?? 'en';
  const systemPrompt = lang === 'vi'
    ? (s.get('groq_description_prompt_vi') || s.get('groq_description_prompt'))
    : s.get('groq_description_prompt');
  if (!systemPrompt) throw new Error('Description prompt not configured');

  const userContent = sourceUrl
    ? `SOURCE URL: ${sourceUrl}\n\nORIGINAL DESCRIPTION:\n${originalDescription}`
    : `ORIGINAL DESCRIPTION:\n${originalDescription}`;

  return llmComplete({
    systemPrompt,
    userMessage: userContent,
    temperature: 0.7,
    maxTokens: 400,
  });
}
