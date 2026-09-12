import {
  findMedicationWarnings,
  matchesTerm,
  parseAllergyTerms,
} from './medication-warnings.util';

describe('parseAllergyTerms', () => {
  it('splits on commas, semicolons and newlines', () => {
    expect(parseAllergyTerms('penicillin, sulfa; peanuts\nlatex')).toEqual([
      'penicillin',
      'sulfa',
      'peanuts',
      'latex',
    ]);
  });

  it('drops tokens too short to be meaningful', () => {
    // Without a floor, a stray "a" or "rx" matches nearly every drug name.
    expect(parseAllergyTerms('penicillin, a, rx, no')).toEqual(['penicillin']);
  });

  it('strips parenthetical asides so the drug name survives', () => {
    expect(
      parseAllergyTerms('Penicillin (mild rash as a child); shellfish'),
    ).toEqual(['penicillin', 'shellfish']);
  });

  it('keeps the leading word of a qualified term', () => {
    // "sulfa drugs" has to be able to match Sulfadoxine.
    expect(parseAllergyTerms('sulfa drugs')).toEqual(['sulfa drugs', 'sulfa']);
  });

  it('handles an empty or missing field', () => {
    expect(parseAllergyTerms(null)).toEqual([]);
    expect(parseAllergyTerms('')).toEqual([]);
    expect(parseAllergyTerms('  ,  ; ')).toEqual([]);
  });
});

describe('matchesTerm', () => {
  it('matches at a word boundary', () => {
    expect(matchesTerm('penicillin v', 'penicillin')).toBe(true);
    expect(matchesTerm('amoxicillin/clavulanic acid', 'clavulanic')).toBe(true);
    expect(matchesTerm('co-codamol', 'codamol')).toBe(true);
  });

  it('does not match mid-word — the classic false positive', () => {
    // "ace" inside "paracetamol" is why substring matching can't be used here.
    expect(matchesTerm('paracetamol', 'ace')).toBe(false);
    expect(matchesTerm('paracetamol', 'cet')).toBe(false);
    expect(matchesTerm('metformin', 'form')).toBe(false);
  });

  it('ignores terms below the minimum length', () => {
    expect(matchesTerm('aspirin', 'as')).toBe(false);
  });
});

describe('findMedicationWarnings', () => {
  const activeMedications = [
    { id: 'med-1', name: 'Paracetamol', genericName: 'Paracetamol' },
    { id: 'med-2', name: 'Amlodipine', genericName: 'Amlodipine' },
  ];

  it('returns nothing when there is nothing to flag', () => {
    expect(
      findMedicationWarnings({
        name: 'Metformin',
        genericName: 'Metformin',
        allergies: 'penicillin',
        activeMedications,
      }),
    ).toEqual([]);
  });

  describe('allergies', () => {
    it('flags a medication matching a recorded allergy', () => {
      const [warning] = findMedicationWarnings({
        name: 'Amoxicillin',
        genericName: 'Amoxicillin',
        allergies: 'amoxicillin, dust',
      });
      expect(warning).toMatchObject({
        kind: 'allergy',
        matched: 'amoxicillin',
      });
    });

    it('matches through the active ingredient, not just the typed name', () => {
      // Allergy recorded as the generic; user types the brand.
      const [warning] = findMedicationWarnings({
        name: 'Panadol',
        genericName: 'Paracetamol',
        allergies: 'paracetamol',
      });
      expect(warning).toMatchObject({ kind: 'allergy' });
    });

    it('does not fire on an incidental substring', () => {
      expect(
        findMedicationWarnings({
          name: 'Paracetamol',
          genericName: 'Paracetamol',
          allergies: 'ace inhibitors',
        }),
      ).toEqual([]);
    });

    it('tolerates a messy free-text field', () => {
      const warnings = findMedicationWarnings({
        name: 'Penicillin V',
        genericName: 'Phenoxymethylpenicillin',
        allergies: '  Penicillin (mild rash as a child); shellfish  ',
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0].kind).toBe('allergy');
    });
  });

  describe('duplicates', () => {
    it('flags the same medication added twice', () => {
      const [warning] = findMedicationWarnings({
        name: 'paracetamol',
        genericName: 'Paracetamol',
        activeMedications,
      });
      expect(warning).toMatchObject({
        kind: 'duplicate',
        matched: 'Paracetamol',
        medicationId: 'med-1',
      });
    });

    it('flags the same ingredient under a different brand', () => {
      const [warning] = findMedicationWarnings({
        name: 'Panadol',
        genericName: 'Paracetamol',
        activeMedications,
      });
      expect(warning).toMatchObject({
        kind: 'duplicate',
        medicationId: 'med-1',
      });
      expect(warning.message).toContain('same active ingredient');
    });

    it('does not flag a different medication', () => {
      expect(
        findMedicationWarnings({
          name: 'Ibuprofen',
          genericName: 'Ibuprofen',
          activeMedications,
        }),
      ).toEqual([]);
    });

    it('does not flag on an unknown generic', () => {
      // Two medications both with a null generic must not be treated as equal.
      expect(
        findMedicationWarnings({
          name: 'Something herbal',
          genericName: null,
          activeMedications: [
            { id: 'med-3', name: 'Another herbal', genericName: null },
          ],
        }),
      ).toEqual([]);
    });
  });

  it('reports an allergy and a duplicate together', () => {
    const warnings = findMedicationWarnings({
      name: 'Paracetamol',
      genericName: 'Paracetamol',
      allergies: 'paracetamol',
      activeMedications,
    });
    expect(warnings.map((w) => w.kind).sort()).toEqual([
      'allergy',
      'duplicate',
    ]);
  });
});
