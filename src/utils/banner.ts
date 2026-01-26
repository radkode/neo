import chalk from 'chalk';

/**
 * Banner display type options
 */
export type BannerType = 'full' | 'compact' | 'none';

/**
 * Displays the full ASCII art banner for Neo CLI
 *
 * This banner features large ASCII art with the Neo CLI branding
 * with a subtle blue gradient for a clean, modern look.
 * Use this for a prominent, eye-catching display.
 */
export function showBanner(): void {
  const banner = `
${chalk.bold.hex('#0066FF')('  ███╗   ██╗')}${chalk.bold.hex('#0066FF')('███████╗ ')}${chalk.bold.hex('#3D7FFF')('██████╗ ')}${chalk.bold.hex('#3D7FFF')('    ██████╗')}${chalk.bold.hex('#5599FF')('██╗     ')}${chalk.bold.hex('#5599FF')('██╗')}
${chalk.bold.hex('#0066FF')('  ████╗  ██║')}${chalk.bold.hex('#0066FF')('██╔════╝')}${chalk.bold.hex('#3D7FFF')('██╔═══██╗')}${chalk.bold.hex('#3D7FFF')('   ██╔════╝')}${chalk.bold.hex('#5599FF')('██║     ')}${chalk.bold.hex('#5599FF')('██║')}
${chalk.bold.hex('#0066FF')('  ██╔██╗ ██║')}${chalk.bold.hex('#0066FF')('█████╗  ')}${chalk.bold.hex('#3D7FFF')('██║   ██║')}${chalk.bold.hex('#3D7FFF')('   ██║     ')}${chalk.bold.hex('#5599FF')('██║     ')}${chalk.bold.hex('#5599FF')('██║')}
${chalk.bold.hex('#0066FF')('  ██║╚██╗██║')}${chalk.bold.hex('#0066FF')('██╔══╝  ')}${chalk.bold.hex('#3D7FFF')('██║   ██║')}${chalk.bold.hex('#3D7FFF')('   ██║     ')}${chalk.bold.hex('#5599FF')('██║     ')}${chalk.bold.hex('#5599FF')('██║')}
${chalk.bold.hex('#0066FF')('  ██║ ╚████║')}${chalk.bold.hex('#0066FF')('███████╗')}${chalk.bold.hex('#3D7FFF')('╚██████╔╝')}${chalk.bold.hex('#3D7FFF')('   ╚██████╗')}${chalk.bold.hex('#5599FF')('███████╗')}${chalk.bold.hex('#5599FF')('██║')}
${chalk.bold.hex('#0066FF')('  ╚═╝  ╚═══╝')}${chalk.bold.hex('#0066FF')('╚══════╝')}${chalk.bold.hex('#3D7FFF')(' ╚═════╝ ')}${chalk.bold.hex('#3D7FFF')('    ╚═════╝')}${chalk.bold.hex('#5599FF')('╚══════╝')}${chalk.bold.hex('#5599FF')('╚═╝')}
`;
  console.log(banner);
}

/**
 * Displays a compact, minimal banner for Neo CLI
 *
 * This banner is designed to be less intrusive while still
 * maintaining brand visibility. Perfect for users who want
 * a cleaner terminal output.
 */
export function showCompactBanner(): void {
  const logo = `${chalk.bold.hex('#0066FF')('▐')}${chalk.bold.hex('#3D7FFF')('█')}${chalk.bold.hex('#5599FF')('▌')}`;
  const text = `${chalk.bold.hex('#0066FF')('N')}${chalk.bold.hex('#1A73FF')('E')}${chalk.bold.hex('#3D7FFF')('O')} ${chalk.bold.hex('#4D8CFF')('C')}${chalk.bold.hex('#5599FF')('L')}${chalk.bold.hex('#5599FF')('I')}`;
  const line = `${chalk.hex('#5599FF')('━━━━━━')}${chalk.hex('#6BA3FF')('━━━━━━')}${chalk.hex('#80ADFF')('━━━━━━')}${chalk.hex('#99BFFF')('━━━━━━')}${chalk.hex('#B3D1FF')('━━━━━')}${chalk.dim('━━━━━━━━━━━━━━━━━━━━━')}`;
  const banner = `  ${logo} ${text} ${line}`;
  console.log(banner);
}

/**
 * Displays a banner based on the specified type
 *
 * @param type - The type of banner to display:
 *   - 'full': Shows the complete ASCII art banner
 *   - 'compact': Shows a minimal, single-line banner
 *   - 'none': Displays no banner at all
 *
 * @example
 * ```typescript
 * // Display full banner
 * displayBanner('full');
 *
 * // Display compact banner
 * displayBanner('compact');
 *
 * // Display no banner
 * displayBanner('none');
 * ```
 */
export function displayBanner(type: BannerType): void {
  switch (type) {
    case 'full':
      showBanner();
      break;
    case 'compact':
      showCompactBanner();
      break;
    case 'none':
      // Intentionally display nothing
      break;
    default: {
      // but handle gracefully just in case
      // Type safety ensures this should never happen
      const exhaustiveCheck: never = type;
      console.warn(`Unknown banner type: ${exhaustiveCheck}`);
    }
  }
}
