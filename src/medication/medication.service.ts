import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { CreateFullMedicationDto } from './dto/create-full-medication.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { DoseEventGeneratorService } from '../schedule/dose-event-generator.service';

@Injectable()
export class MedicationService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly doseEventGenerator: DoseEventGeneratorService,
  ) {}

  /**
   * Create a medication together with all its dosage forms, schedules, and the
   * initial dose events — atomically. Either the whole tree is persisted or
   * nothing is, so a mid-way failure can't leave an orphaned half-medication.
   */
  async createFull(userId: string, dto: CreateFullMedicationDto) {
    return this.db.transaction(async (tx) => {
      const [medication] = await tx
        .insert(schema.medications)
        .values({
          userId,
          name: dto.name,
          notes: dto.notes,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
        })
        .returning();

      for (const df of dto.dosageForms) {
        const [form] = await tx
          .insert(schema.dosageForms)
          .values({
            medicationId: medication.id,
            name: df.name,
            type: df.type,
            dosageAmount: df.dosageAmount,
            dosageUnit: df.dosageUnit,
            route: df.route,
            quantityOnHand: df.quantityOnHand,
            refillThreshold: df.refillThreshold,
          })
          .returning();

        for (const sch of df.schedules) {
          const tz = sch.timezone ?? 'UTC';
          const [schedule] = await tx
            .insert(schema.schedules)
            .values({
              dosageFormId: form.id,
              type: sch.type,
              intervalValue: sch.intervalValue,
              intervalUnit: sch.intervalUnit,
              specificTimes: sch.specificTimes,
              daysOfWeek: sch.daysOfWeek,
              firstDoseAt: sch.firstDoseAt ? new Date(sch.firstDoseAt) : null,
              timezone: tz,
              asNeeded: sch.asNeeded ?? false,
              isActive: sch.isActive ?? true,
            })
            .returning();

          await this.doseEventGenerator.generateForSchedule(
            schedule,
            { startDate: medication.startDate, endDate: medication.endDate },
            tx,
          );
        }
      }

      return medication;
    });
  }

  async create(userId: string, createMedicationDto: CreateMedicationDto) {
    const [medication] = await this.db
      .insert(schema.medications)
      .values({
        userId,
        name: createMedicationDto.name,
        notes: createMedicationDto.notes,
        startDate: new Date(createMedicationDto.startDate),
        endDate: createMedicationDto.endDate
          ? new Date(createMedicationDto.endDate)
          : null,
      })
      .returning();

    return medication;
  }

  async findAllByUser(userId: string) {
    return this.db
      .select()
      .from(schema.medications)
      .where(eq(schema.medications.userId, userId));
  }

  async findOne(id: string, userId: string) {
    const [medication] = await this.db
      .select()
      .from(schema.medications)
      .where(
        and(
          eq(schema.medications.id, id),
          eq(schema.medications.userId, userId),
        ),
      )
      .limit(1);

    if (!medication) {
      throw new NotFoundException(`Medication with ID ${id} not found`);
    }

    return medication;
  }

  async update(
    id: string,
    userId: string,
    updateMedicationDto: UpdateMedicationDto,
  ) {
    await this.findOne(id, userId); // Ensure it exists and belongs to user

    const updateData: any = {};
    if (updateMedicationDto.name) updateData.name = updateMedicationDto.name;
    if (updateMedicationDto.notes) updateData.notes = updateMedicationDto.notes;
    if (updateMedicationDto.startDate)
      updateData.startDate = new Date(updateMedicationDto.startDate);
    if (updateMedicationDto.endDate)
      updateData.endDate = new Date(updateMedicationDto.endDate);

    if (Object.keys(updateData).length === 0)
      return await this.findOne(id, userId);

    const [updatedMedication] = await this.db
      .update(schema.medications)
      .set(updateData)
      .where(
        and(
          eq(schema.medications.id, id),
          eq(schema.medications.userId, userId),
        ),
      )
      .returning();

    // Course dates bound event generation, so a changed startDate/endDate must
    // rebuild every schedule's future events: shrinking the course drops
    // now-out-of-range doses, extending it fills the horizon back in.
    if (updateMedicationDto.startDate || updateMedicationDto.endDate) {
      const scheduleRows = await this.db
        .select({ schedule: schema.schedules })
        .from(schema.schedules)
        .innerJoin(
          schema.dosageForms,
          eq(schema.schedules.dosageFormId, schema.dosageForms.id),
        )
        .where(eq(schema.dosageForms.medicationId, id));

      for (const row of scheduleRows) {
        await this.doseEventGenerator.regenerateForSchedule(row.schedule, {
          startDate: updatedMedication.startDate,
          endDate: updatedMedication.endDate,
        });
      }
    }

    return updatedMedication;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId); // Ensure it exists and belongs to user

    // Handle cascading deletes manually via transaction
    return this.db.transaction(async (tx) => {
      // 1. Delete dose events related to schedules of dosage forms of this medication
      const forms = await tx
        .select({ id: schema.dosageForms.id })
        .from(schema.dosageForms)
        .where(eq(schema.dosageForms.medicationId, id));

      if (forms.length > 0) {
        const formIds = forms.map((f) => f.id);

        // Find schedules
        const schedulesRes = await tx
          .select({ id: schema.schedules.id })
          .from(schema.schedules)
          .where(inArray(schema.schedules.dosageFormId, formIds));

        const schedules = schedulesRes.map((sch) => sch.id);

        if (schedules.length > 0) {
          // Delete dose events
          await tx
            .delete(schema.doseEvents)
            .where(inArray(schema.doseEvents.scheduleId, schedules));
          // Delete schedules
          await tx
            .delete(schema.schedules)
            .where(inArray(schema.schedules.dosageFormId, formIds));
        }

        // Delete dosage forms
        await tx
          .delete(schema.dosageForms)
          .where(eq(schema.dosageForms.medicationId, id));
      }

      // Finally, delete the medication itself
      await tx.delete(schema.medications).where(eq(schema.medications.id, id));

      return { deleted: true, id };
    });
  }
}
