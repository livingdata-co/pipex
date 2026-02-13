#!/usr/bin/env node
import 'dotenv/config'
import process from 'node:process'
import {Command} from 'commander'
import {registerRunCommand} from './commands/run.js'
import {registerLogsCommand} from './commands/logs.js'
import {registerInspectCommand} from './commands/inspect.js'
import {registerExportCommand} from './commands/export.js'
import {registerShowCommand} from './commands/show.js'
import {registerPruneCommand} from './commands/prune.js'
import {registerListCommand} from './commands/list.js'
import {registerRmCommand} from './commands/rm.js'
import {registerCleanCommand} from './commands/clean.js'

async function main() {
  const program = new Command()

  program
    .name('pipex')
    .description('Execution engine for containerized steps')
    .version('0.1.0')
    .option('--workdir <path>', 'Workspaces root directory', process.env.PIPEX_WORKDIR ?? './workdir')
    .option('--json', 'Output structured JSON logs')

  registerRunCommand(program)
  registerLogsCommand(program)
  registerInspectCommand(program)
  registerExportCommand(program)
  registerShowCommand(program)
  registerPruneCommand(program)
  registerListCommand(program)
  registerRmCommand(program)
  registerCleanCommand(program)

  await program.parseAsync()
}

try {
  await main()
} catch (error: unknown) {
  console.error('Fatal error:', error)
  throw error
}
