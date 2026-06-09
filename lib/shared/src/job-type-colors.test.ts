import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TYPE_COLORS } from './job-type-colors.js';

describe('JOB_TYPE_COLORS', () => {
  it('exports the exact four canonical hex values', () => {
    assert.equal(JOB_TYPE_COLORS.workOrder,    '#1E5A99', 'workOrder must be #1E5A99');
    assert.equal(JOB_TYPE_COLORS.billingSheet, '#B06820', 'billingSheet must be #B06820');
    assert.equal(JOB_TYPE_COLORS.wetCheck,     '#5E8C2A', 'wetCheck must be #5E8C2A');
    assert.equal(JOB_TYPE_COLORS.estimate,     '#6B46C1', 'estimate must be #6B46C1');
  });

  it('all four values are distinct (no accidental duplicate)', () => {
    const values = Object.values(JOB_TYPE_COLORS);
    const unique = new Set(values);
    assert.equal(unique.size, values.length, `Expected all ${values.length} colors to be distinct; got duplicates: ${values.join(', ')}`);
  });
});
