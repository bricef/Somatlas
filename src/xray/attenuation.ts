// X-ray attenuation for the computed radiograph.
//
// Mass attenuation coefficients (mu/rho, cm^2/g) are from NIST's X-ray mass
// attenuation tables for ICRU-44 tissue compositions:
//   https://pml.nist.gov/PhysRefData/XrayMassCoef/tab4.html
// Densities are the ICRU-44 reference values, except inflated lung, which uses
// a typical in-vivo density. They are educational approximations, not
// dosimetry data.

/** Tissue classes, matching `tissue` in the structure registry. */
export const TISSUES = ['none', 'bone', 'soft', 'lung', 'air', 'blood', 'hull'] as const;
export type Tissue = (typeof TISSUES)[number];

/** Integer codes used on the GPU (index into TISSUES). */
export const tissueCode = (t: Tissue): number => TISSUES.indexOf(t);

const ENERGY_KEV = [10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200];

const MASS_ATTENUATION: Record<'bone' | 'muscle' | 'lung' | 'adipose', number[]> = {
  // Bone, Cortical (ICRU-44)
  bone: [28.51, 9.032, 4.001, 1.331, 0.6655, 0.4242, 0.3148, 0.2229, 0.1855, 0.148, 0.1309],
  // Muscle, Skeletal (ICRU-44): used for soft tissue and blood
  muscle: [5.356, 1.693, 0.8205, 0.3783, 0.2685, 0.2262, 0.2048, 0.1823, 0.1693, 0.1492, 0.1358],
  // Lung Tissue (ICRU-44)
  lung: [5.459, 1.721, 0.8316, 0.3815, 0.2699, 0.227, 0.2053, 0.1826, 0.1695, 0.1493, 0.1359],
  // Adipose Tissue (ICRU-44): not yet used, kept for a future fat layer
  adipose: [3.268, 1.083, 0.5677, 0.3063, 0.2396, 0.2123, 0.1974, 0.18, 0.1688, 0.15, 0.1368],
};

/** g/cm^3 */
const DENSITY = { bone: 1.92, soft: 1.05, blood: 1.06, inflatedLung: 0.26 };

/** Log-log interpolation of a NIST table at `keV` (clamped to the table range). */
export function massAttenuation(table: number[], keV: number): number {
  const e = Math.min(Math.max(keV, ENERGY_KEV[0]), ENERGY_KEV[ENERGY_KEV.length - 1]);
  let i = 0;
  while (i < ENERGY_KEV.length - 2 && ENERGY_KEV[i + 1] < e) i++;
  const [e0, e1] = [ENERGY_KEV[i], ENERGY_KEV[i + 1]];
  const [m0, m1] = [table[i], table[i + 1]];
  const t = Math.log(e / e0) / Math.log(e1 / e0);
  return Math.exp(Math.log(m0) + t * (Math.log(m1) - Math.log(m0)));
}

/**
 * Effective photon energy of a polychromatic beam at a given tube voltage.
 * A common rule of thumb puts the mean energy at roughly 40% of kVp.
 */
export const effectiveEnergyKeV = (kVp: number): number => 0.4 * kVp;

/** Linear attenuation coefficients in 1/m at a tube voltage. */
export function linearAttenuation(kVp: number): Record<Exclude<Tissue, 'none' | 'hull'>, number> {
  const e = effectiveEnergyKeV(kVp);
  const perMetre = (muRho: number, rho: number) => muRho * rho * 100;
  return {
    bone: perMetre(massAttenuation(MASS_ATTENUATION.bone, e), DENSITY.bone),
    soft: perMetre(massAttenuation(MASS_ATTENUATION.muscle, e), DENSITY.soft),
    blood: perMetre(massAttenuation(MASS_ATTENUATION.muscle, e), DENSITY.blood),
    lung: perMetre(massAttenuation(MASS_ATTENUATION.lung, e), DENSITY.inflatedLung),
    air: 0,
  };
}

/**
 * Coefficient each tissue class contributes per metre of path, indexed by
 * tissue code.
 *
 * When the body hull is in the scan set it supplies the soft-tissue baseline,
 * and every structure inside it contributes only its difference from soft
 * tissue (mu - mu_soft), so the body is not counted twice. Without the hull,
 * structures contribute their absolute attenuation.
 */
export function effectiveCoefficients(kVp: number, hullInScan: boolean): number[] {
  const mu = linearAttenuation(kVp);
  const base = hullInScan ? mu.soft : 0;
  const byTissue: Record<Tissue, number> = {
    none: 0,
    bone: mu.bone - base,
    soft: mu.soft - base,
    lung: mu.lung - base,
    air: mu.air - base,
    blood: mu.blood - base,
    hull: hullInScan ? mu.soft : 0,
  };
  return TISSUES.map((t) => byTissue[t]);
}

/** Transmitted fraction for a total attenuation (Beer-Lambert). */
export const transmission = (attenuation: number): number => Math.exp(-attenuation);
