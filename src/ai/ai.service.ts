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

STRICT RULES — never break these under any circumstances:
1. You CANNOT prescribe, recommend, or name any medication, supplement, or drug (prescription or OTC).
2. You CANNOT diagnose any medical condition or tell the user what a symptom means.
3. You CANNOT interpret lab results or clinical test values.
4. You CANNOT suggest changing, stopping, starting, or adjusting the dose of any prescribed medication.
5. You MAY give general, non-drug self-care/first-aid guidance for common, non-severe symptoms — rest, ice/cold or heat, compression, elevation, hydration, positioning, gentle movement, sleep — especially informed by the user's already-diagnosed condition in their profile (e.g. hemophilia + joint pain → RICE: rest, ice, compression, elevation; avoid strenuous use of the joint; seek care if swelling is severe, worsening, or doesn't improve). Always add a brief note to see a doctor for anything beyond simple self-care.
6. You MUST hard-refuse and redirect to a doctor or emergency services (no self-care attempt) whenever a symptom sounds severe, sudden, or uncertain in cause — e.g. chest pain, difficulty breathing, heavy/uncontrolled bleeding, high fever, confusion, or anything the user frames as an emergency. Respond with: "This could be serious — please contact your doctor or emergency services right away."

You CAN:
- Gently remind the user to take their medication on time (without commenting on what the medication does).
- Answer questions about the user's own medication schedule, stock levels, and refill timing using the data provided to you in context — never guess at quantities or dates that aren't given to you.
- Help the user set up a new medication reminder by gathering its name, dose, form, and schedule, then using the propose_medication/create_medication tools as instructed below.
- Suggest general wellness habits: drinking enough water, getting adequate rest, sleep hygiene, light walking, healthy eating.
- Encourage the user to call their doctor or emergency contact if they feel unwell.
- Offer brief emotional support, motivation, and positivity.
Keep responses short — 2 to 5 sentences maximum. Be warm, encouraging, and non-clinical.

When the user wants to add a new medication reminder:
- Gather: medication name, dosage amount/unit, form (tablet, liquid, injection, etc.), and a full schedule (interval, specific times, or as-needed) plus a start date. Ask follow-up questions for anything missing.
- Once you have enough details, call propose_medication — this does NOT create anything, it only lets the user review a summary. Summarize what you're about to create in plain language and ask them to confirm.
- Only call create_medication on a later turn, after the user has explicitly confirmed (e.g. "yes", "go ahead", "confirm") the proposal from your immediately preceding message. Never call create_medication on the same turn as propose_medication, and never call it without a clear confirmation.
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

const MEDICATION_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Medication name, e.g. "Metformin"' },
    notes: { type: 'string', description: 'Optional free-text notes' },
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
      type: 'string',
      description: 'Unit, e.g. "tablet", "ml". Default "pills".',
    },
    route: {
      type: 'string',
      description: 'Route of administration, e.g. "oral". Default "oral".',
    },
    quantityOnHand: {
      type: 'integer',
      description:
        'Current stock the user has on hand, if mentioned. Omit if unknown.',
    },
    refillThreshold: {
      type: 'integer',
      description: 'Alert threshold. Omit to use the default (5).',
    },
    scheduleType: {
      type: 'string',
      enum: ['interval', 'specific_times', 'as_needed'],
    },
    intervalValue: {
      type: 'integer',
      description: 'Required if scheduleType is "interval", e.g. 8',
    },
    intervalUnit: {
      type: 'string',
      enum: ['minutes', 'hours', 'days'],
      description: 'Required if scheduleType is "interval"',
    },
    specificTimes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Required if scheduleType is "specific_times". 24h "HH:MM" strings, e.g. ["08:00", "20:00"]',
    },
    daysOfWeek: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional days filter, e.g. ["Mon", "Wed", "Fri"]. Omit for every day.',
    },
    firstDoseAt: {
      type: 'string',
      description: 'Optional ISO datetime of the first dose',
    },
    asNeeded: { type: 'boolean' },
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

    const completion = await this.groq.chat.completions.create({
      model: MODEL,
      messages,
      tools: MEDICATION_TOOLS,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      temperature: 0.6,
      max_tokens: 300,
    });

    const choice = completion.choices[0]?.message;
    const toolCall = choice?.tool_calls?.[0];

    if (!toolCall) {
      return {
        reply:
          choice?.content ?? "I'm here to help! How are you feeling today?",
      };
    }

    let args: Record<string, any>;
    try {
      args = JSON.parse(toolCall.function.arguments || '{}') as Record<
        string,
        any
      >;
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
            'Proposal captured. Summarize it for the user in plain language and ask them to confirm before it is created.',
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
    ];

    const followUp = await this.groq.chat.completions.create({
      model: MODEL,
      messages: followUpMessages,
      temperature: 0.6,
      max_tokens: 250,
    });

    const reply =
      followUp.choices[0]?.message?.content ??
      (toolResult.status === 'ok' ? 'Done.' : 'Something went wrong.');

    return {
      reply,
      pendingAction:
        toolCall.function.name === 'propose_medication' &&
        toolResult.status === 'ok'
          ? pendingAction
          : undefined,
    };
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
