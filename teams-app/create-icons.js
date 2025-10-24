const fs = require('fs');

// Simple SVG icons
const colorIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" fill="#0078D4"/>
  <path d="M96 48 L144 96 L96 144 L48 96 Z" fill="white"/>
  <circle cx="96" cy="96" r="24" fill="#0078D4"/>
</svg>`;

const outlineIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M16 8 L24 16 L16 24 L8 16 Z" fill="none" stroke="white" stroke-width="2"/>
  <circle cx="16" cy="16" r="4" fill="white"/>
</svg>`;

fs.writeFileSync('color.svg', colorIcon);
fs.writeFileSync('outline.svg', outlineIcon);
console.log('SVG icons created');
