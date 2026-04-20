/* eslint-disable camelcase */
import { CUSTOM_MODEL_ID } from '../constants'
import { fetchSSE, getSettings } from '../utils'
import { AbstractEngine } from './abstract-engine'
import { IModel, IMessageRequest } from './interfaces'

export class CustomAnthropic extends AbstractEngine {
    supportCustomModel(): boolean {
        return true
    }

    async getAPIKey(): Promise<string> {
        const settings = await getSettings()
        return settings.customAPIKey
    }

    async getAPIURL(): Promise<string> {
        const settings = await getSettings()
        return settings.customAPIURL || 'https://api.anthropic.com'
    }

    async getAPIURLPath(): Promise<string> {
        const settings = await getSettings()
        return settings.customAPIURLPath || '/v1/messages'
    }

    async getModel(): Promise<string> {
        const settings = await getSettings()
        if (settings.customAPIModel === CUSTOM_MODEL_ID) {
            return settings.customCustomModelName
        }
        return settings.customAPIModel
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async listModels(_apiKey: string | undefined): Promise<IModel[]> {
        return Promise.resolve([{ id: 'glm-5.1', name: 'GLM-5.1' }])
    }

    async sendMessage(req: IMessageRequest): Promise<void> {
        const apiKey = await this.getAPIKey()
        const model = req.modelOverride || (await this.getModel())
        const apiURL = await this.getAPIURL()
        const apiURLPath = await this.getAPIURLPath()
        const url = `${apiURL.replace(/\/+$/, '')}${apiURLPath}`

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'x-api-key': apiKey,
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: Record<string, any> = {
            model,
            stream: true,
            messages: [
                {
                    role: 'user',
                    content: req.rolePrompt ? req.rolePrompt + '\n\n' + req.commandPrompt : req.commandPrompt,
                },
            ],
            temperature: 0,
            max_tokens: 4096,
        }

        let hasError = false
        let finished = false
        await fetchSSE(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: req.signal,
            onMessage: async (msg) => {
                if (finished) return
                let resp
                try {
                    resp = JSON.parse(msg)
                } catch (e) {
                    hasError = true
                    finished = true
                    req.onError(JSON.stringify(e))
                    return
                }
                const { type } = resp
                if (type === 'content_block_delta') {
                    const { delta } = resp
                    if (delta.type === 'thinking_delta') {
                        return
                    }
                    const { text } = delta
                    await req.onMessage({ content: text, role: '' })
                    return
                }
                if (type === 'message_stop') {
                    finished = true
                    req.onFinished('stop')
                    return
                }
                if (type === 'error') {
                    const { error } = resp
                    req.onError('API response: ' + error.message)
                }
            },
            onError: (err) => {
                hasError = true
                if (err instanceof Error) {
                    req.onError(err.message)
                    return
                }
                if (typeof err === 'string') {
                    req.onError(err)
                    return
                }
                if (typeof err === 'object') {
                    const { error } = err
                    if (error instanceof Error) {
                        req.onError(error.message)
                        return
                    }
                    if (typeof error === 'object') {
                        const { message } = error
                        if (message) {
                            if (typeof message === 'string') {
                                req.onError(message)
                            } else {
                                req.onError(JSON.stringify(message))
                            }
                            return
                        }
                    }
                }
                req.onError('Unknown error')
            },
        })

        if (!finished && !hasError) {
            req.onFinished('stop')
        }
    }
}
