/**
 * BCH2 Theme - Matching bch2.org website design
 */

export const BCH2Colors = {
  // Primary BCH2 Green
  primary: '#0ac18e',
  primaryDark: '#089e74',
  primaryLight: '#2ed9a8',
  primaryGlow: 'rgba(10, 193, 142, 0.12)',
  primaryGlowStrong: 'rgba(10, 193, 142, 0.25)',

  // Backgrounds
  background: '#0a0f14',
  backgroundSecondary: '#111922',
  backgroundCard: '#151f2b',
  backgroundElevated: '#1a2633',

  // Text
  textPrimary: '#ffffff',
  textSecondary: '#a0aec0',
  textMuted: '#718096',
  textAccent: '#0ac18e',

  // Borders
  border: '#2d3748',
  borderHover: '#4a5568',
  borderAccent: '#0ac18e',

  // Status colors
  success: '#0ac18e',
  warning: '#f6ad55',
  error: '#fc8181',
  info: '#63b3ed',

  // BC2 color (for dual-chain display)
  bc2Primary: '#f7931a',
  bc2Dark: '#d97c0a',
};

export const BCH2Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const BCH2Typography = {
  // Font family - Use system monospace for consistency
  fontFamily: {
    mono: 'JetBrains Mono, SF Mono, Menlo, Monaco, monospace',
    sans: 'System',
  },

  // Font sizes
  fontSize: {
    xs: 10,
    sm: 12,
    base: 14,
    md: 16,
    lg: 18,
    xl: 24,
    xxl: 32,
    xxxl: 48,
  },

  // Font weights
  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
};

export const BCH2Shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  glow: {
    shadowColor: '#0ac18e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
};

export const BCH2BorderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

// Gradient definitions for use with LinearGradient
export const BCH2Gradients = {
  primary: ['#0ac18e', '#089e74'],
  primaryToTransparent: ['rgba(10, 193, 142, 0.2)', 'transparent'],
  backgroundCard: ['#1a2633', '#151f2b'],
  bc2: ['#f7931a', '#d97c0a'],
};

export default {
  colors: BCH2Colors,
  spacing: BCH2Spacing,
  typography: BCH2Typography,
  shadows: BCH2Shadows,
  borderRadius: BCH2BorderRadius,
  gradients: BCH2Gradients,
};
