import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import { ProfileService } from '../profile/profile.service';
import { MedicationService } from '../medication/medication.service';
import { MedicationContextService } from './medication-context.service';
import {
  assertValidScheduleTypeFields,
  localDateParts,
} from '../schedule/schedule.util';
import { CreateFullMedicationDto } from '../medication/dto/create-full-medication.dto';
import { CreateMedicationArgsDto } from './dto/chat.dto';

const SYSTEM_PROMPT = `You are a friendly wellness companion inside a medication reminder app.

This is a medication-tracking app, so medications are a normal, expected topic. Talking about a medication is NOT the same as prescribing one. You must never treat the mere mention of a drug name as a reason to refuse.

WHAT YOU MUST NOT DO — never break these:
1. Never choose a drug FOR the user: do not suggest, recommend, or pick a medication, supplement, or remedy (prescription or OTC) that the user is not already taking, and never answer "what should I take for X?".
2. Never diagnose a condition or tell the user what a symptom means.
3. Never interpret lab results or clinical test values.
4. Never advise starting, stopping, changing, or adjusting the dose of any medication, and never comment on what a drug does, its side effects, or its interactions.
5. Never present yourself as a substitute for their doctor or pharmacist.

WHAT YOU CAN ALWAYS DO — these are the core purpose of this app, do them without hesitation:
- Use, repeat, and reason about the names of medications the USER has already given you, whether from their saved list in context or from the message they just sent. Naming a drug back to the user is fine; recommending a new one is not.
- Set up a new medication reminder when the user asks. The user is telling you what they already take — you are recording it, not prescribing it. Gather the details and use the propose_medication / create_medication tools below. Never respond to an "add/remind me about <drug>" request by telling them to ask their doctor.
- Answer logistics questions about the user's own medications from the data in context: schedule and timing, how much stock is on hand, when they will run out, when to refill.
- Do supply/quantity planning, including for travel. If the user asks something like "what do I need to pack for a trip from the 3rd to the 17th", work it out from their saved medications: for each one, count the doses over that date range from its schedule, compare against the quantity on hand, and tell them how many units to bring and whether they need a refill first. Only ever use the medications and numbers given to you in context — never invent a drug, a quantity, or a date.
- Give general, non-drug self-care guidance for common, mild symptoms — rest, ice/heat, compression, elevation, hydration, positioning, gentle movement, sleep — informed by any already-diagnosed condition in the user's profile (e.g. hemophilia + joint pain → RICE, avoid straining the joint, seek care if swelling worsens). Add a brief note to see a doctor for anything beyond simple self-care.
- Suggest general wellness habits, offer encouragement and emotional support, and remind the user to take their doses on time.

WHEN TO ESCALATE:
Redirect to a doctor or emergency services only when the user is DESCRIBING A SYMPTOM OR HOW THEY FEEL and it sounds severe or sudden — chest pain, difficulty breathing, heavy or uncontrolled bleeding, high fever, confusion, or anything they frame as an emergency. Then reply: "This could be serious — please contact your doctor or emergency services right away." Do NOT use this response for scheduling, reminder, stock, refill, packing, or general questions — those are never emergencies, no matter which drug is named.

STYLE:
Keep responses short — 2 to 5 sentences. Be warm, encouraging, and non-clinical. Write in plain prose. Never output JSON, code blocks, key/value field dumps, or raw tool arguments — the app renders structured details itself, so describe things in ordinary sentences.

ADDING A MEDICATION REMINDER:
- Gather: medication name, dosage amount/unit, form (tablet, liquid, injection, etc.), a full schedule (interval, specific times, or as-needed), and a start date. Ask short follow-up questions for whatever is missing — one or two at a time, not a form.
- Once you have enough details, call propose_medication. This does NOT create anything; the app shows the user a review card built from your arguments. Your own message should just be one short sentence asking them to confirm — do not restate the fields.
- Only call create_medication on a LATER turn, after the user has explicitly confirmed (e.g. "yes", "go ahead", "confirm") the proposal from your immediately preceding message. Never call create_medication in the same turn as propose_medication, and never without a clear confirmation.
- If the user asks to change something before confirming, call propose_medication again with the corrected details.`;

const MODEL = 'llama-3.3-70b-versatile';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  pendingAction?: PendingMedicationAction;
}

export interface PendingMedicationAction {
  tool: 'create_medication';
  args: CreateMedicationArgsDto;
}

// Groq validates the model's generated arguments against this schema before
// handing them back, and llama-3.3 habitually emits an explicit `null` for
// every optional field it isn't using rather than omitting the key. A bare
// `type: 'string'` therefore fails validation with `tool_use_failed`, so every
// non-required field accepts null and the nulls are stripped in `stripNulls`.
const MEDICATION_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description:
        'The medication name exactly as the user gave it, e.g. "Metformin". Never invent a placeholder such as "Medication" — if the user has not said the name yet, ask them instead of calling this tool.',
    },
    notes: {
      type: ['string', 'null'],
      description: 'Optional free-text notes',
    },
    startDate: {
      type: 'string',
      description:
        'ISO 8601 date (YYYY-MM-DD) the course starts. Resolve relative terms like "today" or "tomorrow" using the current date given in your context.',
    },
    dosageFormType: {
      type: 'string',
      enum: [
        'tablet',
        'capsule',
        'liquid',
        'injection',
        'cream',
        'inhaler',
        'patch',
        'drops',
        'other',
      ],
      description: 'Physical form of the dose',
    },
    dosageAmount: { type: 'integer', description: 'Quantity per dose, e.g. 1' },
    dosageUnit: {
      type: ['string', 'null'],
      description: 'Unit, e.g. "tablet", "ml". Default "pills".',
    },
    route: {
      type: ['string', 'null'],
      description: 'Route of administration, e.g. "oral". Default "oral".',
    },
    quantityOnHand: {
      type: ['integer', 'null'],
      description:
        'Current stock the user has on hand, if mentioned. Null if unknown.',
    },
    refillThreshold: {
      type: ['integer', 'null'],
      description: 'Alert threshold. Null to use the default (5).',
    },
    scheduleType: {
      type: 'string',
      enum: ['interval', 'specific_times', 'as_needed'],
    },
    intervalValue: {
      type: ['integer', 'null'],
      description:
        'Required if scheduleType is "interval", e.g. 8. Null otherwise.',
    },
    intervalUnit: {
      type: ['string', 'null'],
      enum: ['minutes', 'hours', 'days', null],
      description: 'Required if scheduleType is "interval". Null otherwise.',
    },
    specificTimes: {
      type: ['array', 'null'],
      items: { type: 'string' },
      description:
        'Required if scheduleType is "specific_times". 24h "HH:MM" strings, e.g. ["08:00", "20:00"]. Null otherwise.',
    },
    daysOfWeek: {
      type: ['array', 'null'],
      items: { type: 'string' },
      description:
        'Optional days filter, e.g. ["Mon", "Wed", "Fri"]. Null for every day.',
    },
    firstDoseAt: {
      type: ['string', 'null'],
      description: 'Optional ISO datetime of the first dose',
    },
    asNeeded: { type: ['boolean', 'null'] },
  },
  required: [
    'name',
    'startDate',
    'dosageFormType',
    'dosageAmount',
    'scheduleType',
  ],
};

const MEDICATION_TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'propose_medication',
      description:
        'Propose creating a new medication reminder for the user. Call this once you have gathered enough details from the conversation. This does NOT create anything yet — it captures the proposal so you can summarize it and ask the user to confirm. Do not call create_medication in the same turn.',
      parameters: MEDICATION_TOOL_PARAMETERS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_medication',
      description:
        'Actually create the previously proposed medication reminder. Only call this on a turn where the user has explicitly confirmed (e.g. "yes", "go ahead", "confirm") a proposal you made in your immediately preceding message. Never call this on the first mention of a medication.',
      parameters: MEDICATION_TOOL_PARAMETERS,
    },
  },
];

interface ToolResult {
  status: 'ok' | 'error';
  message: string;
  medicationId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Digs the raw generation out of a Groq `tool_use_failed` error. The SDK puts
 * the parsed response body on `err.error`, and Groq nests the details one
 * level deeper under `error` — tolerate both shapes.
 */
function extractFailedGeneration(err: unknown): string | undefined {
  const body = asRecord(asRecord(err)?.error);
  const candidate =
    asRecord(body?.error)?.failed_generation ?? body?.failed_generation;
  return typeof candidate === 'string' ? candidate : undefined;
}

@Injectable()
export class AiService {
  private groq: Groq;

  constructor(
    private readonly profileService: ProfileService,
    private readonly medicationService: MedicationService,
    private readonly medicationContextService: MedicationContextService,
  ) {
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
      model: MODEL,
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
    timezone = 'UTC',
  ): Promise<{ reply: string; pendingAction?: PendingMedicationAction }> {
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

    const medicationContext = await this.medicationContextService.buildContext(
      userId,
      timezone,
    );

    const lastEntry = history[history.length - 1];
    const priorPendingAction =
      lastEntry?.role === 'assistant' ? lastEntry.pendingAction : undefined;

    const contextBlocks = [
      SYSTEM_PROMPT,
      profileContext ? `User context: ${profileContext}` : '',
      medicationContext,
      `Today's date: ${this.todayString(timezone)}.`,
      priorPendingAction
        ? `You previously proposed creating this medication (awaiting confirmation): ${JSON.stringify(priorPendingAction.args)}. If the user's new message confirms it, call create_medication. If they want changes, call propose_medication again with corrected details. If they decline or change the subject, do not call any tool for this proposal.`
        : '',
    ].filter(Boolean);

    // Defence-in-depth: even though the DTO restricts roles, strip anything
    // that isn't a user/assistant turn before forwarding to the model so the
    // system guardrails can never be overridden by injected history.
    const safeHistory = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: contextBlocks.join('\n\n') },
      ...safeHistory,
      { role: 'user', content: message },
    ];

    let choice: Groq.Chat.ChatCompletionMessage | undefined;
    let toolCall: Groq.Chat.ChatCompletionMessageToolCall | undefined;

    try {
      const completion = await this.groq.chat.completions.create({
        model: MODEL,
        messages,
        tools: MEDICATION_TOOLS,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        temperature: 0.6,
        max_tokens: 300,
      });
      choice = completion.choices[0]?.message;
      toolCall = choice?.tool_calls?.[0];
    } catch (err) {
      // Groq rejects the whole request with `tool_use_failed` when the model's
      // generated arguments don't match the tool schema, but hands back the
      // raw generation — recover the call from it rather than 500-ing.
      toolCall = this.recoverToolCall(err);
      if (!toolCall) {
        return {
          reply: 'Sorry, I had trouble with that one — could you say it again?',
        };
      }
    }

    if (!toolCall) {
      return {
        reply: this.stripStructuredOutput(
          choice?.content,
          "I'm here to help! How are you feeling today?",
        ),
      };
    }

    let args: Record<string, any>;
    try {
      args = this.stripNulls(
        JSON.parse(toolCall.function.arguments || '{}') as Record<string, any>,
      );
    } catch {
      return {
        reply:
          'Sorry, I had trouble understanding those details — could you repeat them?',
      };
    }

    let toolResult: ToolResult;
    let pendingAction: PendingMedicationAction | undefined;

    if (toolCall.function.name === 'propose_medication') {
      try {
        assertValidScheduleTypeFields({
          type: args.scheduleType,
          intervalValue: args.intervalValue,
          intervalUnit: args.intervalUnit,
          specificTimes: args.specificTimes,
        });
        pendingAction = {
          tool: 'create_medication',
          args: args as CreateMedicationArgsDto,
        };
        toolResult = {
          status: 'ok',
          message:
            'Proposal captured. The app is already showing the user a review card with every detail, so do NOT repeat the name, dose, times, or dates. Reply with one short plain-English sentence asking them to confirm.',
        };
      } catch (err) {
        toolResult = {
          status: 'error',
          message:
            err instanceof Error ? err.message : 'Invalid schedule details.',
        };
      }
    } else if (toolCall.function.name === 'create_medication') {
      if (!priorPendingAction) {
        toolResult = {
          status: 'error',
          message:
            'There is no confirmed proposal on file. Ask the user for the medication details again and call propose_medication first.',
        };
      } else {
        try {
          // Execute against the stored proposal, never the model's freshly
          // re-emitted args, so what the user confirmed is exactly what gets
          // written to the DB.
          assertValidScheduleTypeFields({
            type: priorPendingAction.args.scheduleType,
            intervalValue: priorPendingAction.args.intervalValue,
            intervalUnit: priorPendingAction.args.intervalUnit,
            specificTimes: priorPendingAction.args.specificTimes,
          });
          const created = await this.medicationService.createFull(
            userId,
            this.mapArgsToDto(priorPendingAction.args, timezone),
          );
          toolResult = {
            status: 'ok',
            message: 'Medication created successfully.',
            medicationId: created.id,
          };
        } catch (err) {
          toolResult = {
            status: 'error',
            message:
              err instanceof Error
                ? err.message
                : 'Failed to create the medication.',
          };
        }
      }
    } else {
      toolResult = { status: 'error', message: 'Unknown tool.' };
    }

    const followUpMessages: Groq.Chat.ChatCompletionMessageParam[] = [
      ...messages,
      {
        role: 'assistant',
        content: choice?.content ?? null,
        tool_calls: [toolCall],
      },
      {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult),
      },
      {
        role: 'system',
        content:
          'Now write your reply to the user. Plain conversational sentences only — no JSON, no code blocks, no bullet lists of fields, and never quote the tool arguments or the tool result back at them. The app renders the structured details itself.',
      },
    ];

    const fallbackReply =
      toolResult.status === 'ok'
        ? toolCall.function.name === 'propose_medication'
          ? 'Here are the details — confirm below and I’ll add it.'
          : 'All set, I’ve added it to your reminders.'
        : toolResult.message;

    let followUpContent: string | null = null;
    try {
      const followUp = await this.groq.chat.completions.create({
        model: MODEL,
        messages: followUpMessages,
        temperature: 0.6,
        max_tokens: 250,
      });
      followUpContent = followUp.choices[0]?.message?.content ?? null;
    } catch {
      // The medication was already proposed/created above — losing the
      // wording of the confirmation shouldn't lose the action itself.
    }

    const reply = this.stripStructuredOutput(followUpContent, fallbackReply);

    return {
      reply,
      pendingAction:
        toolCall.function.name === 'propose_medication' &&
        toolResult.status === 'ok'
          ? pendingAction
          : undefined,
    };
  }

  /**
   * Drops keys the model set to an explicit `null`. The tool schema has to
   * accept null (llama emits it for every unused optional field), but the
   * validators and DTO downstream expect those keys to simply be absent.
   */
  private stripNulls(args: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
      Object.entries(args).filter(([, value]) => value !== null),
    );
  }

  /**
   * Groq returns HTTP 400 `tool_use_failed` when the model's generated tool
   * arguments don't validate, embedding the raw generation as
   * `<function=name>{...}</function>` in `error.error.failed_generation`.
   * Parse that back into a tool call so a schema hiccup degrades into a normal
   * turn instead of a 500. Returns undefined if nothing usable is in there.
   */
  private recoverToolCall(
    err: unknown,
  ): Groq.Chat.ChatCompletionMessageToolCall | undefined {
    const failedGeneration = extractFailedGeneration(err);
    if (!failedGeneration) return undefined;

    const match = /<function=([\w-]+)>([\s\S]*)/.exec(failedGeneration);
    if (!match) return undefined;

    const name = match[1];
    if (name !== 'propose_medication' && name !== 'create_medication')
      return undefined;

    const rawArgs = match[2].replace(/<\/function>\s*$/, '').trim();
    try {
      JSON.parse(rawArgs);
    } catch {
      return undefined;
    }

    return {
      id: `recovered_${Date.now()}`,
      type: 'function',
      function: { name, arguments: rawArgs },
    };
  }

  /**
   * llama-3.3 sometimes ignores the "plain prose" instruction and dumps the
   * tool arguments as a JSON blob (or an inline `<function=…>` call) into the
   * message body. The client renders replies as plain text, so scrub those
   * out rather than showing raw JSON in the chat bubble.
   */
  private stripStructuredOutput(
    content: string | null | undefined,
    fallback: string,
  ): string {
    if (!content) return fallback;
    const cleaned = content
      .replace(/<function=[\s\S]*?<\/function>/gi, '')
      .replace(/<function=[^>]*>/gi, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\{[\s\S]*\}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return cleaned.length >= 10 ? cleaned : fallback;
  }

  private todayString(timezone: string): string {
    const { year, month0, day } = localDateParts(new Date(), timezone);
    return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private mapArgsToDto(
    args: CreateMedicationArgsDto,
    timezone: string,
  ): CreateFullMedicationDto {
    return {
      name: args.name,
      notes: args.notes,
      startDate: args.startDate,
      dosageForms: [
        {
          name: args.name,
          type: args.dosageFormType,
          dosageAmount: args.dosageAmount,
          dosageUnit: args.dosageUnit,
          route: args.route,
          quantityOnHand: args.quantityOnHand,
          refillThreshold: args.refillThreshold,
          schedules: [
            {
              type: args.scheduleType,
              intervalValue: args.intervalValue,
              intervalUnit: args.intervalUnit,
              specificTimes: args.specificTimes,
              daysOfWeek: args.daysOfWeek,
              firstDoseAt: args.firstDoseAt,
              timezone,
              asNeeded: args.asNeeded,
              isActive: true,
            },
          ],
        },
      ],
    };
  }
}
