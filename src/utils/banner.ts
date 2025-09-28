import chalk from 'chalk';

export function showBanner(): void {
  const banner = `
\x1b[1;33m⚡ NEO CLI\x1b[0m
  \x1b[0;34m${chalk.dim("Radkode's Lightning-Fast CLI Framework")}\x1b[0m
  `;
  console.log(banner);
}
