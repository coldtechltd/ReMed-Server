import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';
import { CreateDosageFormDto } from './dto/create-dosage-form.dto';
import { UpdateDosageFormDto } from './dto/update-dosage-form.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { MedicationService } from '../medication/medication.service';

@Injectable()
export class DosageFormService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly medicationService: MedicationService,
  ) {}

  async create(userId: string, createDto: CreateDosageFormDto) {
    // Ensure the medication belongs to the user
    await this.medicationService.findOne(createDto.medicationId, userId);

    const [form] = await this.db
      .insert(schema.dosageForms)
      .values({
        medicationId: createDto.medicationId,
        name: createDto.name,
        type: createDto.type,
        dosageAmount: createDto.dosageAmount,
        dosageUnit: createDto.dosageUnit,
        route: createDto.route,
        quantityOnHand: createDto.quantityOnHand,
        refillThreshold: createDto.refillThreshold,
      })
      .returning();

    return form;
  }

  async findAllByMedication(medicationId: string, userId: string) {
    // Ensure user owns medication
    await this.medicationService.findOne(medicationId, userId);

    return this.db
      .select()
      .from(schema.dosageForms)
      .where(eq(schema.dosageForms.medicationId, medicationId));
  }

  async findOne(id: string, userId: string) {
    // Join with medication to check ownership
    const formsWithMeds = await this.db
      .select({
        form: schema.dosageForms,
        medUserId: schema.medications.userId,
      })
      .from(schema.dosageForms)
      .innerJoin(
        schema.medications,
        eq(schema.dosageForms.medicationId, schema.medications.id),
      )
      .where(eq(schema.dosageForms.id, id))
      .limit(1);

    if (formsWithMeds.length === 0) {
      throw new NotFoundException(`Dosage form with ID ${id} not found`);
    }

    if (formsWithMeds[0].medUserId !== userId) {
      throw new ForbiddenException(
        `Dosage form with ID ${id} does not belong to you`,
      );
    }

    return formsWithMeds[0].form;
  }

  async update(id: string, userId: string, updateDto: UpdateDosageFormDto) {
    const existing = await this.findOne(id, userId);

    const updateData: any = {};
    if (updateDto.name) updateData.name = updateDto.name;
    if (updateDto.type) updateData.type = updateDto.type;
    if (updateDto.dosageAmount !== undefined)
      updateData.dosageAmount = updateDto.dosageAmount;
    if (updateDto.dosageUnit) updateData.dosageUnit = updateDto.dosageUnit;
    if (updateDto.route) updateData.route = updateDto.route;
    if (updateDto.quantityOnHand !== undefined) {
      updateData.quantityOnHand = updateDto.quantityOnHand;
      // Re-arm the low-stock alert when the user restocks above threshold.
      updateData.lowStockAlertSent = false;
    }
    if (updateDto.refillThreshold !== undefined)
      updateData.refillThreshold = updateDto.refillThreshold;

    if (Object.keys(updateData).length === 0) return existing;

    const [updated] = await this.db
      .update(schema.dosageForms)
      .set(updateData)
      .where(eq(schema.dosageForms.id, id))
      .returning();

    return updated;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.db.transaction(async (tx) => {
      // Find schedules
      const schedulesRes = await tx
        .select({ id: schema.schedules.id })
        .from(schema.schedules)
        .where(eq(schema.schedules.dosageFormId, id));

      const schedules = schedulesRes.map((sch) => sch.id);

      if (schedules.length > 0) {
        // Delete dose events
        await tx
          .delete(schema.doseEvents)
          .where(inArray(schema.doseEvents.scheduleId, schedules));
        // Delete schedules
        await tx
          .delete(schema.schedules)
          .where(eq(schema.schedules.dosageFormId, id));
      }

      // Delete dosage form
      await tx.delete(schema.dosageForms).where(eq(schema.dosageForms.id, id));

      return { deleted: true, id };
    });
  }
}
