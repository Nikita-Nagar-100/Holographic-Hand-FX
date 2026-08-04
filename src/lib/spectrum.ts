export type RGB = { r: number; g: number; b: number };

// Map visible light wavelength (nm) to RGB using the standard CIE-like approximation.
export function wavelengthToRGB(nm: number): RGB {
  let r = 0,
    g = 0,
    b = 0;

  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380);
    g = 0;
    b = 1;
  } else if (nm >= 440 && nm < 490) {
    r = 0;
    g = (nm - 440) / (490 - 440);
    b = 1;
  } else if (nm >= 490 && nm < 510) {
    r = 0;
    g = 1;
    b = -(nm - 510) / (510 - 490);
  } else if (nm >= 510 && nm < 580) {
    r = (nm - 510) / (580 - 510);
    g = 1;
    b = 0;
  } else if (nm >= 580 && nm < 645) {
    r = 1;
    g = -(nm - 645) / (645 - 580);
    b = 0;
  } else if (nm >= 645 && nm <= 780) {
    r = 1;
    g = 0;
    b = 0;
  }

  let factor = 0;
  if (nm >= 380 && nm < 420) factor = 0.3 + (0.7 * (nm - 380)) / (420 - 380);
  else if (nm >= 420 && nm < 700) factor = 1;
  else if (nm >= 700 && nm <= 780) factor = 0.3 + (0.7 * (780 - nm)) / (780 - 700);

  const gamma = 0.8;
  return {
    r: Math.round(255 * Math.pow(Math.max(0, r) * factor, gamma)),
    g: Math.round(255 * Math.pow(Math.max(0, g) * factor, gamma)),
    b: Math.round(255 * Math.pow(Math.max(0, b) * factor, gamma)),
  };
}

export const SPECTRUM_BUCKETS: { nm: number; label: string }[] = [
  { nm: 380, label: 'Violet' },
  { nm: 450, label: 'Blue' },
  { nm: 500, label: 'Cyan' },
  { nm: 530, label: 'Green' },
  { nm: 580, label: 'Yellow' },
  { nm: 620, label: 'Orange' },
  { nm: 700, label: 'Red' },
];

export function spectrumLabel(nm: number): string {
  let best = SPECTRUM_BUCKETS[0];
  for (const b of SPECTRUM_BUCKETS) {
    if (Math.abs(nm - b.nm) < Math.abs(nm - best.nm)) best = b;
  }
  return best.label;
}

export function rgbToCss({ r, g, b }: RGB, alpha = 1): string {
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha})`;
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}
