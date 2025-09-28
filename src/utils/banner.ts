import chalk from 'chalk';

export function showBanner(): void {
  const banner = `
\033[1;33m⚡ ZAP CLI\033[0m
  \033[0;34m${chalk.dim('Radkode\'s Lightning-Fast CLI Framework')}\033[0m
  `;
  console.log(banner);
}
