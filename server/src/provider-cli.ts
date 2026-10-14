// bun test and echo-mode servers reach a provider's CLI only through a stand-in they name or an
// opted-in live test, so neither can spend a real account. No file can exist under /dev/null.
export const blockedCli = '/dev/null/provider-cli-blocked'

export function providerCli(name: string, liveFlag: string) {
  const offline = process.env.NODE_ENV === 'test' || process.env.JETTY_AGENT === 'echo'
  return offline && process.env[liveFlag] !== '1' ? blockedCli : name
}
