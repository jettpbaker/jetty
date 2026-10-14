// bun test reaches a provider's CLI only through a stand-in it names or an opted-in live test, so the
// suite can never spend a real account. No file can exist under /dev/null.
export const blockedCli = '/dev/null/provider-cli-blocked-in-tests'

export function providerCli(name: string, liveFlag: string) {
  return process.env.NODE_ENV === 'test' && process.env[liveFlag] !== '1' ? blockedCli : name
}
