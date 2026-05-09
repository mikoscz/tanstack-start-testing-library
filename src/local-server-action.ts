import { isNotFound, isRedirect } from '@tanstack/router-core'
import {
  TSS_FORMDATA_CONTEXT,
  X_TSS_RAW_RESPONSE,
  X_TSS_SERIALIZED,
  getDefaultSerovalPlugins,
  safeObjectMerge,
} from '@tanstack/start-client-core'
import { fromJSON, toCrossJSONAsync } from 'seroval'
import type { Plugin as SerovalPlugin } from 'seroval'

type ServerFnResolver = (
  serverFnId: string,
  access: { origin: 'client' | 'server' },
) => Promise<any>

let serovalPlugins: Array<SerovalPlugin<any, any>> | undefined

const formDataContentTypes = [
  'multipart/form-data',
  'application/x-www-form-urlencoded',
]

const maxPayloadSize = 1_000_000

export async function handleLocalServerAction(opts: {
  request: Request
  context: any
  serverFnId: string
  getServerFnById: ServerFnResolver
  getResponse: () => Response
}) {
  const methodUpper = opts.request.method.toUpperCase()
  const url = new URL(opts.request.url)
  const action = await opts.getServerFnById(opts.serverFnId, {
    origin: 'client',
  })

  if (action.method && methodUpper !== action.method) {
    return new Response(
      `expected ${action.method} method. Got ${methodUpper}`,
      {
        status: 405,
        headers: {
          Allow: action.method,
        },
      },
    )
  }

  serovalPlugins ??= getDefaultSerovalPlugins()

  try {
    let result = await callAction({
      action,
      context: opts.context,
      contentType: opts.request.headers.get('Content-Type'),
      methodUpper,
      request: opts.request,
      url,
    })

    const unwrapped = result.result || result.error

    if (isNotFound(result)) {
      result = createNotFoundResponse(result)
    }

    if (unwrapped instanceof Response) {
      if (isRedirect(unwrapped)) {
        return unwrapped
      }

      unwrapped.headers.set(X_TSS_RAW_RESPONSE, 'true')
      return unwrapped
    }

    return serializeResult(result, opts.getResponse)
  } catch (error) {
    if (error instanceof Response) {
      return error
    }

    if (isNotFound(error)) {
      return createNotFoundResponse(error)
    }

    return serializeError(error, opts.getResponse)
  }
}

async function callAction(opts: {
  action: any
  context: any
  contentType: string | null
  methodUpper: string
  request: Request
  url: URL
}) {
  if (
    formDataContentTypes.some(
      (type) => opts.contentType && opts.contentType.includes(type),
    )
  ) {
    if (opts.methodUpper === 'GET') {
      throw new Error('GET requests with FormData payloads are not supported')
    }

    const formData = await opts.request.formData()
    const serializedContext = formData.get(TSS_FORMDATA_CONTEXT)
    formData.delete(TSS_FORMDATA_CONTEXT)

    let context = opts.context
    if (typeof serializedContext === 'string') {
      const parsedContext = JSON.parse(serializedContext)
      const deserializedContext = fromJSON(parsedContext, {
        plugins: serovalPlugins,
      })

      if (typeof deserializedContext === 'object' && deserializedContext) {
        context = safeObjectMerge(
          deserializedContext as Record<string, unknown>,
          opts.context,
        )
      }
    }

    return opts.action({
      context,
      data: formData,
      method: opts.methodUpper,
    })
  }

  if (opts.methodUpper === 'GET') {
    const payloadParam = opts.url.searchParams.get('payload')

    if (payloadParam && payloadParam.length > maxPayloadSize) {
      throw new Error('Payload too large')
    }

    const payload: any = payloadParam
      ? fromJSON(JSON.parse(payloadParam), { plugins: serovalPlugins })
      : {}

    payload.context = safeObjectMerge(payload.context, opts.context)
    payload.method = opts.methodUpper

    return opts.action(payload)
  }

  let jsonPayload
  if (opts.contentType?.includes('application/json')) {
    jsonPayload = await opts.request.json()
  }

  const payload: any = jsonPayload
    ? fromJSON(jsonPayload, { plugins: serovalPlugins })
    : {}

  payload.context = safeObjectMerge(payload.context, opts.context)
  payload.method = opts.methodUpper

  return opts.action(payload)
}

async function serializeResult(result: unknown, getResponse: () => Response) {
  const response = getResponse()
  const body =
    result === undefined
      ? undefined
      : JSON.stringify(
          await Promise.resolve(
            toCrossJSONAsync(result, {
              refs: new Map(),
              plugins: serovalPlugins,
            }),
          ),
        )

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': 'application/json',
      [X_TSS_SERIALIZED]: 'true',
    },
  })
}

async function serializeError(error: unknown, getResponse: () => Response) {
  const response = getResponse()
  const body = JSON.stringify(
    await Promise.resolve(
      toCrossJSONAsync(error, {
        refs: new Map(),
        plugins: serovalPlugins,
      }),
    ),
  )

  return new Response(body, {
    status: response.status ?? 500,
    statusText: response.statusText,
    headers: {
      'Content-Type': 'application/json',
      [X_TSS_SERIALIZED]: 'true',
    },
  })
}

function createNotFoundResponse(error: any) {
  const { headers, ...rest } = error

  return new Response(JSON.stringify(rest), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
  })
}
