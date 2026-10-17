import { describe, expect, it } from 'vitest';
import { effectiveCoefficients, linearAttenuation, massAttenuation, tissueCode, transmission } from './attenuation';

const BONE = [28.51, 9.032, 4.001, 1.331, 0.6655, 0.4242, 0.3148, 0.2229, 0.1855, 0.148, 0.1309];

describe('massAttenuation', () => {
  it('reproduces NIST table points exactly', () => {
    expect(massAttenuation(BONE, 40)).toBeCloseTo(0.6655, 10);
    expect(massAttenuation(BONE, 100)).toBeCloseTo(0.1855, 10);
  });

  it('interpolates between table points and falls with energy', () => {
    const v = massAttenuation(BONE, 45);
    expect(v).toBeLessThan(0.6655);
    expect(v).toBeGreaterThan(0.4242);
  });

  it('clamps outside the table', () => {
    expect(massAttenuation(BONE, 1)).toBeCloseTo(28.51, 10);
    expect(massAttenuation(BONE, 1000)).toBeCloseTo(0.1309, 10);
  });
});

describe('linearAttenuation', () => {
  it('orders tissues as a radiograph needs: bone > soft > lung > air', () => {
    for (const kv of [50, 70, 100, 120]) {
      const mu = linearAttenuation(kv);
      expect(mu.bone).toBeGreaterThan(mu.soft);
      expect(mu.soft).toBeGreaterThan(mu.lung);
      expect(mu.lung).toBeGreaterThan(mu.air);
    }
  });

  it('gives bone-to-soft contrast that drops as kV rises', () => {
    const ratio = (kv: number) => linearAttenuation(kv).bone / linearAttenuation(kv).soft;
    expect(ratio(60)).toBeGreaterThan(ratio(120));
  });
});

describe('effectiveCoefficients', () => {
  it('makes soft tissue inside the hull contribute nothing extra', () => {
    const c = effectiveCoefficients(100, true);
    expect(c[tissueCode('soft')]).toBe(0);
    expect(c[tissueCode('hull')]).toBeGreaterThan(0);
    expect(c[tissueCode('lung')]).toBeLessThan(0);
    expect(c[tissueCode('air')]).toBeLessThan(0);
  });

  it('uses absolute coefficients when the hull is not scanned', () => {
    const c = effectiveCoefficients(100, false);
    const mu = linearAttenuation(100);
    expect(c[tissueCode('bone')]).toBeCloseTo(mu.bone);
    expect(c[tissueCode('hull')]).toBe(0);
    expect(c[tissueCode('none')]).toBe(0);
  });

  it('a 2 cm bone inside 20 cm of soft tissue attenuates as bone plus soft', () => {
    const kv = 80;
    const mu = linearAttenuation(kv);
    const c = effectiveCoefficients(kv, true);
    const viaHull = c[tissueCode('hull')] * 0.2 + c[tissueCode('bone')] * 0.02;
    const direct = mu.soft * 0.18 + mu.bone * 0.02;
    expect(viaHull).toBeCloseTo(direct, 10);
    expect(transmission(viaHull)).toBeLessThan(transmission(mu.soft * 0.2));
  });
});
