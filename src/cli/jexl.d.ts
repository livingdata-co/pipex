declare module 'jexl' {
  class Jexl {
    eval(expression: string, context?: Record<string, unknown>): Promise<unknown>
    evalSync(expression: string, context?: Record<string, unknown>): unknown
  }

  const jexlModule: {Jexl: typeof Jexl; expr: Jexl}
  export default jexlModule
}
