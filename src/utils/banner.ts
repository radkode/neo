import chalk from 'chalk';

export function showBanner(): void {
  const banner = `
${chalk.bold.hex('#00BFFF')('  ███╗   ██╗███████╗ ██████╗     ██████╗██╗     ██╗')}
${chalk.bold.hex('#00BFFF')('  ████╗  ██║██╔════╝██╔═══██╗   ██╔════╝██║     ██║')}
${chalk.bold.hex('#00BFFF')('  ██╔██╗ ██║█████╗  ██║   ██║   ██║     ██║     ██║')}
${chalk.bold.hex('#00BFFF')('  ██║╚██╗██║██╔══╝  ██║   ██║   ██║     ██║     ██║')}
${chalk.bold.hex('#00BFFF')('  ██║ ╚████║███████╗╚██████╔╝   ╚██████╗███████╗██║')}
${chalk.bold.hex('#00BFFF')('  ╚═╝  ╚═══╝╚══════╝ ╚═════╝     ╚═════╝╚══════╝╚═╝')}
`;
  console.log(banner);
}
