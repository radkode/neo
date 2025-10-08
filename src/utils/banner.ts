import chalk from 'chalk';

/**
 * Banner display type options
 */
export type BannerType = 'full' | 'compact' | 'none';

/**
 * Displays the full ASCII art banner for Neo CLI
 *
 * This banner features large ASCII art with the Neo CLI branding
 * with a beautiful horizontal blue to purple gradient.
 * Use this for a prominent, eye-catching display.
 */
export function showBanner(): void {
  const banner = `
${chalk.bold.hex('#0066FF')('  ███╗   ██╗')}${chalk.bold.hex('#3D7FFF')('███████╗ ')}${chalk.bold.hex('#6B7FFF')('██████╗ ')}${chalk.bold.hex('#997FFF')('    ██████╗')}${chalk.bold.hex('#C65FFF')('██╗     ')}${chalk.bold.hex('#F33FFF')('██╗')}
${chalk.bold.hex('#0066FF')('  ████╗  ██║')}${chalk.bold.hex('#3D7FFF')('██╔════╝')}${chalk.bold.hex('#6B7FFF')('██╔═══██╗')}${chalk.bold.hex('#997FFF')('   ██╔════╝')}${chalk.bold.hex('#C65FFF')('██║     ')}${chalk.bold.hex('#F33FFF')('██║')}
${chalk.bold.hex('#0066FF')('  ██╔██╗ ██║')}${chalk.bold.hex('#3D7FFF')('█████╗  ')}${chalk.bold.hex('#6B7FFF')('██║   ██║')}${chalk.bold.hex('#997FFF')('   ██║     ')}${chalk.bold.hex('#C65FFF')('██║     ')}${chalk.bold.hex('#F33FFF')('██║')}
${chalk.bold.hex('#0066FF')('  ██║╚██╗██║')}${chalk.bold.hex('#3D7FFF')('██╔══╝  ')}${chalk.bold.hex('#6B7FFF')('██║   ██║')}${chalk.bold.hex('#997FFF')('   ██║     ')}${chalk.bold.hex('#C65FFF')('██║     ')}${chalk.bold.hex('#F33FFF')('██║')}
${chalk.bold.hex('#0066FF')('  ██║ ╚████║')}${chalk.bold.hex('#3D7FFF')('███████╗')}${chalk.bold.hex('#6B7FFF')('╚██████╔╝')}${chalk.bold.hex('#997FFF')('   ╚██████╗')}${chalk.bold.hex('#C65FFF')('███████╗')}${chalk.bold.hex('#F33FFF')('██║')}
${chalk.bold.hex('#0066FF')('  ╚═╝  ╚═══╝')}${chalk.bold.hex('#3D7FFF')('╚══════╝')}${chalk.bold.hex('#6B7FFF')(' ╚═════╝ ')}${chalk.bold.hex('#997FFF')('    ╚═════╝')}${chalk.bold.hex('#C65FFF')('╚══════╝')}${chalk.bold.hex('#F33FFF')('╚═╝')}
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
  const banner = `${chalk.bold.hex('#00BFFF')('⚡ NEO CLI')} ${chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`;
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
