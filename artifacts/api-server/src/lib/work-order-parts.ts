export function numericMoney(value: unknown): number {
  const parsed = parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function deriveCompletionPartsCost(input: {
  submittedTotalPartsCost: unknown;
  incomingItems: Array<{
    totalPrice?: unknown;
    quantity?: unknown;
    partPrice?: unknown;
    unitPrice?: unknown;
  }>;
  persistedItems: Array<{ totalPrice?: unknown }>;
  skipReplace: boolean;
}): { partsCost: number; derivedFromSubmittedItems: boolean; itemsTotal: number } {
  const itemsTotal = input.incomingItems.reduce(
    (sum, item) =>
      sum +
      numericMoney(
        item.totalPrice ??
          (numericMoney(item.quantity) * numericMoney(item.partPrice ?? item.unitPrice)),
      ),
    0,
  );
  if (input.skipReplace) {
    return {
      partsCost: input.persistedItems.reduce((sum, item) => sum + numericMoney(item.totalPrice), 0),
      derivedFromSubmittedItems: false,
      itemsTotal,
    };
  }
  const derive = input.incomingItems.length > 0 && numericMoney(input.submittedTotalPartsCost) === 0;
  return {
    partsCost: derive ? itemsTotal : numericMoney(input.submittedTotalPartsCost),
    derivedFromSubmittedItems: derive,
    itemsTotal,
  };
}