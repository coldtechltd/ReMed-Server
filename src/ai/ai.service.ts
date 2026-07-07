import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import { ProfileService } from '../profile/profile.service';

const SYSTEM_PROMPT = `You are a friendly wellness companion inside a medication reminder app.

STRICT RULES — never break these under any circumstances:
1. You CANNOT prescribe, recommend, or name any medication, supplement, or drug.
2. You CANNOT diagnose any medical condition or interpret symptoms as a diagnosis.
3. You CANNOT give medical advice or interpret lab results.
4. You CANNOT suggest changing, stopping, or adjusting prescribed medication.
5. When the user asks anything medical (symptoms, drugs, dosages, diagnoses), respond ONLY with: "I'm not a doctor and can't give medical advice. Please consult your healthcare provider or call emergency services if urgent."

You CAN:
- Gently remind the user to take their medication on time (without commenting on what the medication does).
- Suggest general wellness habits: drinking enough water, getting adequate rest, sleep hygiene, light walking, healthy eating.
- Encourage the user to call their doctor or emergency contact if they feel unwell.
- Offer brief emotional support, motivation, and positivity.
- Offer First Aid Tips Mostly Related To General Health and their Diagnosed Conditions.
Keep responses short — 2 to 4 sentences maximum. Be warm, encouraging, and non-clinical.`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiService {
  private groq: Groq;

  constructor(private readonly profileService: ProfileService) {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async getTips(userId: string): Promise<string[]> {
    let profileContext = '';
    try {
      const profile = await this.profileService.getProfile(userId);
      const parts: string[] = [];
      if (profile.diagnosedWith)
        parts.push(`Diagnosed with: ${profile.diagnosedWith}`);
      if (profile.height) parts.push(`Height: ${profile.height} cm`);
      if (profile.weight) parts.push(`Weight: ${profile.weight} kg`);
      if (profile.gender) parts.push(`Gender: ${profile.gender}`);
      if (parts.length) profileContext = `User profile — ${parts.join(', ')}.`;
    } catch {
      // profile not found — generate generic tips
    }

    const prompt = `${profileContext ? profileContext + '\n\n' : ''}Generate exactly 3 short, practical, general wellness tips for this user. Each tip should be one sentence. Do NOT mention any medications or medical treatments. Return only the 3 tips as a JSON array of strings, for example: ["Tip one.", "Tip two.", "Tip three."]`;

    const completion = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content ?? '[]';
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) : [raw];
    } catch {
      return [raw];
    }
  }

  async chat(
    userId: string,
    message: string,
    history: ChatMessage[] = [],
  ): Promise<string> {
    // Build context prefix from profile (once, as system injection)
    let profileContext = '';
    try {
      const profile = await this.profileService.getProfile(userId);
      const parts: string[] = [];
      if (profile.diagnosedWith)
        parts.push(`diagnosed with ${profile.diagnosedWith}`);
      if (profile.height) parts.push(`height ${profile.height} cm`);
      if (profile.weight) parts.push(`weight ${profile.weight} kg`);
      if (parts.length) profileContext = `The user is ${parts.join(', ')}.`;
    } catch {
      // ignore
    }

    const systemContent = profileContext
      ? `${SYSTEM_PROMPT}\n\nUser context: ${profileContext}`
      : SYSTEM_PROMPT;

    // Defence-in-depth: even though the DTO restricts roles, strip anything
    // that isn't a user/assistant turn before forwarding to the model so the
    // system guardrails can never be overridden by injected history.
    const safeHistory = history.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    );

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
      ...safeHistory.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    const completion = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.6,
      max_tokens: 200,
    });

    return (
      completion.choices[0]?.message?.content ??
      "I'm here to help! How are you feeling today?"
    );
  }
}
