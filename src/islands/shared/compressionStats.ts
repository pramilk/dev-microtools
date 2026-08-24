export interface CompressionSavings {
  savedBytes: number;
  percent: number;
  direction: 'smaller' | 'larger' | 'same';
}

/** Compares a before/after byte count the way every "here's what got smaller" stat in this codebase is phrased. */
export function compressionSavings(beforeBytes: number, afterBytes: number): CompressionSavings {
  const savedBytes = beforeBytes - afterBytes;
  const percent = beforeBytes > 0 ? Math.round((Math.abs(savedBytes) / beforeBytes) * 100) : 0;
  const direction = savedBytes > 0 ? 'smaller' : savedBytes < 0 ? 'larger' : 'same';
  return { savedBytes, percent, direction };
}

/** Renders `compressionSavings` as the trailing "(42% smaller)" fragment shown next to a before/after size line. */
export function formatSavingsLabel(savings: CompressionSavings): string {
  if (savings.direction === 'same') return '(no change)';
  return `(${savings.percent}% ${savings.direction})`;
}
