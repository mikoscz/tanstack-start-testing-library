import { createMiddleware, createServerFn } from '@tanstack/react-start'

const auditMiddleware = createMiddleware({ type: 'function' })
  .client(async ({ next }) => {
    return next({
      sendContext: {
        fromClientMiddleware: 'client-value',
      },
    })
  })
  .server(async ({ next, context }) => {
    return next({
      context: {
        fromServerMiddleware: `${context.fromClientMiddleware}:server-value`,
      },
    })
  })

export const greet = createServerFn({ method: 'POST' })
  .middleware([auditMiddleware])
  .inputValidator((input: { name: string }) => ({
    name: input.name.toUpperCase(),
  }))
  .handler(async ({ data, context }) => {
    return {
      message: `${data.name}:${context.fromServerMiddleware}`,
    }
  })
