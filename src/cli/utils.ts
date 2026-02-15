import type {Command} from 'commander'

export type GlobalOptions = {
  workdir: string;
  json?: boolean;
}

export function getGlobalOptions(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>()
}
