/**
 * Duration formatting (pure logic). The caller supplies locale templates via
 * the DSH locale seat; splitting is locale-independent.
 */
export interface DurationParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

export function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export type DurationFormatter = (parts: DurationParts) => string;

/** Default (Chinese, matches the product's primary UI language). */
export function formatDurationChinese(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms);
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
  if (minutes > 0) return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
  return `${seconds}秒`;
}

/** English fallback. */
export function formatDurationEnglish(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}
