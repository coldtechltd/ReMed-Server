import {
  normalizeProposal,
  toCreateFullDto,
  firstDoseInstant,
} from './medication-proposal.util';

// The request that went wrong: two drugs, two of each, three times a day,
// twelve of each in stock, until the 5th.
const fluTreatment = {
  name: 'Flu Treatment',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
  drugs: [
    {
      name: 'Paracetamol',
      dosageFormType: 'tablet',
      dosageAmount: 2,
      quantityOnHand: 12,
      scheduleType: 'specific_times',
      specificTimes: ['8:00', '14:00', '20:00'],
    },
    {
      name: 'Piritin',
      dosageFormType: 'tablet',
      dosageAmount: 2,
      quantityOnHand: 12,
      scheduleType: 'specific_times',
      specificTimes: ['08:00', '14:00', '20:00'],
    },
  ],
};

describe('normalizeProposal', () => {
  it('keeps each drug separate, with its own stock', () => {
    const p = normalizeProposal(fluTreatment);
    expect(
      p.drugs.map((d) => [d.name, d.dosageAmount, d.quantityOnHand]),
    ).toEqual([
      ['Paracetamol', 2, 12],
      ['Piritin', 2, 12],
    ]);
    expect(p.endDate).toBe('2026-10-05');
  });

  it('normalises times to zero-padded 24h', () => {
    const p = normalizeProposal(fluTreatment);
    expect(p.drugs[0].specificTimes).toEqual(['08:00', '14:00', '20:00']);
  });

  // Proposals stored before `drugs` existed must still be confirmable.
  it('reads the legacy single-drug shape as one drug named after the medication', () => {
    const p = normalizeProposal({
      name: 'Metformin',
      startDate: '2026-10-01',
      dosageFormType: 'tablet',
      dosageAmount: 1,
      quantityOnHand: 30,
      scheduleType: 'interval',
      intervalValue: 12,
      intervalUnit: 'hours',
    });
    expect(p.drugs).toHaveLength(1);
    expect(p.drugs[0]).toMatchObject({
      name: 'Metformin',
      quantityOnHand: 30,
      intervalValue: 12,
    });
  });

  it('takes the date part of a datetime', () => {
    const p = normalizeProposal({
      ...fluTreatment,
      startDate: '2026-10-01T00:00:00Z',
    });
    expect(p.startDate).toBe('2026-10-01');
  });

  it('rejects an end date before the start', () => {
    expect(() =>
      normalizeProposal({ ...fluTreatment, endDate: '2026-09-30' }),
    ).toThrow(/before startDate/);
  });

  it('rejects a time that is not 24-hour HH:MM', () => {
    expect(() =>
      normalizeProposal({
        ...fluTreatment,
        drugs: [{ ...fluTreatment.drugs[0], specificTimes: ['8am'] }],
      }),
    ).toThrow(/HH:MM/);
  });

  it('rejects an interval schedule with no interval', () => {
    expect(() =>
      normalizeProposal({
        ...fluTreatment,
        drugs: [{ ...fluTreatment.drugs[0], scheduleType: 'interval' }],
      }),
    ).toThrow(/intervalValue/);
  });

  it('drops a days filter that covers the whole week', () => {
    const p = normalizeProposal({
      ...fluTreatment,
      drugs: [
        {
          ...fluTreatment.drugs[0],
          daysOfWeek: ['monday', 'Tue', 'wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        },
      ],
    });
    expect(p.drugs[0].daysOfWeek).toBeUndefined();
  });
});

describe('toCreateFullDto', () => {
  it('makes one dosage form per drug, and a course from the end date', () => {
    const dto = toCreateFullDto(
      normalizeProposal(fluTreatment),
      'Africa/Lagos',
    );
    expect(dto.endDate).toBe('2026-10-05');
    expect(dto.dosageForms.map((f) => [f.name, f.quantityOnHand])).toEqual([
      ['Paracetamol', 12],
      ['Piritin', 12],
    ]);
    expect(dto.dosageForms[0].schedules[0]).toMatchObject({
      type: 'specific_times',
      specificTimes: ['08:00', '14:00', '20:00'],
      timezone: 'Africa/Lagos',
      asNeeded: false,
    });
  });

  // The bug behind doses at 1am: with no first dose, an interval started at
  // the start date's midnight UTC.
  it('starts an interval at 08:00 local when no time was given', () => {
    const dto = toCreateFullDto(
      normalizeProposal({
        ...fluTreatment,
        drugs: [
          {
            ...fluTreatment.drugs[0],
            scheduleType: 'interval',
            intervalValue: 8,
            intervalUnit: 'hours',
          },
        ],
      }),
      'Africa/Lagos',
    );
    // 08:00 in Lagos (UTC+1) is 07:00 UTC.
    expect(dto.dosageForms[0].schedules[0].firstDoseAt).toBe(
      '2026-10-01T07:00:00.000Z',
    );
  });

  it('uses the stated first dose time', () => {
    expect(firstDoseInstant('2026-10-01', '21:30', 'UTC').toISOString()).toBe(
      '2026-10-01T21:30:00.000Z',
    );
  });

  it('leaves an ongoing medication without an end date', () => {
    const { endDate, ...ongoing } = fluTreatment;
    void endDate;
    const dto = toCreateFullDto(normalizeProposal(ongoing), 'UTC');
    expect(dto.endDate).toBeUndefined();
  });
});
