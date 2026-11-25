const SCALE = 1_000_000_000_000n;

export function decimalUnits(value: string): bigint {
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(value)) {
    throw new Error('Desimal accounting tidak valid');
  }

  const [whole = '0', fraction = ''] = value.split('.');

  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
}

export function decimalString(value: bigint): string {
  if (value < 0n) {
    throw new Error('Accounting tidak boleh negatif');
  }

  const fraction = (value % SCALE).toString().padStart(12, '0').replace(/0+$/, '');

  return `${value / SCALE}${fraction ? `.${fraction}` : ''}`;
}

export function priceAmount(quantity: string, rate: string, perUnits: number): string {
  if (!Number.isSafeInteger(perUnits) || perUnits < 1) {
    throw new Error('Unit tarif tidak valid');
  }

  const numerator = decimalUnits(quantity) * decimalUnits(rate);
  const denominator = SCALE * BigInt(perUnits);

  return decimalString((numerator + denominator / 2n) / denominator);
}

export function sumMoney(values: readonly string[]): string {
  return decimalString(values.reduce((sum, value) => sum + decimalUnits(value), 0n));
}
