import jexlModule from 'jexl'

const jexl = new jexlModule.Jexl()

export async function evaluateCondition(
  expression: string,
  context: Record<string, unknown>
): Promise<boolean> {
  try {
    const result = await jexl.eval(expression, context)
    return Boolean(result)
  } catch {
    return false
  }
}
