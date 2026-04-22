/**
 * `neo schema` — machine-readable introspection of the CLI command tree.
 *
 * Agents use this to discover what commands and flags exist without relying on
 * (potentially stale) training data. The output is stable JSON shaped after the
 * OpenCLI spec: name/description/options/arguments/subcommands.
 */

import { Command, Option } from '@commander-js/extra-typings';
import packageJson from '../../../package.json' with { type: 'json' };
import { emitJson } from '@/utils/output.js';
import { ui } from '@/utils/ui.js';

interface SchemaOption {
  flags: string;
  long?: string;
  short?: string;
  description: string;
  required: boolean;
  defaultValue?: unknown;
  takesArg: boolean;
  choices?: readonly string[];
}

interface SchemaArgument {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
}

interface SchemaCommand {
  name: string;
  path: string;
  description: string;
  aliases: string[];
  arguments: SchemaArgument[];
  options: SchemaOption[];
  subcommands: SchemaCommand[];
}

interface SchemaRoot {
  $schema: 'opencli-lite/v1';
  name: string;
  version: string;
  description: string;
  globalOptions: SchemaOption[];
  commands: SchemaCommand[];
  agentNotes: {
    nonInteractive: string;
    json: string;
    exitCodes: Record<string, string>;
    envVars: Record<string, string>;
  };
}

function describeOption(opt: Option): SchemaOption {
  const o = opt as Option & {
    long?: string;
    short?: string;
    flags: string;
    description: string;
    required: boolean;
    defaultValue?: unknown;
    argChoices?: readonly string[];
    optional?: boolean;
  };
  const takesArg = /[<[]/.test(o.flags);
  const schema: SchemaOption = {
    flags: o.flags,
    description: o.description,
    required: Boolean(o.required),
    takesArg,
  };
  if (o.long) schema.long = o.long;
  if (o.short) schema.short = o.short;
  if (o.defaultValue !== undefined) schema.defaultValue = o.defaultValue;
  if (o.argChoices && o.argChoices.length > 0) schema.choices = o.argChoices;
  return schema;
}

interface RegisteredArgument {
  name(): string;
  description: string;
  required: boolean;
  variadic: boolean;
}

function describeArguments(cmd: Command): SchemaArgument[] {
  const args = (cmd as unknown as { registeredArguments?: RegisteredArgument[] })
    .registeredArguments;
  if (!args || args.length === 0) return [];
  return args.map((a) => ({
    name: a.name(),
    description: a.description,
    required: a.required,
    variadic: a.variadic,
  }));
}

function buildCommandSchema(cmd: Command, parentPath: string[] = []): SchemaCommand {
  const name = cmd.name();
  const path = [...parentPath, name].join(' ');
  const options = (cmd.options ?? []).map(describeOption);

  const schema: SchemaCommand = {
    name,
    path,
    description: cmd.description() || '',
    aliases: cmd.aliases(),
    arguments: describeArguments(cmd),
    options,
    subcommands: (cmd.commands as Command[])
      .filter((c) => c.name() !== 'help')
      .map((c) => buildCommandSchema(c, [...parentPath, name])),
  };

  return schema;
}

export async function buildFullSchema(root: Command): Promise<SchemaRoot> {
  const globalOptions = (root.options ?? []).map(describeOption);
  const commands = (root.commands as Command[])
    .filter((c) => c.name() !== 'help' && c.name() !== 'schema')
    .map((c) => buildCommandSchema(c));

  return {
    $schema: 'opencli-lite/v1',
    name: root.name(),
    version: packageJson.version,
    description: packageJson.description ?? '',
    globalOptions,
    commands,
    agentNotes: {
      nonInteractive:
        'Pass --json (implies --non-interactive and --quiet) or --yes to skip interactive prompts. Required fields that cannot be inferred will exit with code 2.',
      json: 'stdout is reserved for final JSON payloads; logs/spinners/banners go to stderr. Under --json, errors emit as {"error": {...}} on stdout.',
      exitCodes: {
        '0': 'Success',
        '1': 'Command failure',
        '2': 'Non-interactive prompt required — missing flag',
      },
      envVars: {
        NEO_JSON: 'Equivalent to --json',
        NEO_YES: 'Equivalent to --yes',
        NEO_NON_INTERACTIVE: 'Equivalent to --non-interactive',
        NEO_QUIET: 'Equivalent to --quiet',
        NO_COLOR: 'Standard — disables colors',
        CI: 'When set, implies --non-interactive and suppresses banner/update-check',
      },
    },
  };
}

function getRootProgram(cmd: Command): Command {
  let current: Command = cmd;
  while (current.parent) {
    current = current.parent as Command;
  }
  return current;
}

export function createSchemaCommand(): Command {
  const command = new Command('schema');

  command
    .description('Emit a machine-readable JSON description of every command and option')
    .option('--pretty', 'pretty-print the JSON')
    .addHelpText(
      'after',
      `
Agents: use this to discover commands and flags dynamically.

Example:
  $ neo schema | jq '.commands[] | .path'
  $ neo schema --pretty > neo-schema.json
`
    )
    .action(async (opts: { pretty?: boolean }) => {
      const root = getRootProgram(command);
      const schema = await buildFullSchema(root);

      if (opts.pretty) {
        // Always write to stdout; this command exists precisely for structured output.
        process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
      } else {
        emitJson(schema as unknown as Record<string, unknown>, {
          text: () => process.stdout.write(`${JSON.stringify(schema)}\n`),
        });
      }

      // Non-blocking hint written to stderr when run interactively.
      if (process.stdout.isTTY) {
        ui.muted('Tip: pipe through `jq` to filter. Use --pretty for indented output.');
      }
    });

  return command;
}
