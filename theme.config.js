/** @type {const} */
const themeColors = {
  primary:    { light: '#00c8ff', dark: '#00c8ff' },   // Cyan - primary actions
  secondary:  { light: '#0099ff', dark: '#0099ff' },   // Blue - secondary actions
  accent:     { light: '#00e887', dark: '#00e887' },   // Green - driver mode / success
  danger:     { light: '#ff4444', dark: '#ff4444' },   // Red - emergency / decline
  warning:    { light: '#ff8844', dark: '#ff8844' },   // Orange - demand zones
  purple:     { light: '#8844ff', dark: '#8844ff' },   // Purple - premium
  background: { light: '#060c18', dark: '#060c18' },   // Dark navy
  surface:    { light: '#0f1a2e', dark: '#0f1a2e' },   // Card background
  surface2:   { light: '#162035', dark: '#162035' },   // Elevated surface
  foreground: { light: '#ffffff', dark: '#ffffff' },   // Primary text
  muted:      { light: '#8899aa', dark: '#8899aa' },   // Secondary text
  border:     { light: '#1e3050', dark: '#1e3050' },   // Borders
  success:    { light: '#00e887', dark: '#00e887' },   // Success states
  error:      { light: '#ff4444', dark: '#ff4444' },   // Error states
  tint:       { light: '#00c8ff', dark: '#00c8ff' },   // Tab bar active
};

module.exports = { themeColors };
